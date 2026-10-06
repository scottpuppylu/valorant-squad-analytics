import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { buildAnalyticsContext, PostgresAnalyticsContextRepository } from '../server/dataset/analyticsContext';
import { filtersFor, ServerAnalysisService, type AnalysisRequest } from '../server/dataset/analysisService';
import { MemberAdminService, validateMemberName } from '../server/identity/memberAdminService';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { RevocationDeletionService } from '../server/deletion/revocationDeletionService';
import { consentCredentialVersion, consentManagementCredentialHmac, createConsentManagementCredential } from '../server/consentManagementCredential';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { buildAnalytics } from '../src/data/analytics';
import { selectPerformances } from '../src/analytics/filters';
import { aggregateSelection } from '../src/analytics/rankings';
import { buildSynergy, defaultSynergyFilters } from '../src/synergy/analytics';
import { computeImprovementIndex } from '../src/analytics/progress/improvementIndex';
import { resolveProgressWindows } from '../src/analytics/progress/windows';
import { isDatasetAnalysisResponse, progressFromAnalysis } from '../src/dataSources/server/analysisResult';
import { isDatasetResponse } from '../src/dataSources/server/datasetContract';
import { accountMatchCounts, memberAccounts } from '../src/analytics/identity';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types';
import type { SelectionResult } from '../src/analytics/types';

const hmacKey = 'test-identity-hmac-key-with-at-least-32-bytes';
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
function placeholders(rows: number, width: number): string {
  let index = 1;
  return Array.from({ length: rows }, () => `(${Array.from({ length: width }, () => `$${index++}`).join(',')})`).join(',');
}
async function insertRows(db: SqlDatabase, sql: string, rows: unknown[][], width: number) {
  if (rows.length) await db.query(`${sql} VALUES ${placeholders(rows.length, width)}`, rows.flat());
}

interface Seat { player: number; team?: 'Blue' | 'Red'; kills?: number; agent?: string }
interface Spec { n: number; hoursAgo: number; seats: Seat[]; season?: string | null; map?: string }
const anchor = Date.UTC(2026, 9, 5, 12);

