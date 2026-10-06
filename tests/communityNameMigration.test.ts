import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { MemberAdminService } from '../server/identity/memberAdminService';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { buildAnalytics } from '../src/data/analytics';
import { selectPerformances } from '../src/analytics/filters';
import { aggregateSelection } from '../src/analytics/rankings';
import { buildSynergy, defaultSynergyFilters } from '../src/synergy/analytics';
import { computeImprovementIndex } from '../src/analytics/progress/improvementIndex';
import { resolveProgressWindows } from '../src/analytics/progress/windows';
import { calculateRecentForm, groupByAgent, groupByMap } from '../src/analytics/analysis';

/**
 * TASK-IDENTITY-01B migration 0010 (one-time approved production data migration). Fixtures use the
 * approved Riot game names as they exist in production; every id here is fictional.
 */
const approved = JSON.parse(readFileSync(resolve('ops/community-names-2026-10-06.json'), 'utf8')) as { gameName: string; communityName: string }[];
const squadId = '00000000-0000-4000-8000-000000000001';
const open: PGlite[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

class PGliteDatabase implements SqlDatabase {
  constructor(readonly pg: PGlite) { open.push(pg); }
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.pg.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.pg.exec('BEGIN');
    try { const value = await work(this); await this.pg.exec('COMMIT'); return value; }
    catch (error) { await this.pg.exec('ROLLBACK'); throw error; }
  }
  async close(): Promise<void> { await this.pg.close(); }
}
const uuid = (kind: number, value: number) => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const hex = (value: number) => value.toString(16).padStart(64, '0');

