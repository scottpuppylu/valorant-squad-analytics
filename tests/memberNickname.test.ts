import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { ServerAnalysisService, type AnalysisRequest } from '../server/dataset/analysisService';
import { MemberAdminService, validateNickname, type CommunityNameMapping } from '../server/identity/memberAdminService';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { isDatasetHistoryResponse, isDatasetResponse } from '../src/dataSources/server/datasetContract';
import { isDatasetAnalysisResponse } from '../src/dataSources/server/analysisResult';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import { buildAnalytics } from '../src/data/analytics';
import { selectPerformances } from '../src/analytics/filters';
import { aggregateSelection } from '../src/analytics/rankings';

const hmacKey = 'test-nickname-hmac-key-with-at-least-32-bytes';
const squadId = '00000000-0000-4000-8000-000000000001';
const open: PGlite[] = [];
afterEach(async () => { vi.restoreAllMocks(); while (open.length) await open.pop()!.close(); });

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
async function database(upTo?: number): Promise<PGliteDatabase> {
  const db = new PGliteDatabase(new PGlite());
  const migrations = await loadMigrations(resolve('migrations'));
  await applyMigrations(db, upTo === undefined ? migrations : migrations.slice(0, upTo));
  return db;
}
const uuid = (kind: number, value: number) => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const hex = (value: number) => value.toString(16).padStart(64, '0');

/** Fictional accounts (legacy insert → 0008 trigger makes 1:1 members) with one usable match each. */
async function seed(db: SqlDatabase, names: string[]) {
  await db.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3)', [squadId, 'friends', 'Friends']);
  for (const [index, name] of names.entries()) {
    const i = index + 1;
    const started = new Date(Date.UTC(2026, 9, 5, 12) - i * 3_600_000).toISOString();
    await db.query('INSERT INTO players (id,public_id,display_name,display_tag) VALUES ($1,$2,$3,$4)', [uuid(1, i), uuid(2, i), name, `T${i}`]);
    await db.query('INSERT INTO squad_memberships (id,squad_id,player_id,status) VALUES ($1,$2,$3,$4)', [uuid(3, i), squadId, uuid(1, i), 'active']);
    await db.query('INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at) VALUES ($1,$2,$3,$4,$5,$6)', [uuid(4, i), uuid(1, i), 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00Z']);
    await db.query(`INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status,season_short)
      VALUES ($1,$2,'HenrikDev',$3,'v4','durable-evidence-v2','ap','Ascent','competitive','Competitive',$4,2100000,$4,$4,$5,'observed','observed','e11a5')`, [uuid(5, i), squadId, hex(i), started, uuid(6, i)]);
    await db.query('INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost) VALUES ($1,$2,$3,$4,$5,$6)', [uuid(7, i), uuid(5, i), 'Blue', true, 13, 9]);
    await db.query(`INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots)
      VALUES ($1,$2,$3,$4,'Blue','Jett','observed',$5,12,4,4300,3100,9,20,3)`, [uuid(8, i), uuid(5, i), uuid(1, i), hex(1_000_000 + i), 10 + i]);
    await db.query(`INSERT INTO rounds (id,source_match_id,round_number,participants_evidence_status,plant_status,defuse_status) VALUES ($1,$2,1,'observed','missing','missing')`, [uuid(9, i), uuid(5, i)]);
    await db.query(`INSERT INTO round_participants (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status) VALUES ($1,$2,$3,'observed','missing','missing','missing')`, [uuid(10, i), uuid(9, i), uuid(8, i)]);
  }
}
const snapshot = async (db: SqlDatabase) => (await new DatasetProjectionService(new PostgresDatasetReadRepository(db)).read()).payload;
const fictional = ['FictionalSky', 'fictional5487', 'Fictional ü Plus'];
const mapping: CommunityNameMapping[] = [
  { gameName: 'FictionalSky', communityName: '測試甲' },
  { gameName: ' fictional5487 ', communityName: 'tester' },
  { gameName: 'Fictional ü Plus', communityName: '測試丙' },
];

describe('migration 0009 member nickname', () => {
  it('adds a NULL nickname without changing members, accounts or account-scoped evidence; reapply is a no-op', async () => {
    const db = await database(8);
    await seed(db, fictional);
    await new MemberAdminService(db).renameMember(uuid(2, 1), '測試甲');
    const tables = ['members', 'players', 'consents', 'sync_cursors', 'sync_runs', 'match_participants', 'source_matches'];
    const dump = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await db.query(`SELECT * FROM ${t} ORDER BY id`)).rows] as const)));
    const before = await dump();
    expect(await applyMigrations(db, await loadMigrations(resolve('migrations')))).toEqual(['0009', '0010']);
    expect(await applyMigrations(db, await loadMigrations(resolve('migrations')))).toEqual([]);
    const after = await dump();
    for (const table of tables.filter((t) => t !== 'members')) expect(after[table], table).toEqual(before[table]);
    expect(after.members!.map(({ nickname, ...rest }) => { expect(nickname).toBeNull(); return rest; })).toEqual(before.members);
    await expect(db.query("UPDATE members SET nickname='' WHERE id=$1", [uuid(1, 1)])).rejects.toThrow();
    await expect(db.query("UPDATE members SET nickname=' x' WHERE id=$1", [uuid(1, 1)])).rejects.toThrow();
  });
});