/** Accounts are seeded through the plain legacy insert: migration 0008's trigger creates each 1:1 member. */
async function seedAccounts(db: SqlDatabase, ids: number[]) {
  await db.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [squadId, 'friends', 'Friends']);
  const rows = ids.map((i) => [uuid(1, i), uuid(2, i), `Account${i}`, `T${i}`, '🐺']);
  await insertRows(db, 'INSERT INTO players (id,public_id,display_name,display_tag,default_emoji)', rows, 5);
  await insertRows(db, 'INSERT INTO squad_memberships (id,squad_id,player_id,status)', ids.map((i) => [uuid(3, i), squadId, uuid(1, i), 'active']), 4);
  await insertRows(db, 'INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at)', ids.map((i) => [uuid(4, i), uuid(1, i), 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00Z']), 6);
}

async function seedMatches(db: SqlDatabase, specs: Spec[]) {
  const matches: unknown[][] = []; const teams: unknown[][] = []; const parts: unknown[][] = []; const rounds: unknown[][] = []; const presences: unknown[][] = [];
  for (const s of specs) {
    const started = new Date(anchor - s.hoursAgo * 3_600_000).toISOString();
    matches.push([uuid(5, s.n), squadId, 'HenrikDev', hex(s.n), 'v4', 'durable-evidence-v2', 'ap', s.map ?? 'Ascent', 'competitive', 'Competitive', started, 2_100_000, started, started, uuid(6, s.n), 'observed', 'observed', s.season === undefined ? 'e11a5' : s.season]);
    teams.push([uuid(7, s.n * 2), uuid(5, s.n), 'Blue', true, 13, 9], [uuid(7, s.n * 2 + 1), uuid(5, s.n), 'Red', false, 9, 13]);
    for (let r = 1; r <= 3; r += 1) rounds.push([uuid(9, s.n * 4 + r), uuid(5, s.n), r, 'observed', 'missing', 'missing']);
    // Participant ids are seat-ordinal (not account-based) so the union fixture keeps identical internal evidence.
    s.seats.forEach((seat, ordinal) => {
      const pid = uuid(8, s.n * 16 + ordinal);
      parts.push([pid, uuid(5, s.n), uuid(1, seat.player), hex(1_000_000 + s.n * 16 + ordinal), seat.team ?? 'Blue', seat.agent ?? 'Jett', 'observed', seat.kills ?? 15, 12, 4, 4200 + (s.n % 11) * 90, 3000 + (s.n % 13) * 70, 9, 20, 3]);
      for (let r = 1; r <= 3; r += 1) presences.push([uuid(10, (s.n * 16 + ordinal) * 4 + r), uuid(9, s.n * 4 + r), pid, 'observed', 'missing', 'missing', 'missing']);
    });
  }
  await insertRows(db, 'INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status,season_short)', matches, 18);
  await insertRows(db, 'INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost)', teams, 6);
  await insertRows(db, 'INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots)', parts, 15);
  await insertRows(db, 'INSERT INTO rounds (id,source_match_id,round_number,participants_evidence_status,plant_status,defuse_status)', rounds, 6);
  await insertRows(db, 'INSERT INTO round_participants (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status)', presences, 7);
}

/** Member A = accounts 1 (main) + 2 (alt, never in the same match as 1); member B = account 3. */
function multiSpecs(): Spec[] {
  return Array.from({ length: 36 }, (_, i) => {
    const n = i + 1;
    // Unequal volumes (24 vs 12) so union and average differ.
    const a: Seat = n % 3 !== 1 ? { player: 1, kills: 26, agent: 'Jett' } : { player: 2, kills: 7, agent: 'Sova' };
    const seats: Seat[] = [a];
    if (n % 3 === 0 || (n % 3 === 1 && n % 4 === 0)) seats.push({ player: 3, kills: 14, agent: 'Omen' });
    if (n % 5 === 0) seats.push({ player: 3, team: 'Red', kills: 11, agent: 'Omen' });
    return { n, hoursAgo: i * 9 + (n % 4), seats: seats.filter((seat, index, all) => all.findIndex((x) => x.player === seat.player) === index), season: n > 30 ? 'e11a4' : 'e11a5', map: ['Ascent', 'Bind', 'Haven'][n % 3]! };
  });
}
const union = (specs: Spec[]) => specs.map((s) => ({ ...s, seats: s.seats.map((seat) => (seat.player === 2 ? { ...seat, player: 1 } : seat)) }));

async function clientView(db: SqlDatabase) {
  const snapshot = (await new DatasetProjectionService(new PostgresDatasetReadRepository(db)).read()).payload;
  const context = buildAnalyticsContext(await new PostgresAnalyticsContextRepository(db).readContextRows());
  const analytics = buildAnalytics(snapshot.dataset, {
    snapshotCoversTrackedHistory: context.population.snapshotCoversTrackedHistory,
    seasonKeys: context.evidence.season.acts.map((act) => act.key), seasonStatus: context.evidence.season.status, rankStatus: context.evidence.rank.status,
  });
  return { snapshot, analytics };
}
const scoreSummary = (selection: SelectionResult) => aggregateSelection(selection).map((a) => [a.player.id, a.stats.matches, a.stats.rounds, a.stats.acs, a.stats.kd,
  a.scores.overall.value ?? null, a.scores.overall.status, a.scores.confidence, ...Object.values(a.scores).map((score) => (typeof score === 'object' && score !== null && 'value' in score ? score.value ?? null : score))]);
const request = (partial: Partial<AnalysisRequest>): AnalysisRequest => ({ feature: 'currentStrength', map: 'all', agent: 'all', role: 'all', mode: 'all', player: 'all', form: false, ...partial });
const stripAccounts = (dataset: NormalizedAnalyticsDataset) => JSON.parse(JSON.stringify(dataset, (key, value) => (key === 'accountId' || key === 'accounts' ? undefined : value)));
const analysisFeatures: AnalysisRequest[] = [request({ form: true }), request({ feature: 'lifetimeTotals' }), request({ feature: 'mapStats', map: 'Bind' }),
  request({ feature: 'actOverview', act: 'e11a5' }), request({ feature: 'fixedRecent', recent: 10 }), request({ feature: 'improvementIndex' })];

describe('migration 0008 member-identity-v1', () => {
  it('backfills exactly one member per existing account, reusing ids, without touching account-scoped evidence', async () => {
    const db = await database(7);
    await seedAccounts(db, [1, 2, 3]);
    await seedMatches(db, multiSpecs().slice(0, 9));
    await db.query(`INSERT INTO sync_cursors (id,player_id,provider,affinity,sync_kind,next_start,retry_count) VALUES ($1,$2,'HenrikDev','ap','incremental',3,1)`, [uuid(11, 1), uuid(1, 1)]);
    await db.query(`INSERT INTO sync_runs (id,squad_id,player_id,provider,trigger_kind,status,started_at,sync_kind) VALUES ($1,$2,$3,'HenrikDev','manual','paused',now(),'incremental')`, [uuid(12, 1), squadId, uuid(1, 1)]);
    // A pre-existing deleted account: its member is archived and carries no name.
    await db.query(`INSERT INTO players (id,public_id,display_name,display_tag,anonymized_at) VALUES ($1,$2,'已刪除玩家','deleted',now())`, [uuid(1, 9), uuid(2, 9)]);
    await db.query(`INSERT INTO deletion_jobs (id,public_id,player_id,status,requested_at,completed_at) VALUES ($1,$2,$3,'complete',now(),now())`, [uuid(13, 1), uuid(14, 1), uuid(1, 9)]);
    const tables = ['players', 'consents', 'provider_identities', 'sync_cursors', 'sync_runs', 'deletion_jobs', 'match_participants', 'source_matches', 'rounds', 'round_participants', 'squad_memberships'];
    const dump = async () => Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows] as const)));
    const before = await dump();

    expect(await applyMigrations(db, await loadMigrations(resolve('migrations')))).toEqual(['0008', '0009', '0010']);
    expect(await applyMigrations(db, await loadMigrations(resolve('migrations')))).toEqual([]);
    const after = await dump();
    for (const table of tables.filter((name) => name !== 'players')) expect(after[table], table).toEqual(before[table]);
    // Existing player columns are unchanged; only the new columns were added.
    const legacyColumns = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !['member_id', 'is_primary_account', 'account_label'].includes(key)));
    expect(after.players!.map(legacyColumns)).toEqual(before.players);
    expect(after.players!.every((row) => row.member_id === row.id && row.is_primary_account === true && row.account_label === null)).toBe(true);
    const members = (await db.query<{ id: string; public_id: string; display_name: string; display_name_source: string; archived: boolean }>(
      'SELECT id, public_id, display_name, display_name_source, (archived_at IS NOT NULL) AS archived FROM members ORDER BY id')).rows;
    expect(members).toEqual([
      { id: uuid(1, 1), public_id: uuid(2, 1), display_name: 'Account1', display_name_source: 'legacy_account', archived: false },
      { id: uuid(1, 2), public_id: uuid(2, 2), display_name: 'Account2', display_name_source: 'legacy_account', archived: false },
      { id: uuid(1, 3), public_id: uuid(2, 3), display_name: 'Account3', display_name_source: 'legacy_account', archived: false },
      { id: uuid(1, 9), public_id: uuid(2, 9), display_name: '已刪除成員', display_name_source: 'legacy_account', archived: true },
    ]);
    expect((await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows.slice(-3)).toEqual([{ version: '0008' }, { version: '0009' }, { version: '0010' }]);
    expect(await new MemberAdminService(db).invariants()).toMatchObject({
      members: 4, archivedMembers: 1, accounts: 4, liveAccounts: 3, accountsWithoutMember: 0, membersWithMultiplePrimaries: 0,
      activeMembersWithoutLiveAccount: 0, liveAccountsOnArchivedMember: 0, sameMatchMemberCollisions: 0, accountsPerMember: { 1: 3 },
    });
    // Public player ids == previous account public ids (Profile URLs unchanged).
    const { snapshot } = await clientView(db);
    expect(snapshot.dataset.players.map((p) => p.id)).toEqual([uuid(2, 1), uuid(2, 2), uuid(2, 3)]);
  });

  it('enforces one member per account and at most one primary account per member in the database', async () => {
    const db = await database();
    await seedAccounts(db, [1, 2]);
    await expect(db.query('UPDATE players SET member_id=NULL WHERE id=$1', [uuid(1, 1)])).rejects.toThrow();
    await db.query('UPDATE players SET member_id=$1, is_primary_account=false WHERE id=$2', [uuid(1, 1), uuid(1, 2)]);
    await expect(db.query('UPDATE players SET is_primary_account=true WHERE id=$1', [uuid(1, 2)])).rejects.toThrow();
  });
});

