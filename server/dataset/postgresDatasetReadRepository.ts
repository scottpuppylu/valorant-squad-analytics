import type { SqlDatabase } from '../db/types.js';
import type {
  DatasetCoverageRow,
  DatasetEventRow,
  DatasetHistoryKey,
  DatasetHistoryKeyRow,
  DatasetHistoryPageRequest,
  DatasetHistoryPageRows,
  DatasetPerformanceRow,
  DatasetPlayerRow,
  DatasetProjectionRows,
  DatasetReadRepository,
  DatasetRoundParticipantRow,
  DatasetRoundRow,
} from './types.js';
import { PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION } from '../../shared/privacyPolicy.js';

export const activePlayers = `
  SELECT p.id, p.public_id, p.display_name, p.display_tag, p.default_emoji
  FROM players p
  WHERE p.anonymized_at IS NULL
    AND (SELECT count(*) FROM consents c WHERE c.player_id=p.id AND c.status='active') = 1
    AND EXISTS (
      SELECT 1 FROM consents c
      WHERE c.player_id=p.id AND c.status='active'
        AND c.consent_method='${PUBLIC_DATASET_CONSENT_METHOD}'
        AND c.privacy_version='${PUBLIC_DATASET_PRIVACY_VERSION}'
    )
    AND EXISTS (SELECT 1 FROM squad_memberships sm WHERE sm.player_id=p.id AND sm.status='active')`;

const eligibleMatches = `
  WITH active_players AS (${activePlayers}),
  eligible_matches AS (
    SELECT DISTINCT sm.id, sm.started_at
    FROM source_matches sm
    JOIN match_participants mp ON mp.source_match_id=sm.id
    JOIN active_players ap ON ap.id=mp.player_id
    ORDER BY sm.started_at DESC NULLS LAST, sm.id
    LIMIT $1
  )`;

/** Exact microsecond timestamp from a validated decimal string parameter. */
const microsParameter = (index: number) => `(timestamptz 'epoch' + $${index}::bigint * interval '1 microsecond')`;
const microsText = (column: string) => `(extract(epoch FROM ${column}) * 1000000)::bigint::text`;

/**
 * Phase 1 (DATA-03B.1): page keys plus tracked-history summary in one statement.
 * Visibility is the CURRENT active-player set; a cursor is only a position.
 * $1 = pageSize + 1; $2/$3 = exclusive cursor bound; $4 = `before` public match anchor.
 * Matches without a start time are never projectable and are excluded from history.
 */
const historyKeys = `
  WITH active_players AS (${activePlayers}),
  eligible AS (
    SELECT DISTINCT sm.started_at, sm.public_id
    FROM source_matches sm
    JOIN match_participants mp ON mp.source_match_id=sm.id
    JOIN active_players ap ON ap.id=mp.player_id
    WHERE sm.started_at IS NOT NULL
  ),
  bound AS (
    SELECT ${microsParameter(2)} AS started_at, $3::uuid AS public_id WHERE $2::bigint IS NOT NULL
    UNION ALL
    SELECT e.started_at, e.public_id FROM eligible e WHERE $4::uuid IS NOT NULL AND e.public_id=$4::uuid
  ),
  page_keys AS (
    SELECT e.started_at, e.public_id
    FROM eligible e
    LEFT JOIN (SELECT started_at, public_id FROM bound LIMIT 1) b ON true
    WHERE b.started_at IS NULL OR (e.started_at, e.public_id) < (b.started_at, b.public_id)
    ORDER BY e.started_at DESC, e.public_id DESC
    LIMIT $1
  ),
  summary AS (
    SELECT count(*)::int AS tracked_match_count,
           min(started_at) AS earliest_started_at,
           max(started_at) AS latest_started_at,
           (SELECT count(*)::int FROM bound) AS bound_count,
           (SELECT ${microsText('started_at')} FROM bound LIMIT 1) AS bound_started_us,
           (SELECT public_id::text FROM bound LIMIT 1) AS bound_public_id,
           (SELECT max(sc.last_success_at) FROM sync_cursors sc JOIN active_players ap ON ap.id=sc.player_id) AS last_synced_at
    FROM eligible
  )
  SELECT s.*,
         ${microsText('pk.started_at')} AS key_started_us,
         pk.public_id::text AS key_public_id,
         pk.started_at AS key_started_at
  FROM summary s
  LEFT JOIN page_keys pk ON true
  ORDER BY pk.started_at DESC NULLS LAST, pk.public_id DESC`;