describe('nickname validation and administration', () => {
  it('normalizes empty to null and accepts Unicode up to 32 visible characters', () => {
    for (const empty of [null, undefined, '', '   ']) expect(validateNickname(empty)).toBeNull();
    for (const ok of ['麻花', '小天堂', 'Jack哥', 'ü王', '  麻花哥  ', 'あ'.repeat(32)]) expect(validateNickname(ok)).toBe(ok.trim());
    for (const bad of ['a\tb', 'a\nb', 'x\u0000', 'z​', 'あ'.repeat(33), '\t']) expect(() => validateNickname(bad)).toThrow();
  });

  it('set / clear nickname change only the nickname; rename keeps working; archived and missing members are refused', async () => {
    const db = await database();
    await seed(db, fictional);
    const admin = new MemberAdminService(db);
    const players = async () => (await db.query('SELECT * FROM players ORDER BY id')).rows;
    const beforePlayers = await players();
    expect(await admin.setNickname(uuid(2, 1), '  麻花哥 ')).toEqual({ memberId: uuid(2, 1), nickname: '麻花哥' });
    await admin.renameMember(uuid(2, 1), '測試甲');
    let member = (await db.query('SELECT id, public_id, display_name, display_name_source, nickname FROM members WHERE id=$1', [uuid(1, 1)])).rows[0];
    expect(member).toEqual({ id: uuid(1, 1), public_id: uuid(2, 1), display_name: '測試甲', display_name_source: 'community', nickname: '麻花哥' });
    expect(await admin.setNickname(uuid(2, 1), '   ')).toEqual({ memberId: uuid(2, 1), nickname: null });
    await admin.setNickname(uuid(2, 1), 'Nova');
    expect(await admin.clearNickname(uuid(2, 1))).toEqual({ memberId: uuid(2, 1), nickname: null });
    member = (await db.query('SELECT nickname FROM members WHERE id=$1', [uuid(1, 1)])).rows[0];
    expect(member).toEqual({ nickname: null });
    expect(await players()).toEqual(beforePlayers);
    await expect(admin.setNickname(uuid(2, 9), 'x')).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
    await expect(admin.setNickname(uuid(2, 1), 'a\nb')).rejects.toMatchObject({ code: 'INVALID_NICKNAME' });
    await admin.linkAccount(uuid(2, 2), uuid(2, 1));
    await expect(admin.setNickname(uuid(2, 2), 'x')).rejects.toMatchObject({ code: 'MEMBER_ARCHIVED' });
    await expect(admin.clearNickname(uuid(2, 2))).rejects.toMatchObject({ code: 'MEMBER_ARCHIVED' });
    const listing = await admin.list();
    expect(listing[0]).toMatchObject({ memberId: uuid(2, 1), displayName: '測試甲', nickname: null, nameSource: 'community' });
    expect(JSON.stringify(listing)).not.toContain(uuid(1, 1));
  });

  it('a Riot reconnect/rename never overwrites the member name or nickname', async () => {
    const db = await database();
    const durable = new DurableEvidenceService(db, hmacKey);
    const input = { gameName: 'FictionalOldName', tag: 'OLD', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;
    const { publicPlayerId } = await durable.persistConnection(input, 'fictional-nickname-puuid', '2026-10-01T00:00:00.000Z');
    const admin = new MemberAdminService(db);
    await admin.renameMember(publicPlayerId!, '測試甲');
    await admin.setNickname(publicPlayerId!, '甲哥');
    await durable.persistConnection({ ...input, gameName: 'FictionalNewName', tag: 'NEW' }, 'fictional-nickname-puuid', '2026-10-02T00:00:00.000Z');
    const player = (await snapshot(db)).dataset.players[0]!;
    expect(player).toMatchObject({ id: publicPlayerId, handle: '測試甲', displayName: '測試甲', nickname: '甲哥', nameSource: 'community',
      accounts: [{ gameName: 'FictionalNewName', tag: 'NEW' }] });
  });
});

describe('approved community-name assignment (exact game-name matching)', () => {
  it('plans exactly, applies via rename-member, and leaves nicknames and Riot names untouched', async () => {
    const db = await database();
    await seed(db, fictional);
    const admin = new MemberAdminService(db);
    const plan = await admin.planCommunityNames(mapping);
    expect(plan).toMatchObject({ ok: true, problems: [], liveMembers: 3, liveAccounts: 3 });
    expect(plan.items.map((item) => [item.gameName, item.communityName, item.memberId, item.currentSource])).toEqual([
      ['FictionalSky', '測試甲', uuid(2, 1), 'legacy_account'], ['fictional5487', 'tester', uuid(2, 2), 'legacy_account'], ['Fictional ü Plus', '測試丙', uuid(2, 3), 'legacy_account']]);
    const before = await snapshot(db);
    expect(await admin.applyCommunityNames(mapping)).toEqual({ applied: 3, total: 3 });
    const after = await snapshot(db);
    expect(after.dataset.players.map((p) => [p.id, p.handle, p.nameSource, p.nickname ?? null, `${p.accounts![0]!.gameName}#${p.accounts![0]!.tag}`])).toEqual([
      [uuid(2, 1), '測試甲', 'community', null, 'FictionalSky#T1'], [uuid(2, 2), 'tester', 'community', null, 'fictional5487#T2'], [uuid(2, 3), '測試丙', 'community', null, 'Fictional ü Plus#T3']]);
    // Presentation only: every match and performance is identical; numeric ranking unchanged.
    expect(after.dataset.matches).toEqual(before.dataset.matches);
    const rank = (payload: typeof before) => {
      const analytics = buildAnalytics(payload.dataset);
      return aggregateSelection(selectPerformances(analytics.performanceEntries, { playerId: 'all', period: 'all', map: 'all', agent: 'all', role: 'all', gameMode: 'all', minMatches: 0, minRounds: 0 }, { population: analytics.population }))
        .map((row) => [row.player.id, row.stats, row.scores]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    };
    expect(rank(after)).toEqual(rank(before));
    expect(await admin.invariants()).toMatchObject({ accountsPerMember: { 1: 3 }, sameMatchMemberCollisions: 0 });
  });

  it.each([
    ['a name with no exact match (no fuzzy/case matching)', [{ gameName: 'fictionalsky', communityName: 'x' }, mapping[1]!, mapping[2]!]],
    ['a duplicate mapping', [mapping[0]!, mapping[0]!, mapping[2]!]],
    ['a mapping that does not cover every live member', [mapping[0]!, mapping[1]!]],
    ['an invalid community name', [{ ...mapping[0]!, communityName: 'a\nb' }, mapping[1]!, mapping[2]!]],
  ])('refuses before any write: %s', async (_label, entries) => {
    const db = await database();
    await seed(db, fictional);
    const admin = new MemberAdminService(db);
    const members = async () => (await db.query('SELECT * FROM members ORDER BY id')).rows;
    const before = await members();
    expect((await admin.planCommunityNames(entries)).ok).toBe(false);
    await expect(admin.applyCommunityNames(entries)).rejects.toMatchObject({ code: 'NAME_MAPPING_AMBIGUOUS' });
    expect(await members()).toEqual(before);
  });

  it('refuses when one game name matches more than one live account', async () => {
    const db = await database();
    await seed(db, ['SameName', 'SameName', 'Other']);
    const plan = await new MemberAdminService(db).planCommunityNames([{ gameName: 'SameName', communityName: 'a' }, { gameName: 'SameName', communityName: 'b' }, { gameName: 'Other', communityName: 'c' }]);
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' ')).toContain('matches 2 live accounts');
  });

  it('stops at the first failed rename and reports how many succeeded (no rollback)', async () => {
    const db = await database();
    await seed(db, fictional);
    const admin = new MemberAdminService(db);
    const original = admin.renameMember.bind(admin);
    let calls = 0;
    vi.spyOn(admin, 'renameMember').mockImplementation(async (id, name) => { calls += 1; if (calls === 2) throw new Error('simulated'); return original(id, name); });
    expect(await admin.applyCommunityNames(mapping)).toEqual({ applied: 1, total: 3, failed: { gameName: 'fictional5487', communityName: 'tester', code: 'UNKNOWN' } });
    expect(calls).toBe(2);
    expect((await db.query('SELECT display_name_source AS s FROM members ORDER BY id')).rows).toEqual([{ s: 'community' }, { s: 'legacy_account' }, { s: 'legacy_account' }]);
  });
});

