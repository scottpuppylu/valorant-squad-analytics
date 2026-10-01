import type { SqlDatabase } from '../db/types.js';
import type {
  DatasetCoverageRow,
  DatasetEventRow,
  DatasetPerformanceRow,
  DatasetPlayerRow,
  DatasetProjectionRows,
  DatasetReadRepository,
  DatasetRoundParticipantRow,
  DatasetRoundRow,
} from './types.js';

const activePlayers = `
  SELECT p.id, p.public_id, p.display_name, p.display_tag, p.default_emoji
  FROM players p
  WHERE p.anonymized_at IS NULL
    AND EXISTS (SELECT 1 FROM consents c WHERE c.player_id=p.id AND c.status='active')
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

export class PostgresDatasetReadRepository implements DatasetReadRepository {
  constructor(private readonly database: SqlDatabase) {}

  async readProjectionRows(windowSize: number): Promise<DatasetProjectionRows> {
    const started = performance.now();
    let sqlQueryCount = 0;
    const query = async <Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      sqlQueryCount += 1;
      return this.database.query<Row>(sql, params);
    };

    const [players, performances, rounds, roundParticipants, events, coverage] = await Promise.all([
      query<DatasetPlayerRow>(`SELECT id AS internal_player_id, public_id, display_name, display_tag, default_emoji
        FROM (${activePlayers}) active_player_rows ORDER BY public_id`),
      query<DatasetPerformanceRow>(`${eligibleMatches}
        SELECT sm.id AS internal_match_id, sm.public_id AS public_match_id, sm.started_at, sm.map_name,
               sm.queue_id, sm.queue_name, sm.game_length_ms,
               mp.id AS internal_participant_id, mp.player_id AS internal_player_id, mp.team_key,
               mp.agent_name, mp.stats_evidence_status, mp.kills, mp.deaths, mp.assists, mp.score,
               mp.damage_dealt, mp.headshots, mp.bodyshots, mp.legshots,
               mt.won AS team_won, mt.rounds_won, mt.rounds_lost
        FROM eligible_matches em
        JOIN source_matches sm ON sm.id=em.id
        JOIN match_participants mp ON mp.source_match_id=sm.id
        JOIN active_players ap ON ap.id=mp.player_id
        LEFT JOIN match_teams mt ON mt.source_match_id=sm.id AND mt.team_key=mp.team_key
        ORDER BY sm.started_at DESC NULLS LAST, sm.id, ap.public_id`, [windowSize]),
      query<DatasetRoundRow>(`${eligibleMatches}
        SELECT r.source_match_id AS internal_match_id, r.id AS internal_round_id, r.round_number
        FROM eligible_matches em JOIN rounds r ON r.source_match_id=em.id
        ORDER BY r.source_match_id, r.round_number`, [windowSize]),
      query<DatasetRoundParticipantRow>(`${eligibleMatches}
        SELECT rp.round_id AS internal_round_id, rp.match_participant_id AS internal_participant_id
        FROM eligible_matches em
        JOIN rounds r ON r.source_match_id=em.id
        JOIN round_participants rp ON rp.round_id=r.id
        JOIN match_participants mp ON mp.id=rp.match_participant_id
        JOIN active_players ap ON ap.id=mp.player_id
        WHERE rp.present IS TRUE`, [windowSize]),
      query<DatasetEventRow>(`${eligibleMatches}
        SELECT ke.source_match_id AS internal_match_id, ke.round_id AS internal_round_id,
               ke.event_sequence, ke.time_in_round_ms,
               ke.killer_participant_id, ke.victim_participant_id,
               killer.team_key AS killer_team_key,
               ka.match_participant_id AS assistant_participant_id
        FROM eligible_matches em
        JOIN kill_events ke ON ke.source_match_id=em.id
        JOIN match_participants killer ON killer.id=ke.killer_participant_id
        LEFT JOIN kill_assistants ka ON ka.kill_event_id=ke.id
        ORDER BY ke.round_id, ke.time_in_round_ms, ke.event_sequence`, [windowSize]),
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
      sqlQueryCount,
      databaseMs: Math.round((performance.now() - started) * 100) / 100,
    };
  }
}