describe('new connections, reconnects and community names', () => {
  it('a new Riot account gets its own new 1:1 member; a Riot rename never changes the community name', async () => {
    const db = await database();
    const durable = new DurableEvidenceService(db, hmacKey);
    const input = { gameName: 'OldGameName', tag: 'TW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;
    const { publicPlayerId } = await durable.persistConnection(input, 'fictional-identity-puuid', '2026-10-01T00:00:00.000Z');
    const member = (await db.query<{ id: string; public_id: string; display_name: string; display_name_source: string }>('SELECT m.id, m.public_id, m.display_name, m.display_name_source FROM members m')).rows;
    const account = (await db.query<{ id: string; is_primary_account: boolean }>('SELECT id, is_primary_account FROM players')).rows[0]!;
    expect(member).toEqual([{ id: account.id, public_id: publicPlayerId, display_name: 'OldGameName', display_name_source: 'legacy_account' }]);
    expect(account.is_primary_account).toBe(true);

    await new MemberAdminService(db).renameMember(publicPlayerId!, '大頭');
    await durable.persistConnection({ ...input, gameName: 'NewGameName' }, 'fictional-identity-puuid', '2026-10-02T00:00:00.000Z');
    expect((await db.query('SELECT count(*)::int AS n FROM members')).rows[0]).toEqual({ n: 1 });
    const { snapshot } = await clientView(db);
    expect(snapshot.dataset.players).toHaveLength(1);
    expect(snapshot.dataset.players[0]).toMatchObject({ id: publicPlayerId, handle: '大頭', displayName: '大頭', nameSource: 'community',
      accounts: [{ id: publicPlayerId, gameName: 'NewGameName', tag: 'TW', isPrimary: true }] });
    // A second, different Riot account is NOT linked automatically.
    await durable.persistConnection({ ...input, gameName: 'OldGameName' }, 'another-fictional-puuid', '2026-10-03T00:00:00.000Z');
    expect((await db.query('SELECT count(*)::int AS n FROM members')).rows[0]).toEqual({ n: 2 });
  });

  it('validates community names and never renames archived members', async () => {
    expect(validateMemberName('  大頭  ')).toBe('大頭');
    for (const bad of ['', '   ', 'a\u0000b', 'x​Y', 'a'.repeat(33)]) expect(() => validateMemberName(bad)).toThrow();
    const db = await database();
    await seedAccounts(db, [1, 2]);
    const admin = new MemberAdminService(db);
    await admin.linkAccount(uuid(2, 2), uuid(2, 1));
    await expect(admin.renameMember(uuid(2, 2), 'Archived')).rejects.toMatchObject({ code: 'MEMBER_ARCHIVED' });
    await expect(admin.renameMember(uuid(2, 7), 'Missing')).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
    expect((await db.query<{ display_name: string }>('SELECT display_name FROM players ORDER BY id')).rows.map((r) => r.display_name)).toEqual(['Account1', 'Account2']);
  });
});

describe('maintainer linking and primary management', () => {
  it('links an alt explicitly, archives the emptied member, keeps account-scoped rows, and sets primary atomically', async () => {
    const db = await database();
    await seedAccounts(db, [1, 2, 3]);
    await seedMatches(db, multiSpecs());
    const admin = new MemberAdminService(db);
    const accountScoped = async () => (await db.query('SELECT (SELECT json_agg(c ORDER BY c.id) FROM consents c) AS c, (SELECT json_agg(mp.player_id ORDER BY mp.id) FROM match_participants mp) AS mp, (SELECT json_agg(pi ORDER BY pi.id) FROM provider_identities pi) AS pi')).rows[0];
    const before = await accountScoped();
    expect(await admin.linkAccount(uuid(2, 2), uuid(2, 1))).toEqual({ accountId: uuid(2, 2), memberId: uuid(2, 1), primary: false, sourceMemberArchived: true });
    expect(await accountScoped()).toEqual(before);
    await expect(admin.linkAccount(uuid(2, 2), uuid(2, 1))).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
    const listing = await admin.list();
    expect(listing.find((m) => m.memberId === uuid(2, 1))!.accounts.map((a) => [a.accountId, a.primary])).toEqual([[uuid(2, 1), true], [uuid(2, 2), false]]);
    expect(listing.find((m) => m.memberId === uuid(2, 2))!.archived).toBe(true);
    expect(JSON.stringify(listing)).not.toContain(uuid(1, 1));
    await admin.setPrimary(uuid(2, 2));
    expect((await db.query('SELECT public_id::text AS id, is_primary_account AS p FROM players WHERE member_id=$1 ORDER BY public_id', [uuid(1, 1)])).rows).toEqual([{ id: uuid(2, 1), p: false }, { id: uuid(2, 2), p: true }]);
    const { snapshot } = await clientView(db);
    expect(snapshot.dataset.players.map((p) => p.id)).toEqual([uuid(2, 1), uuid(2, 3)]);
    expect(snapshot.dataset.players[0]!.accounts!.map((a) => [a.id, a.isPrimary])).toEqual([[uuid(2, 2), true], [uuid(2, 1), false]]);
    expect(await admin.invariants()).toMatchObject({ accountsPerMember: { 1: 1, 2: 1 }, activeMembersWithoutLiveAccount: 0, sameMatchMemberCollisions: 0, membersWithMultiplePrimaries: 0 });
  });

  it('refuses a link when the account co-appeared with any account of the target member (no mutation)', async () => {
    const db = await database();
    await seedAccounts(db, [1, 3]);
    await seedMatches(db, multiSpecs().filter((spec) => spec.seats.length === 1 || spec.seats.every((seat) => seat.player !== 2)).map((spec) => ({ ...spec, seats: spec.seats.filter((seat) => seat.player !== 2) })).filter((spec) => spec.seats.length > 0));
    const admin = new MemberAdminService(db);
    const players = async () => (await db.query('SELECT * FROM players ORDER BY id')).rows;
    const members = async () => (await db.query('SELECT * FROM members ORDER BY id')).rows;
    const [beforePlayers, beforeMembers, beforeScores] = [await players(), await members(), JSON.stringify((await clientView(db)).snapshot.dataset)];
    await expect(admin.linkAccount(uuid(2, 3), uuid(2, 1))).rejects.toMatchObject({ code: 'ACCOUNT_COAPPEARANCE_CONFLICT' });
    expect(await players()).toEqual(beforePlayers);
    expect(await members()).toEqual(beforeMembers);
    expect(JSON.stringify((await clientView(db)).snapshot.dataset)).toEqual(beforeScores);
  });

  it('withholds (never sums) a match where one member would have two performances, server-side and in the snapshot', async () => {
    const db = await database();
    await seedAccounts(db, [1, 3]);
    await seedMatches(db, [{ n: 1, hoursAgo: 1, seats: [{ player: 1 }, { player: 3 }] }, { n: 2, hoursAgo: 2, seats: [{ player: 1 }] }]);
    // Simulated corrupted identity (bypassing the admin guard) to prove the read-side invariant.
    await db.query('UPDATE players SET member_id=$1, is_primary_account=false WHERE id=$2', [uuid(1, 1), uuid(1, 3)]);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { snapshot } = await clientView(db);
    expect(snapshot.dataset.matches.map((m) => m.id)).toEqual([uuid(6, 2)]);
    const logs = write.mock.calls.map((call) => String(call[0])).join('');
    expect(logs).toContain('"event":"member_identity_conflict"');
    expect(logs).not.toContain(uuid(2, 1));
    const { selection } = await new ServerAnalysisService(db, new DatasetProjectionService(new PostgresDatasetReadRepository(db))).analyze(request({ feature: 'lifetimeTotals' }));
    expect([...new Set(Object.values(selection).flat())]).toEqual([uuid(6, 2)]);
    expect((await new MemberAdminService(db).invariants()).sameMatchMemberCollisions).toBe(1);
  });
});

describe('member-level analytics = score(union of account evidence)', () => {
  async function pair() {
    const multi = await database();
    await seedAccounts(multi, [1, 2, 3]);
    await seedMatches(multi, multiSpecs());
    const separate = await clientView(multi);
    await new MemberAdminService(multi).linkAccount(uuid(2, 2), uuid(2, 1));
    const unioned = await database();
    await seedAccounts(unioned, [1, 3]);
    await seedMatches(unioned, union(multiSpecs()));
    return { multi, unioned, separate };
  }

  it('one leaderboard row per member; every score, window, Progress and Synergy equals the union, not an average', async () => {
    const { multi, unioned, separate } = await pair();
    const a = await clientView(multi);
    const b = await clientView(unioned);
    expect(a.snapshot.dataset.players.map((p) => p.id)).toEqual([uuid(2, 1), uuid(2, 3)]);
    expect(isDatasetResponse(a.snapshot)).toBe(true);
    expect(stripAccounts(a.snapshot.dataset)).toEqual(stripAccounts(b.snapshot.dataset));
    for (const period of ['all', 'current', 'recent10', 'act'] as const) {
      const filters = { playerId: 'all', period, map: 'all', agent: 'all', role: 'all' as const, gameMode: 'all', minMatches: 0, minRounds: 0, ...(period === 'act' ? { act: 'e11a5' } : {}) };
      const left = selectPerformances(a.analytics.performanceEntries, filters, { population: a.analytics.population });
      const right = selectPerformances(b.analytics.performanceEntries, filters, { population: b.analytics.population });
      expect(scoreSummary(left), period).toEqual(scoreSummary(right));
      expect(aggregateSelection(left).filter((row) => row.player.id === uuid(2, 1)), period).toHaveLength(period === 'current' && aggregateSelection(left).length === 0 ? 0 : 1);
    }
    const strip = (results: ReturnType<typeof buildSynergy>) => results.map((r) => [r.pair.key, r.status, r.value ?? null, r.sharedSample.matches]);
    const pairs = buildSynergy(a.snapshot.dataset, defaultSynergyFilters);
    expect(strip(pairs)).toEqual(strip(buildSynergy(b.snapshot.dataset, defaultSynergyFilters)));
    expect(pairs).toHaveLength(1);
    const teammates = (account: number) => multiSpecs().filter((s) => s.seats.some((seat) => seat.player === account) && s.seats.some((seat) => seat.player === 3 && seat.team !== 'Red')).length;
    expect(teammates(1)).toBeGreaterThan(0);
    expect(teammates(2)).toBeGreaterThan(0);
    expect(pairs[0]!.sharedSample.matches).toBe(teammates(1) + teammates(2));
    // A1/B1 and A2/B1 shared games are ONE pair (teammate games from both accounts).
    expect(pairs[0]!.sharedSample.matches).toBe(multiSpecs().filter((s) => s.seats.some((seat) => seat.player === 3 && seat.team !== 'Red')).length);
    const progress = (view: typeof a) => {
      const player = view.snapshot.dataset.players.find((p) => p.id === uuid(2, 1))!;
      const entries = view.analytics.performanceEntries.filter((entry) => entry.playerId === player.id);
      return computeImprovementIndex(player, resolveProgressWindows(entries, view.analytics.population));
    };
    expect(JSON.stringify(progress(a))).toEqual(JSON.stringify(progress(b)));
    // Combined != average(score(A1), score(A2)).
    const all = { playerId: 'all', period: 'all' as const, map: 'all', agent: 'all', role: 'all' as const, gameMode: 'all', minMatches: 0, minRounds: 0 };
    const rows = aggregateSelection(selectPerformances(separate.analytics.performanceEntries, all, { population: separate.analytics.population }));
    const kd = (id: string, from: typeof rows) => from.find((row) => row.player.id === id)!.stats.kd!;
    const combined = aggregateSelection(selectPerformances(a.analytics.performanceEntries, all, { population: a.analytics.population }));
    expect(kd(uuid(2, 1), combined)).not.toBeCloseTo((kd(uuid(2, 1), rows) + kd(uuid(2, 2), rows)) / 2, 6);
    expect(a.snapshot.dataset.players[0]!.agents).toEqual(['Jett', 'Sova']);
    expect([...accountMatchCounts(a.snapshot.dataset.matches, uuid(2, 1))].sort()).toEqual([[uuid(2, 1), 24], [uuid(2, 2), 12]]);
    expect(memberAccounts(a.snapshot.dataset.players[0]!).map((acc) => acc.roleLabel)).toEqual(['主帳', '小帳']);
  });

  it('server view=analysis (phase 1 + phase 2) aggregates linked accounts exactly like the union', async () => {
    const { multi, unioned } = await pair();
    const service = (db: SqlDatabase) => new ServerAnalysisService(db, new DatasetProjectionService(new PostgresDatasetReadRepository(db)));
    for (const r of [...analysisFeatures, request({ player: uuid(2, 1) }), request({ feature: 'synergy' })]) {
      const leftResult = await service(multi).analyze(r);
      const rightResult = await service(unioned).analyze(r);
      const left = leftResult.payload;
      const right = rightResult.payload;
      expect(isDatasetAnalysisResponse(left), JSON.stringify(r)).toBe(true);
      expect(leftResult.selection, JSON.stringify(r)).toEqual(rightResult.selection);
      expect(stripAccounts(left.dataset), JSON.stringify(r)).toEqual(stripAccounts(right.dataset));
      const noAccounts = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) => (key === 'accountId' || key === 'accounts' ? undefined : item)));
      expect(noAccounts(left.summary ?? null), JSON.stringify(r)).toEqual(noAccounts(right.summary ?? null));
      expect(noAccounts(left.synergy ?? null), JSON.stringify(r)).toEqual(noAccounts(right.synergy ?? null));
      if (r.feature === 'improvementIndex') expect(noAccounts([...progressFromAnalysis(left)])).toEqual(noAccounts([...progressFromAnalysis(right)]));
      expect(filtersFor(r).playerId).toBe(r.player ?? 'all');
    }
  });
});

