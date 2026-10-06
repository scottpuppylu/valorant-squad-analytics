import type { SqlDatabase } from '../db/types.js';
import { PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION } from '../../shared/privacyPolicy.js';
import { featureScopePolicies } from '../../src/analytics/scope/policies.js';
import { compareSeasonKeysDesc, normalizeSeasonKey, seasonLabel } from '../../src/analytics/scope/season.js';
import type { ScopeStatus } from '../../src/analytics/scope/types.js';
import { ADAPTIVE_WINDOW_VERSION, ANALYSIS_SCOPE_VERSION, ANALYTICS_CONTEXT_VERSION, FEATURE_SCOPE_POLICY_VERSION } from '../../src/analytics/scope/versions.js';
import { normalizeGameMode } from '../../src/utils/gameMode.js';
import { isAbsoluteStrengthMode, isSameMatchRelativeMode, MODE_ELIGIBILITY_POLICY_VERSION } from '../../src/analytics/modeEligibility.js';
import { activePlayers as visibleAccounts } from './postgresDatasetReadRepository.js';
import { datasetSchemaVersion, datasetWindowSize } from './types.js';

/** Same CURRENT visibility rule as the snapshot/history (re-evaluated every request). */
const activePlayers = `
  SELECT p.id FROM players p
  WHERE p.anonymized_at IS NULL
    AND (SELECT count(*) FROM consents c WHERE c.player_id=p.id AND c.status='active') = 1
    AND EXISTS (SELECT 1 FROM consents c WHERE c.player_id=p.id AND c.status='active'
      AND c.consent_method='${PUBLIC_DATASET_CONSENT_METHOD}' AND c.privacy_version='${PUBLIC_DATASET_PRIVACY_VERSION}')
    AND EXISTS (SELECT 1 FROM squad_memberships sm WHERE sm.player_id=p.id AND sm.status='active')`;

interface ContextGroupRow extends Record<string, unknown> {
  queue_id: string | null;
  queue_name: string | null;
  season_short: string | null;
  has_season_id: boolean;
  has_duration: boolean;
  has_start: boolean;
  matches: number;
}

interface ContextFacetRow extends Record<string, unknown> {
  maps: { map: string; matches: number }[] | null;
  agents: string[] | null;
  outcome_matches: number | null;
  outcome_wins: number | null;
  /** Per raw queue (normalized + classified in JS by mode-eligibility-policy-v1). */
  outcomes_by_queue: { queue_id: string | null; queue_name: string | null; matches: number; wins: number }[] | null;
}

export interface AnalyticsContextRows {
  groups: ContextGroupRow[];
  rankObservations: number;
  /** TASK-DATA-03B.2C all-tracked facets (absent in older test fixtures). */
  facets?: ContextFacetRow;
  sqlQueryCount: number;
}

/**
 * TASK-DATA-03B.2C: filter options and the team outcome over ALL eligible tracked matches (never the
 * transport snapshot). One aggregate statement; no identifiers of any kind leave this view.
 * Team outcome uses the projection's rule: the lowest-public-id visible participant's team.
 */
export const analyticsFacetsSql = `
  WITH active_players AS (${visibleAccounts}),
  observed AS (
    SELECT sm.id AS match_id, COALESCE(sm.map_name, 'Unknown') AS map_name, mp.agent_name, mp.team_key, ap.public_id, sm.queue_id, sm.queue_name
    FROM source_matches sm
    JOIN match_participants mp ON mp.source_match_id=sm.id
    JOIN active_players ap ON ap.id=mp.player_id
    WHERE sm.started_at IS NOT NULL
  ),
  first_team AS (
    SELECT DISTINCT ON (o.match_id) o.match_id, o.team_key, o.queue_id, o.queue_name FROM observed o ORDER BY o.match_id, o.public_id
  )
  SELECT
    (SELECT json_agg(json_build_object('map', m.map_name, 'matches', m.matches) ORDER BY m.map_name)
       FROM (SELECT map_name, count(DISTINCT match_id)::int AS matches FROM observed GROUP BY map_name) m) AS maps,
    (SELECT json_agg(a.agent_name ORDER BY a.agent_name) FROM (SELECT DISTINCT agent_name FROM observed WHERE agent_name IS NOT NULL) a) AS agents,
    (SELECT count(*)::int FROM first_team) AS outcome_matches,
    (SELECT count(*)::int FROM first_team ft JOIN match_teams mt ON mt.source_match_id=ft.match_id AND mt.team_key=ft.team_key WHERE mt.won IS TRUE) AS outcome_wins,
    (SELECT json_agg(json_build_object('queue_id', q.queue_id, 'queue_name', q.queue_name, 'matches', q.matches, 'wins', q.wins))
       FROM (SELECT ft.queue_id, ft.queue_name, count(*)::int AS matches, count(*) FILTER (WHERE mt.won IS TRUE)::int AS wins
             FROM first_team ft LEFT JOIN match_teams mt ON mt.source_match_id=ft.match_id AND mt.team_key=ft.team_key
             GROUP BY ft.queue_id, ft.queue_name) q) AS outcomes_by_queue`;