describe('member-identity-v2 public contract', () => {
  it('snapshot, history and view=analysis carry schema 6 / v2 and the nickname only when set', async () => {
    const db = await database();
    await seed(db, fictional);
    await new MemberAdminService(db).setNickname(uuid(2, 2), 'ü王');
    const payload = await snapshot(db);
    expect(payload.schemaVersion).toBe(6);
    expect(payload.snapshot.identityVersion).toBe('member-identity-v2');
    expect(isDatasetResponse(payload)).toBe(true);
    expect(payload.dataset.players.map((p) => p.nickname)).toEqual([undefined, 'ü王', undefined]);
    expect(payload.dataset.players.filter((p) => 'nickname' in p)).toHaveLength(1);
    const history = (await new DatasetProjectionService(new PostgresDatasetReadRepository(db), 'test-history-cursor-key-with-32-bytes!!').readHistory({ start: { kind: 'newest' }, pageSize: 10 })).payload;
    expect(history.identityVersion).toBe('member-identity-v2');
    expect(isDatasetHistoryResponse(history)).toBe(true);
    expect(history.dataset.players.find((p) => p.id === uuid(2, 2))?.nickname).toBe('ü王');
    const request: AnalysisRequest = { feature: 'lifetimeTotals', map: 'all', agent: 'all', role: 'all', mode: 'all', player: 'all', form: false };
    const analysis = (await new ServerAnalysisService(db, new DatasetProjectionService(new PostgresDatasetReadRepository(db))).analyze(request)).payload;
    expect(analysis.schemaVersion).toBe(6);
    expect(isDatasetAnalysisResponse(analysis)).toBe(true);
    expect(analysis.dataset.players.find((p) => p.id === uuid(2, 2))?.nickname).toBe('ü王');
    for (const text of [JSON.stringify(payload), JSON.stringify(history), JSON.stringify(analysis)]) {
      for (const secret of [uuid(1, 1), uuid(1, 2), hex(1), 'lookup_hmac', 'puuid', 'member_id', 'management', 'lease']) expect(text).not.toContain(secret);
    }
  });

  it('rejects empty, padded or oversized nicknames and the old schema/identity version', async () => {
    const db = await database();
    await seed(db, fictional);
    const payload = await snapshot(db);
    const withNickname = (nickname: unknown) => ({ ...payload, dataset: { ...payload.dataset, players: payload.dataset.players.map((p, i) => (i === 0 ? { ...p, nickname } : p)) } });
    expect(isDatasetResponse(withNickname('麻花'))).toBe(true);
    for (const bad of ['', ' 麻花', 'x'.repeat(65), 7]) expect(isDatasetResponse(withNickname(bad))).toBe(false);
    expect(isDatasetResponse({ ...payload, schemaVersion: 5 })).toBe(false);
    expect(isDatasetResponse({ ...payload, snapshot: { ...payload.snapshot, identityVersion: 'member-identity-v1' } })).toBe(false);
  });

  it('Demo exercises a fictional nickname on a member (never an id)', () => {
    const nova = demoDataSource.snapshot().players.find((p) => p.id === 'nova-hex')!;
    expect(nova).toMatchObject({ handle: 'NovaHex', nickname: 'Nova' });
    expect(demoDataSource.snapshot().players.filter((p) => p.nickname)).toHaveLength(1);
  });
});

describe('member:admin CLI safety', () => {
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/member-admin.ts', ...args], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });
  it('refuses mutations without --confirm before touching any database, and refuses without DATABASE_URL', () => {
    const mappingPath = join(mkdtempSync(join(tmpdir(), 'member-admin-')), 'mapping.json');
    writeFileSync(mappingPath, JSON.stringify(mapping));
    for (const args of [['set-nickname', '--member', uuid(2, 1), '--nickname', 'x'], ['clear-nickname', '--member', uuid(2, 1)], ['rename-member', '--member', uuid(2, 1), '--name', 'x'], ['apply-names', '--mapping', mappingPath]]) {
      const result = run(args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('--confirm');
    }
    const list = run(['list']);
    expect(list.status).toBe(2);
    expect(list.stderr).toContain('DATABASE_URL is required');
    expect(run(['set-nickname', '--member', 'not-a-uuid', '--nickname', 'x', '--confirm']).stderr).toContain('--member <public uuid> is required');
  }, 60_000);
});
