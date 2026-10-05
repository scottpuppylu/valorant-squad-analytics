import type { SqlDatabase } from '../db/types.js';
import { PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION } from '../../shared/privacyPolicy.js';
import { featureScopePolicies } from '../../src/analytics/scope/policies.js';
import { compareSeasonKeysDesc, normalizeSeasonKey, seasonLabel } from '../../src/analytics/scope/season.js';
import type { ScopeStatus } from '../../src/analytics/scope/types.js';
import { ADAPTIVE_WINDOW_VERSION, ANALYSIS_SCOPE_VERSION, ANALYTICS_CONTEXT_VERSION, FEATURE_SCOPE_POLICY_VERSION } from '../../src/analytics/scope/versions.js';
import { normalizeGameMode } from '../../src/utils/gameMode.js';
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

export interface AnalyticsContextRows {
  groups: ContextGroupRow[];
  rankObservations: number;
  sqlQueryCount: number;
}

export class PostgresAnalyticsContextRepository {
  constructor(private readonly database: SqlDatabase) {}

  /** Two aggregate statements; no identifiers, no per-match rows. */
  async readContextRows(): Promise<AnalyticsContextRows> {
    const [groups, rank] = await Promise.all([
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
    ]);
    return { groups: groups.rows, rankObservations: Number(rank.rows[0]?.observations ?? 0), sqlQueryCount: 2 };
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
  const acts = new Map<string, number>();
  const queues = new Map<string, number>();
  for (const group of rows.groups) {
    const matches = Number(group.matches);
    eligibleMatches += matches;
    if (!group.has_start) continue;
    trackedMatchCount += matches;
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
      snapshotWindow: datasetWindowSize,
      /** True when the newest-300 snapshot holds every eligible tracked match. */
      snapshotCoversTrackedHistory: eligibleMatches <= datasetWindowSize,
      lifetimeComplete: false as const,
    },
    evidence: {
      season: {
        status: ratioStatus(withSeason, trackedMatchCount),
        matchesWithAct: withSeason,
        matchesWithoutAct: trackedMatchCount - withSeason,
        seasonIdWithoutPublicAct: seasonIdOnly,
        unrecognizedSeasonCodes: unrecognizedSeason,
        currentActKnown: false as const,
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