export class PostgresAnalyticsContextRepository {
  constructor(private readonly database: Pick<SqlDatabase, 'query'>) {}

  /** Two aggregate statements; no identifiers, no per-match rows. */
  async readContextRows(): Promise<AnalyticsContextRows> {
    const [groups, rank, facets] = await Promise.all([
      this.database.query<ContextGroupRow>(`WITH active_players AS (${activePlayers}),
        eligible AS (
          SELECT DISTINCT sm.id, sm.started_at, sm.season_id, sm.season_short, sm.game_length_ms, sm.queue_id, sm.queue_name
          FROM source_matches sm
          JOIN match_participants mp ON mp.source_match_id=sm.id
          JOIN active_players ap ON ap.id=mp.player_id
        )
        SELECT queue_id, queue_name, season_short,
               (season_id IS NOT NULL) AS has_season_id,
               (game_length_ms IS NOT NULL AND game_length_ms > 0) AS has_duration,
               (started_at IS NOT NULL) AS has_start,
               count(*)::int AS matches
        FROM eligible GROUP BY 1,2,3,4,5,6`),
      this.database.query<{ observations: number }>(`WITH active_players AS (${activePlayers})
        SELECT count(*)::int AS observations FROM rank_observations ro JOIN active_players ap ON ap.id=ro.player_id`),
      this.database.query<ContextFacetRow>(analyticsFacetsSql),
    ]);
    return { groups: groups.rows, rankObservations: Number(rank.rows[0]?.observations ?? 0), ...(facets.rows[0] ? { facets: facets.rows[0] } : {}), sqlQueryCount: 3 };
  }
}

const ratioStatus = (have: number, total: number): ScopeStatus => (total === 0 || have === 0 ? 'unavailable' : have === total ? 'available' : 'partial');