describe('account-scoped consent and deletion inside a multi-account member', () => {
  it('revoking one linked account removes only that account from listing, stats, Progress and Synergy', async () => {
    const db = await database();
    await seedAccounts(db, [1, 2, 3]);
    await seedMatches(db, multiSpecs());
    await new MemberAdminService(db).linkAccount(uuid(2, 2), uuid(2, 1));
    await db.query("UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id=$1", [uuid(1, 2)]);
    const { snapshot, analytics } = await clientView(db);
    const member = snapshot.dataset.players.find((p) => p.id === uuid(2, 1))!;
    expect(member.accounts!.map((a) => a.id)).toEqual([uuid(2, 1)]);
    const a1Only = multiSpecs().filter((s) => s.seats.some((seat) => seat.player === 1)).length;
    expect(analytics.performanceEntries.filter((e) => e.playerId === uuid(2, 1))).toHaveLength(a1Only);
    expect(JSON.stringify(snapshot)).not.toContain(uuid(2, 2));
    // Account 1 untouched.
    expect((await db.query("SELECT status FROM consents WHERE player_id=$1", [uuid(1, 1)])).rows).toEqual([{ status: 'active' }]);
  });

  it('deleting one linked account keeps the member, other accounts, their consent, sync and matches', async () => {
    const db = await database();
    await seedAccounts(db, [1, 2, 3]);
    await seedMatches(db, multiSpecs());
    const admin = new MemberAdminService(db);
    await admin.linkAccount(uuid(2, 2), uuid(2, 1));
    await db.query(`INSERT INTO sync_cursors (id,player_id,provider,affinity,sync_kind,next_start,retry_count) VALUES ($1,$2,'HenrikDev','ap','incremental',3,0),($3,$4,'HenrikDev','ap','incremental',6,0)`, [uuid(11, 1), uuid(1, 1), uuid(11, 2), uuid(1, 2)]);
    const credential = createConsentManagementCredential();
    await db.query(`UPDATE consents SET management_credential_hmac=$2, management_credential_version=$3, management_credential_issued_at=now() WHERE player_id=$1`,
      [uuid(1, 2), consentManagementCredentialHmac(credential, hmacKey), consentCredentialVersion]);
    const keep = async () => (await db.query(`SELECT (SELECT json_agg(c ORDER BY c.id) FROM consents c WHERE player_id=$1) AS consent,
      (SELECT json_agg(sc.next_start) FROM sync_cursors sc WHERE player_id=$1) AS sync,
      (SELECT count(*)::int FROM match_participants WHERE player_id=$1) AS participants`, [uuid(1, 1)])).rows[0];
    const before = await keep();
    const deletion = new RevocationDeletionService(db, hmacKey, () => new Date('2026-10-06T00:00:00.000Z'));
    const pending = await deletion.revoke(uuid(2, 2), credential);
    let progress = await deletion.continue(pending.jobId, credential);
    for (let i = 0; i < 20 && progress.status !== 'complete'; i += 1) progress = await deletion.continue(pending.jobId, credential);
    expect(progress.status).toBe('complete');
    expect(await keep()).toEqual(before);
    const member = (await db.query('SELECT display_name, archived_at FROM members WHERE public_id=$1', [uuid(2, 1)])).rows[0];
    expect(member).toEqual({ display_name: 'Account1', archived_at: null });
    // The archived source member of the deleted account carried its legacy Riot name: scrubbed.
    expect((await db.query('SELECT display_name FROM members WHERE id=$1', [uuid(1, 2)])).rows).toEqual([{ display_name: '已刪除成員' }]);
    const { snapshot, analytics } = await clientView(db);
    expect(snapshot.dataset.players.find((p) => p.id === uuid(2, 1))!.accounts!.map((a) => a.id)).toEqual([uuid(2, 1)]);
    expect(analytics.performanceEntries.filter((e) => e.playerId === uuid(2, 1))).toHaveLength(multiSpecs().filter((s) => s.seats.some((seat) => seat.player === 1)).length);
    expect(await admin.invariants()).toMatchObject({ activeMembersWithoutLiveAccount: 0, liveAccountsOnArchivedMember: 0 });
  });

  it('a member whose only account is deleted is archived, nameless and not public', async () => {
    const db = await database();
    await seedAccounts(db, [1]);
    await seedMatches(db, [{ n: 1, hoursAgo: 1, seats: [{ player: 1 }] }]);
    const credential = createConsentManagementCredential();
    await db.query(`UPDATE consents SET management_credential_hmac=$2, management_credential_version=$3, management_credential_issued_at=now() WHERE player_id=$1`,
      [uuid(1, 1), consentManagementCredentialHmac(credential, hmacKey), consentCredentialVersion]);
    const deletion = new RevocationDeletionService(db, hmacKey, () => new Date('2026-10-06T00:00:00.000Z'));
    const pending = await deletion.revoke(uuid(2, 1), credential);
    let progress = await deletion.continue(pending.jobId, credential);
    for (let i = 0; i < 20 && progress.status !== 'complete'; i += 1) progress = await deletion.continue(pending.jobId, credential);
    expect((await db.query<{ display_name: string; archived: boolean }>('SELECT display_name, (archived_at IS NOT NULL) AS archived FROM members')).rows).toEqual([{ display_name: '已刪除成員', archived: true }]);
    expect((await clientView(db)).snapshot.dataset.players).toEqual([]);
  });
});