/** A pre-0010 database (0001–0009) with one account per name, each in 3 usable matches (some shared). */
async function pre0010(names: string[]): Promise<PGliteDatabase> {
  const db = new PGliteDatabase(new PGlite());
  await applyMigrations(db, (await loadMigrations(resolve('migrations'))).slice(0, 9));
  await db.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3)', [squadId, 'friends', 'Friends']);
  for (const [index, name] of names.entries()) {
    const i = index + 1;
    await db.query('INSERT INTO players (id,public_id,display_name,display_tag) VALUES ($1,$2,$3,$4)', [uuid(1, i), uuid(2, i), name, `T${i}`]);
    await db.query('INSERT INTO squad_memberships (id,squad_id,player_id,status) VALUES ($1,$2,$3,$4)', [uuid(3, i), squadId, uuid(1, i), 'active']);
    await db.query('INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at) VALUES ($1,$2,$3,$4,$5,$6)', [uuid(4, i), uuid(1, i), 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00Z']);
    await db.query(`INSERT INTO provider_identities (id,player_id,provider,affinity,lookup_hmac) VALUES ($1,$2,'HenrikDev','ap',$3)`, [uuid(11, i), uuid(1, i), hex(500 + i)]);
    await db.query(`INSERT INTO sync_cursors (id,player_id,provider,affinity,sync_kind,next_start,retry_count) VALUES ($1,$2,'HenrikDev','ap','incremental',3,0)`, [uuid(12, i), uuid(1, i)]);
    await db.query(`INSERT INTO sync_runs (id,squad_id,player_id,provider,trigger_kind,status,started_at,completed_at,sync_kind) VALUES ($1,$2,$3,'HenrikDev','scheduled','complete',now(),now(),'incremental')`, [uuid(13, i), squadId, uuid(1, i)]);
  }
  let n = 0;
  for (const [index] of names.entries()) {
    for (let k = 0; k < 3; k += 1) {
      n += 1;
      const started = new Date(Date.UTC(2026, 9, 5, 12) - n * 3_600_000).toISOString();
      await db.query(`INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status,season_short)
        VALUES ($1,$2,'HenrikDev',$3,'v4','durable-evidence-v2','ap',$4,'competitive','Competitive',$5,2100000,$5,$5,$6,'observed','observed','e11a5')`, [uuid(5, n), squadId, hex(n), ['Ascent', 'Bind', 'Haven'][k], started, uuid(6, n)]);
      await db.query('INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost) VALUES ($1,$2,$3,$4,$5,$6)', [uuid(7, n), uuid(5, n), 'Blue', k !== 1, 13, 9]);
      await db.query(`INSERT INTO rounds (id,source_match_id,round_number,participants_evidence_status,plant_status,defuse_status) VALUES ($1,$2,1,'observed','missing','missing')`, [uuid(9, n), uuid(5, n)]);
      const seats = k === 2 && names.length > 1 ? [index + 1, ((index + 1) % names.length) + 1] : [index + 1];
      for (const [ordinal, account] of seats.entries()) {
        const pid = uuid(8, n * 4 + ordinal);
        await db.query(`INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots)
          VALUES ($1,$2,$3,$4,'Blue',$5,'observed',$6,12,4,4300,3100,9,20,3)`, [pid, uuid(5, n), uuid(1, account), hex(1_000_000 + n * 4 + ordinal), ['Jett', 'Sova'][ordinal], 10 + account + k]);
        await db.query(`INSERT INTO round_participants (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status) VALUES ($1,$2,$3,'observed','missing','missing','missing')`, [uuid(10, n * 4 + ordinal), uuid(9, n), pid]);
      }
    }
  }
  return db;
}
const gameNames = () => approved.map((entry) => entry.gameName);
const apply = async (db: SqlDatabase) => applyMigrations(db, await loadMigrations(resolve('migrations')));
const members = async (db: SqlDatabase) => (await db.query('SELECT * FROM members ORDER BY id')).rows;
const preserved = ['players', 'provider_identities', 'consents', 'sync_runs', 'sync_cursors', 'deletion_jobs', 'source_matches', 'match_participants', 'rounds', 'round_participants', 'kill_events', 'rank_observations', 'squad_memberships'];
const dump = async (db: SqlDatabase) => Object.fromEntries(await Promise.all(preserved.map(async (table) => [table, (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows] as const)));
const snapshot = async (db: SqlDatabase) => (await new DatasetProjectionService(new PostgresDatasetReadRepository(db)).read()).payload;

describe('migration 0010 approved community names', () => {
  it('keeps the SQL mapping identical to ops/community-names-2026-10-06.json', () => {
    const sql = readFileSync(resolve('migrations/0010_approved_community_names.sql'), 'utf8');
    const insert = sql.indexOf('INSERT INTO approved_community_names');
    const values = sql.slice(insert, sql.indexOf(';', insert));
    const pairs = [...values.matchAll(/\('([^']*)', '([^']*)'\)/gu)].map((match) => ({ gameName: match[1], communityName: match[2] }));
    expect(pairs).toEqual(approved);
    expect(approved).toHaveLength(9);
    const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/SET[^;]*\bnickname\s*=/iu);
    expect(code).not.toMatch(/UPDATE\s+players/iu);
    expect(code).not.toMatch(/\bLIKE\b|\bILIKE\b|lower\(|upper\(|similarity/iu);
  });

  it('assigns exactly the 9 approved names, leaves nicknames, ids, accounts and all evidence untouched, and keeps analytics numerically identical', async () => {
    const db = await pre0010(gameNames());
    await new MemberAdminService(db).setNickname(uuid(2, 4), '既有綽號');
    const beforeDump = await dump(db);
    const beforeMembers = await members(db);
    const before = await snapshot(db);
    expect(await apply(db)).toEqual(['0010']);
    expect(await apply(db)).toEqual([]);
    expect(await dump(db)).toEqual(beforeDump);
    const after = await members(db);
    expect(after.map((m) => [m.id, m.public_id, m.nickname, m.archived_at, m.default_emoji])).toEqual(beforeMembers.map((m) => [m.id, m.public_id, m.nickname, m.archived_at, m.default_emoji]));
    const names = (await db.query<{ game: string; name: string; source: string }>(
      'SELECT p.display_name AS game, m.display_name AS name, m.display_name_source AS source FROM players p JOIN members m ON m.id=p.member_id ORDER BY p.id')).rows;
    expect(names).toEqual(approved.map((entry) => ({ game: entry.gameName, name: entry.communityName, source: 'community' })));
    expect(names.map((row) => row.name)).toEqual(['小麻花', 'jack', '天堂', '魔王', '夏天', '加分', '走路', '滑板車', '滑鏟']);
    // The pre-existing nickname survives; no nickname is created.
    expect(after.filter((m) => m.nickname !== null).map((m) => m.nickname)).toEqual(['既有綽號']);

    const later = await snapshot(db);
    expect(later.dataset.matches).toEqual(before.dataset.matches);
    expect(later.dataset.players.map((p) => [p.id, p.accounts])).toEqual(before.dataset.players.map((p) => [p.id, p.accounts]));
    const noNames = (value: unknown) => JSON.stringify(value, (key, item) => (['handle', 'displayName', 'nameSource', 'nickname'].includes(key) ? undefined : item));
    const numbers = (payload: typeof before) => {
      const analytics = buildAnalytics(payload.dataset);
      const out: string[] = [];
      for (const period of ['all', 'current', 'recent10', 'recent30', 'act'] as const) {
        const filters = { playerId: 'all', period, map: 'all', agent: 'all', role: 'all' as const, gameMode: 'all', minMatches: 0, minRounds: 0, ...(period === 'act' ? { act: 'e11a5' } : {}) };
        out.push(...aggregateSelection(selectPerformances(analytics.performanceEntries, filters, { population: analytics.population })).map((row) => noNames([period, row.player.id, row.stats, row.scores])).sort());
      }
      for (const player of analytics.activeDataset.players) {
        const entries = analytics.performanceEntries.filter((entry) => entry.playerId === player.id);
        out.push(noNames([player.id, calculateRecentForm(player, entries, analytics.population), computeImprovementIndex(player, resolveProgressWindows(entries, analytics.population)), groupByMap(entries), groupByAgent(entries)]));
      }
      out.push(noNames(buildSynergy(payload.dataset, defaultSynergyFilters).map((r) => [r.pair.key, r.status, r.value ?? null, r.sharedSample.matches])));
      return out;
    };
    expect(numbers(later)).toEqual(numbers(before));
    // Future edits are never reset: the ledger records 0010 once.
    await new MemberAdminService(db).renameMember(uuid(2, 1), '後來改名');
    expect(await apply(db)).toEqual([]);
    expect((await db.query('SELECT display_name FROM members WHERE id=$1', [uuid(1, 1)])).rows).toEqual([{ display_name: '後來改名' }]);
  }, 60_000);

  it('is safe when a member already carries exactly the approved community name', async () => {
    const db = await pre0010(gameNames());
    await new MemberAdminService(db).renameMember(uuid(2, 2), 'jack');
    expect(await apply(db)).toEqual(['0010']);
    expect((await db.query('SELECT count(*)::int AS n FROM members WHERE display_name_source=$1', ['community'])).rows).toEqual([{ n: 9 }]);
  }, 60_000);

  it('is a recorded no-op on databases that are not the production identity set (none of the approved names)', async () => {
    const empty = await pre0010([]);
    expect(await apply(empty)).toEqual(['0010']);
    const other = await pre0010(['FictionalA', 'FictionalB']);
    const before = await members(other);
    expect(await apply(other)).toEqual(['0010']);
    expect(await members(other)).toEqual(before);
  }, 60_000);

  const refusals: [string, () => Promise<PGliteDatabase>][] = [
    ['only 8 members', () => pre0010(gameNames().slice(0, 8))],
    ['10 members', () => pre0010([...gameNames(), 'FictionalExtra'])],
    ['a missing approved game name', () => pre0010([...gameNames().slice(0, 8), 'FictionalRenamed'])],
    ['a duplicate account game name', () => pre0010([...gameNames().slice(0, 8), gameNames()[0]!])],
    ['one member owning 2 accounts', async () => { const db = await pre0010(gameNames()); await new MemberAdminService(db).linkAccount(uuid(2, 9), uuid(2, 1)).catch(async () => { await db.query('UPDATE players SET member_id=$1, is_primary_account=false WHERE id=$2', [uuid(1, 1), uuid(1, 9)]); await db.query('UPDATE members SET archived_at=now() WHERE id=$1', [uuid(1, 9)]); }); return db; }],
    ['an anonymized matched account', async () => { const db = await pre0010(gameNames()); await db.query('UPDATE players SET anonymized_at=now() WHERE id=$1', [uuid(1, 3)]); return db; }],
    ['an archived matched member', async () => { const db = await pre0010(gameNames()); await db.query('UPDATE members SET archived_at=now() WHERE id=$1', [uuid(1, 5)]); return db; }],
    ['a same-match member collision', async () => { const db = await pre0010(gameNames()); await db.query('UPDATE players SET member_id=$1, is_primary_account=false WHERE id=$2', [uuid(1, 1), uuid(1, 2)]); return db; }],
    ['a different pre-existing community name', async () => { const db = await pre0010(gameNames()); await new MemberAdminService(db).renameMember(uuid(2, 6), '別的名字'); return db; }],
    ['two approved names resolving to one member', async () => { const db = await pre0010(gameNames()); await db.query('UPDATE players SET member_id=$1, is_primary_account=false WHERE id=$2', [uuid(1, 7), uuid(1, 8)]); await db.query('UPDATE members SET archived_at=now() WHERE id=$1', [uuid(1, 8)]); return db; }],
  ];
  it.each(refusals)('fails closed with zero name changes: %s', async (_label, build) => {
    const db = await build();
    const beforeMembers = await members(db);
    const beforeDump = await dump(db);
    await expect(apply(db)).rejects.toThrow(/IDENTITY-01B/u);
    expect(await members(db)).toEqual(beforeMembers);
    expect(await dump(db)).toEqual(beforeDump);
    expect((await db.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version='0010'")).rows).toEqual([{ n: 0 }]);
  }, 60_000);
});