export function buildAnalyticsContext(rows: AnalyticsContextRows) {
  let eligibleMatches = 0;
  let trackedMatchCount = 0;
  let withSeason = 0;
  let seasonIdOnly = 0;
  let unrecognizedSeason = 0;
  let withDuration = 0;
  let withSeasonIdColumn = 0;
  let withSeasonShortColumn = 0;
  const acts = new Map<string, number>();
  const queues = new Map<string, number>();
  for (const group of rows.groups) {
    const matches = Number(group.matches);
    eligibleMatches += matches;
    if (!group.has_start) continue;
    trackedMatchCount += matches;
    if (group.has_season_id) withSeasonIdColumn += matches;
    if (group.season_short) withSeasonShortColumn += matches;
    const key = normalizeSeasonKey(group.season_short);
    if (key) { withSeason += matches; acts.set(key, (acts.get(key) ?? 0) + matches); }
    else if (group.season_short) unrecognizedSeason += matches;
    else if (group.has_season_id) seasonIdOnly += matches;
    if (group.has_duration) withDuration += matches;
    const mode = normalizeGameMode(group.queue_id, group.queue_name);
    queues.set(mode, (queues.get(mode) ?? 0) + matches);
  }
  return {
    ok: true as const,
    schemaVersion: datasetSchemaVersion,
    view: 'analytics' as const,
    analyticsVersion: ANALYTICS_CONTEXT_VERSION,
    scopeRuleVersion: ANALYSIS_SCOPE_VERSION,
    featurePolicyVersion: FEATURE_SCOPE_POLICY_VERSION,
    adaptiveWindowVersion: ADAPTIVE_WINDOW_VERSION,
    population: {
      /** Eligible durable matches with a start time; never a Riot lifetime total. */
      trackedMatchCount,
      /** TRANSPORT bootstrap size only — never an analytics, history or completeness boundary. */
      snapshotWindow: datasetWindowSize,
      /** True when the transport snapshot happens to hold every eligible tracked match (informational). */
      snapshotCoversTrackedHistory: eligibleMatches <= datasetWindowSize,
      lifetimeComplete: false as const,
    },
    ...(rows.facets ? { facets: {
      /** All tracked matches: filter options are never derived from the transport snapshot. */
      maps: (rows.facets.maps ?? []).map((item) => ({ map: item.map, matches: Number(item.matches) })),
      agents: rows.facets.agents ?? [],
      gameModes: [...queues.keys()].sort(),
      /** INVENTORY: every tracked mode (not a performance number). */
      teamOutcome: { matches: Number(rows.facets.outcome_matches ?? 0), wins: Number(rows.facets.outcome_wins ?? 0) },
      /** PERFORMANCE: Competitive only (mode-eligibility-policy-v1) — the Dashboard 小隊勝率. */
      competitiveTeamOutcome: (rows.facets.outcomes_by_queue ?? []).reduce((total, item) => (isAbsoluteStrengthMode(normalizeGameMode(item.queue_id, item.queue_name))
        ? { matches: total.matches + Number(item.matches), wins: total.wins + Number(item.wins) } : total), { matches: 0, wins: 0 }),
    } } : {}),
    /** mode-eligibility-policy-v1 aggregate counts (tracked matches with a start time); no identifiers. */
    modeEligibility: {
      policyVersion: MODE_ELIGIBILITY_POLICY_VERSION,
      competitiveMatches: [...queues].reduce((sum, [mode, matches]) => sum + (isAbsoluteStrengthMode(mode) ? matches : 0), 0),
      unratedMatches: [...queues].reduce((sum, [mode, matches]) => sum + (!isAbsoluteStrengthMode(mode) && isSameMatchRelativeMode(mode) ? matches : 0), 0),
      otherMatches: [...queues].reduce((sum, [mode, matches]) => sum + (isSameMatchRelativeMode(mode) ? 0 : matches), 0),
    },
    evidence: {
      season: {
        status: ratioStatus(withSeason, trackedMatchCount),
        /** Durable column coverage (TASK-DATA-SEASON-01); the UUID values themselves never leave the server. */
        matchesWithSeasonId: withSeasonIdColumn,
        matchesWithSeasonShort: withSeasonShortColumn,
        matchesWithAct: withSeason,
        matchesWithoutAct: trackedMatchCount - withSeason,
        seasonIdWithoutPublicAct: seasonIdOnly,
        unrecognizedSeasonCodes: unrecognizedSeason,
        currentActKnown: false as const,
        /** Highest observed Act key (最新有紀錄 Act); NOT a claim about Riot's current official Act. */
        ...(acts.size ? { latestRecordedAct: [...acts.keys()].sort(compareSeasonKeysDesc)[0] } : {}),
        acts: [...acts].sort((a, b) => compareSeasonKeysDesc(a[0], b[0])).map(([key, matches]) => ({ key, label: seasonLabel(key), matches })),
      },
      duration: { status: ratioStatus(withDuration, trackedMatchCount), matchesWithDuration: withDuration, matchesWithoutDuration: trackedMatchCount - withDuration },
      queues: [...queues].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([gameMode, matches]) => ({ gameMode, matches })),
      rank: {
        status: (rows.rankObservations === 0 ? 'unavailable' : 'partial') as ScopeStatus,
        observations: rows.rankObservations,
        reason: rows.rankObservations === 0 ? 'not_ingested' as const : 'not_tied_to_matches' as const,
      },
    },
    policies: Object.values(featureScopePolicies).map((policy) => ({
      feature: policy.feature, horizon: policy.horizon, queues: policy.queues, implementation: policy.implementation,
    })),
  };
}

export type AnalyticsContextPayload = ReturnType<typeof buildAnalyticsContext>;
