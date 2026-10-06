import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, loadMigrations } from '../../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../../server/db/types';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../../shared/privacyPolicy';

/** Disposable durable-evidence fixtures (shared with tests/serverAnalysis.test.ts semantics). */
export const squadId = '00000000-0000-4000-8000-000000000001';
export const open: PGlite[] = [];
export async function closeAll() { while (open.length) await open.pop()!.close(); }

export class PGliteDatabase implements SqlDatabase {
  hook?: (sql: string) => Promise<void>;
  constructor(readonly pg: PGlite) { open.push(pg); }
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.pg.query<Row>(sql, params);
    // Test hook simulates a concurrent write right after the phase-1 observation statement.
    if (this.hook && sql.includes('first_team_key')) { const hook = this.hook; this.hook = undefined; await hook(sql); }
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.pg.exec('BEGIN');
    try { const value = await work(this); await this.pg.exec('COMMIT'); return value; }
    catch (error) { await this.pg.exec('ROLLBACK'); throw error; }
  }
  async close(): Promise<void> { await this.pg.close(); }
}

export async function database(): Promise<PGliteDatabase> {
  const db = new PGliteDatabase(new PGlite());
  await applyMigrations(db, await loadMigrations(resolve('migrations')));
  return db;
}

export const uuid = (kind: number, value: number) => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
export const hex = (value: number) => value.toString(16).padStart(64, '0');
export function placeholders(rows: number, width: number): string {
  let index = 1;
  return Array.from({ length: rows }, () => `(${Array.from({ length: width }, () => `$${index++}`).join(',')})`).join(',');
}
export async function insertRows(db: SqlDatabase, sql: string, rows: unknown[][], width: number) {
  const chunk = Math.floor(30_000 / width);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    if (slice.length) await db.query(`${sql} VALUES ${placeholders(slice.length, width)}`, slice.flat());
  }
}

export interface Seat { player: number; team?: 'Blue' | 'Red'; agent?: string; kills?: number }
export interface Spec { n: number; hoursAgo: number; seats: Seat[]; queue?: string; season?: string | null; map?: string; rounds?: number }
export const anchor = Date.UTC(2026, 9, 5, 12);

export async function seedPlayers(db: SqlDatabase, count: number) {
  await db.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3)', [squadId, 'friends', 'Friends']);
  const players = Array.from({ length: count }, (_, i) => [uuid(1, i + 1), uuid(2, i + 1), `Player${i + 1}`, 'T', '🐺']);
  await insertRows(db, 'INSERT INTO players (id,public_id,display_name,display_tag,default_emoji)', players, 5);
  await insertRows(db, 'INSERT INTO squad_memberships (id,squad_id,player_id,status)', players.map((p, i) => [uuid(3, i + 1), squadId, p[0], 'active']), 4);
  await insertRows(db, 'INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at)', players.map((p, i) => [uuid(4, i + 1), p[0], 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00Z']), 6);
}

export async function seedMatches(db: SqlDatabase, specs: Spec[]) {
  const matches: unknown[][] = []; const teams: unknown[][] = []; const parts: unknown[][] = []; const rounds: unknown[][] = []; const presences: unknown[][] = [];
  for (const s of specs) {
    const started = new Date(anchor - s.hoursAgo * 3_600_000).toISOString();
    const roundCount = s.rounds ?? 2;
    matches.push([uuid(5, s.n), squadId, 'HenrikDev', hex(s.n), 'v4', 'durable-evidence-v2', 'ap', s.map ?? 'Ascent', s.queue ?? 'competitive', s.queue ?? 'Competitive', started, 2_100_000, started, started, uuid(6, s.n), 'observed', 'observed', s.season === undefined ? 'e11a5' : s.season]);
    teams.push([uuid(7, s.n * 2), uuid(5, s.n), 'Blue', true, 13, 9], [uuid(7, s.n * 2 + 1), uuid(5, s.n), 'Red', false, 9, 13]);
    for (let r = 1; r <= roundCount; r += 1) rounds.push([uuid(9, s.n * 4 + r), uuid(5, s.n), r, 'observed', 'missing', 'missing']);
    for (const seat of s.seats) {
      const pid = uuid(8, s.n * 16 + seat.player);
      parts.push([pid, uuid(5, s.n), uuid(1, seat.player), hex(1_000_000 + s.n * 16 + seat.player), seat.team ?? 'Blue', seat.agent ?? 'Jett', 'observed', seat.kills ?? 15 + (s.n % 7), 12, 4, 4200 + (s.n % 11) * 90, 3000 + (s.n % 13) * 70, 9, 20, 3]);
      for (let r = 1; r <= roundCount; r += 1) presences.push([uuid(10, (s.n * 16 + seat.player) * 4 + r), uuid(9, s.n * 4 + r), pid, 'observed', 'missing', 'missing', 'missing']);
    }
  }
  await insertRows(db, 'INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status,season_short)', matches, 18);
  await insertRows(db, 'INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost)', teams, 6);
  await insertRows(db, 'INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots)', parts, 15);
  await insertRows(db, 'INSERT INTO rounds (id,source_match_id,round_number,participants_evidence_status,plant_status,defuse_status)', rounds, 6);
  await insertRows(db, 'INSERT INTO round_participants (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status)', presences, 7);
}