describe('public privacy of the member projection', () => {
  it('exposes only public member/account ids and Riot name/tag', async () => {
    const db = await database();
    await seedAccounts(db, [1, 2, 3]);
    await seedMatches(db, multiSpecs());
    await new MemberAdminService(db).linkAccount(uuid(2, 2), uuid(2, 1));
    const { snapshot } = await clientView(db);
    const { payload } = await new ServerAnalysisService(db, new DatasetProjectionService(new PostgresDatasetReadRepository(db))).analyze(request({ feature: 'improvementIndex' }));
    for (const text of [JSON.stringify(snapshot), JSON.stringify(payload)]) {
      for (const internal of [uuid(1, 1), uuid(1, 2), uuid(1, 3), hex(1), 'lookup_hmac', 'puuid', 'member_id', 'lease', 'management']) expect(text).not.toContain(internal);
    }
    expect(snapshot.snapshot.identityVersion).toBe('member-identity-v2');
    expect(snapshot.schemaVersion).toBe(6);
  });
});

describe('maintainer admin boundary', () => {
  it('is never imported by api/ or src/ (no public admin endpoint, never bundled)', async () => {
    const files: string[] = [];
    const walk = async (dir: string) => { for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path); else if (/\.(ts|tsx)$/u.test(entry.name)) files.push(path);
    } };
    await walk(resolve('api'));
    await walk(resolve('src'));
    for (const file of files) expect(await readFile(file, 'utf8'), file).not.toMatch(/memberAdmin|member-admin|identity\/memberAdminService/u);
  });
});