/**
 * Phase 2: the key RANGE established by phase 1, never an internal ID list. $1/$2 = inclusive
 * oldest page key; $3/$4 = exclusive upper bound, or NULL for the newest page. A match
 * inserted inside the range between phases is included rather than skipped.
 */
const historyRange = `
  WITH active_players AS (${activePlayers}),
  eligible_matches AS (
    SELECT DISTINCT sm.id, sm.started_at
    FROM source_matches sm
    JOIN match_participants mp ON mp.source_match_id=sm.id
    JOIN active_players ap ON ap.id=mp.player_id
    WHERE sm.started_at IS NOT NULL
      AND (sm.started_at, sm.public_id) >= (${microsParameter(1)}, $2::uuid)
      AND ($3::bigint IS NULL OR (sm.started_at, sm.public_id) < (${microsParameter(3)}, $4::uuid))
  )`;

export type Query = <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;

export function detailQueries(query: Query, cte: string, params: unknown[]) {
  return [
    query<DatasetPerformanceRow>(`${cte}
        SELECT sm.id AS internal_match_id, sm.public_id AS public_match_id, sm.started_at, sm.map_name,
               sm.queue_id, sm.queue_name, sm.game_length_ms, sm.season_short,
               mp.id AS internal_participant_id, mp.player_id AS internal_player_id, mp.team_key,
               mp.agent_name, mp.stats_evidence_status, mp.kills, mp.deaths, mp.assists, mp.score,
               mp.damage_dealt, mp.headshots, mp.bodyshots, mp.legshots,
               sm.normalization_version, sm.rounds_evidence_status, sm.kills_evidence_status,
               mp.ability_evidence_status, mp.ability_1_casts, mp.ability_2_casts,
               mp.grenade_casts, mp.ultimate_casts,
               mp.economy_evidence_status, mp.loadout_value_total, mp.loadout_value_average,
               mp.spent_total, mp.spent_average,
               mt.won AS team_won, mt.rounds_won, mt.rounds_lost
        FROM eligible_matches em
        JOIN source_matches sm ON sm.id=em.id
        JOIN match_participants mp ON mp.source_match_id=sm.id
        JOIN active_players ap ON ap.id=mp.player_id
        LEFT JOIN match_teams mt ON mt.source_match_id=sm.id AND mt.team_key=mp.team_key
        ORDER BY sm.started_at DESC NULLS LAST, sm.id, ap.public_id`, params),
    query<DatasetRoundRow>(`${cte}
        SELECT r.source_match_id AS internal_match_id, r.id AS internal_round_id, r.round_number,
               r.winning_team, r.participants_evidence_status, r.plant_status,
               r.plant_participant_id, r.defuse_status, r.defuse_participant_id
        FROM eligible_matches em JOIN rounds r ON r.source_match_id=em.id
        ORDER BY r.source_match_id, r.round_number`, params),
    query<DatasetRoundParticipantRow>(`${cte}
        SELECT rp.round_id AS internal_round_id, rp.match_participant_id AS internal_participant_id,
               mp.team_key, rp.present
        FROM eligible_matches em
        JOIN rounds r ON r.source_match_id=em.id
        JOIN round_participants rp ON rp.round_id=r.id
        JOIN match_participants mp ON mp.id=rp.match_participant_id
        WHERE rp.present IS TRUE`, params),
    query<DatasetEventRow>(`${cte}
        SELECT ke.source_match_id AS internal_match_id, ke.round_id AS internal_round_id,
               ke.event_sequence, ke.time_in_round_ms,
               ke.killer_participant_id, ke.victim_participant_id,
               killer.team_key AS killer_team_key,
               ka.match_participant_id AS assistant_participant_id
        FROM eligible_matches em
        JOIN kill_events ke ON ke.source_match_id=em.id
        JOIN match_participants killer ON killer.id=ke.killer_participant_id
        LEFT JOIN kill_assistants ka ON ka.kill_event_id=ke.id
        ORDER BY ke.round_id, ke.time_in_round_ms, ke.event_sequence`, params),
  ] as const;
}

export const playersQuery = `SELECT id AS internal_player_id, public_id, display_name, display_tag, default_emoji
        FROM (${activePlayers}) active_player_rows ORDER BY public_id`;

/** DATA-03B.2B phase 2: exactly the server-selected internal match ids (never exposed). */
export const selectedMatches = `
  WITH active_players AS (${activePlayers}),
  eligible_matches AS (
    SELECT DISTINCT sm.id, sm.started_at
    FROM source_matches sm
    JOIN match_participants mp ON mp.source_match_id=sm.id
    JOIN active_players ap ON ap.id=mp.player_id
    WHERE sm.id = ANY($1::uuid[])
  )`;

export class PostgresDatasetReadRepository implements DatasetReadRepository {
  constructor(private readonly database: SqlDatabase) {}

  private counter() {
    const state = { sqlQueryCount: 0, started: performance.now() };
    const query: Query = async <Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      state.sqlQueryCount += 1;
      return this.database.query<Row>(sql, params);
    };
    return { query, state, elapsed: () => Math.round((performance.now() - state.started) * 100) / 100 };
  }

  async readProjectionRows(windowSize: number): Promise<DatasetProjectionRows> {
    const { query, state, elapsed } = this.counter();
    const [players, [performances, rounds, roundParticipants, events], coverage] = await Promise.all([
      query<DatasetPlayerRow>(playersQuery),
      Promise.all(detailQueries(query, eligibleMatches, [windowSize])),
      query<DatasetCoverageRow>(`WITH active_players AS (${activePlayers})
        SELECT min(sc.coverage_from) AS coverage_from,
               max(sc.coverage_to) AS coverage_to,
               max(sc.last_success_at) AS last_synced_at,
               bool_and(sc.coverage_complete_for_provider_window) AS complete_for_provider_window
        FROM sync_cursors sc JOIN active_players ap ON ap.id=sc.player_id`),
    ]);

    return {
      players: players.rows,
      performances: performances.rows,
      rounds: rounds.rows,
      roundParticipants: roundParticipants.rows,
      events: events.rows,
      coverage: coverage.rows[0] ?? null,
      sqlQueryCount: state.sqlQueryCount,
      databaseMs: elapsed(),
    };
  }

  /** At most six statements in two round trips: key/summary, then five parallel range reads. */
  async readHistoryPage(request: DatasetHistoryPageRequest): Promise<DatasetHistoryPageRows> {
    const { query, state, elapsed } = this.counter();
    const { start, pageSize } = request;
    const keyRows = (await query<DatasetHistoryKeyRow>(historyKeys, [
      pageSize + 1,
      start.kind === 'cursor' ? start.key.startedAtMicros : null,
      start.kind === 'cursor' ? start.key.publicMatchId : null,
      start.kind === 'before' ? start.publicMatchId : null,
    ])).rows;
    const summary = keyRows[0];
    const keys = keyRows.flatMap((row) => (row.key_started_us !== null && row.key_public_id !== null && row.key_started_at !== null
      ? [{ key: { startedAtMicros: row.key_started_us, publicMatchId: row.key_public_id }, startedAt: row.key_started_at }]
      : []));
    const startFound = start.kind !== 'before' || summary?.bound_count === 1;
    const oldest = keys.slice(0, pageSize).at(-1)?.key;
    const upper: DatasetHistoryKey | undefined = summary?.bound_started_us && summary.bound_public_id
      ? { startedAtMicros: summary.bound_started_us, publicMatchId: summary.bound_public_id }
      : undefined;
    let rows: DatasetHistoryPageRows['rows'] = { players: [], performances: [], rounds: [], roundParticipants: [], events: [] };
    if (startFound && oldest) {
      const params = [oldest.startedAtMicros, oldest.publicMatchId, upper?.startedAtMicros ?? null, upper?.publicMatchId ?? null];
      const [players, [performances, rounds, roundParticipants, events]] = await Promise.all([
        query<DatasetPlayerRow>(playersQuery),
        Promise.all(detailQueries(query, historyRange, params)),
      ]);
      rows = { players: players.rows, performances: performances.rows, rounds: rounds.rows, roundParticipants: roundParticipants.rows, events: events.rows };
    } else if (startFound) {
      rows = { ...rows, players: (await query<DatasetPlayerRow>(playersQuery)).rows };
    }
    return {
      startFound,
      trackedMatchCount: Number(summary?.tracked_match_count ?? 0),
      earliestStartedAt: summary?.earliest_started_at ?? null,
      latestStartedAt: summary?.latest_started_at ?? null,
      lastSyncedAt: summary?.last_synced_at ?? null,
      keys,
      rows,
      sqlQueryCount: state.sqlQueryCount,
      databaseMs: elapsed(),
    };
  }
}
