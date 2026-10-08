import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { PublicApiError } from '../server/errors';
import { matchSnapshot, parseMmrV3, parseStoredMmrHistory, RankPayloadError } from '../server/rankEvidence/henrikRankParser';
import { ingestMatchSnapshots, ingestProviderRank, type RankProvider } from '../server/rankEvidence/rankIngestion';
import { evidenceKey, RankStagingStore } from '../server/rankEvidence/rankStagingStore';
import { RebuildStagingStore } from '../server/rebuildStaging/stagingStore';
import { rankCoverage, resolveRankContextAt, type RankEvidence } from '../src/analytics/rank/rankContext';
import { compareTiers, normalizeTier, VALORANT_TIERS } from '../src/analytics/rank/tiers';

/** TASK-DATA-RANK-01 — synthetic fixtures only (shapes per docs.henrikdev.xyz); no network. */
class PGliteDatabase implements SqlDatabase {
  constructor(readonly pg: PGlite) {}
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.pg.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.pg.exec('BEGIN');
    try { const value = await work(this); await this.pg.exec('COMMIT'); return value; }
    catch (error) { await this.pg.exec('ROLLBACK'); throw error; }
  }
  async close() { await this.pg.close(); }
}

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const BASE = { accountId: ACCOUNT, observedAt: '2026-10-07T12:00:00.000Z', ingestedAt: '2026-10-07T12:00:00.000Z' };
const rankedMmr = { status: 200, data: {
  account: { puuid: 'fake-puuid', name: 'FakeOne', tag: 'T01' },
  current: { tier: { id: 14, name: 'Gold 3' }, rr: 57, last_change: 18, elo: 1257, games_needed_for_rating: 0, rank_protection_shields: 1, leaderboard_placement: null },
  peak: { season: { id: 's-peak', short: 'e9a1' }, ranking_schema: 'ascendant', tier: { id: 17, name: 'Platinum 3' }, rr: 12 },
  seasonal: [
    { season: { id: 's-1', short: 'e9a1' }, wins: 30, games: 55, end_tier: { id: 17, name: 'Platinum 3' }, end_rr: 12, ranking_schema: 'ascendant', leaderboard_placement: null, act_wins: [{ id: 15, name: 'Platinum 1' }] },
    { season: { id: 's-2', short: 'e9a2' }, wins: 10, games: 22, end_tier: { id: 14, name: 'Gold 3' }, end_rr: 40, ranking_schema: 'ascendant', leaderboard_placement: null, act_wins: [] },
  ],
} };
const unrankedMmr = { status: 200, data: { current: { tier: { id: 0, name: 'Unrated' }, rr: 0, last_change: 0, elo: 0, games_needed_for_rating: 5 }, peak: null, seasonal: [] } };
const history = { status: 200, results: { total: 3, returned: 3, before: 0, after: 0 }, data: [
  { match_id: 'm-3', tier: { id: 14, name: 'Gold 3' }, map: { id: 'x', name: 'Ascent' }, season: { id: 's-2', short: 'e9a2' }, rr: 57, last_change: 18, elo: 1257, date: '2026-10-05T10:00:00.000Z', refunded_rr: 0, was_derank_protected: false },
  { match_id: 'm-2', tier: { id: 14, name: 'Gold 3' }, map: { id: 'x', name: 'Bind' }, season: { id: 's-2', short: 'e9a2' }, rr: 39, last_change: -21, elo: 1239, date: '2026-10-03T10:00:00.000Z' },
  { match_id: 'm-1', tier: { id: 15, name: 'Platinum 1' }, map: { id: 'x', name: 'Haven' }, season: { id: 's-2', short: 'e9a2' }, rr: 0, last_change: -15, elo: 1260, date: '2026-10-01T10:00:00.000Z' },
] };
const matchRef = (id: string) => `ref-${id}`;

describe('tier normalization (ordering only)', () => {
  it('orders Iron 1 … Immortal 3 … Radiant deterministically and keeps Unranked out of the ordering', () => {
    expect(VALORANT_TIERS.map((tier) => tier.label).slice(0, 3)).toEqual(['Iron 1', 'Iron 2', 'Iron 3']);
    expect(normalizeTier({ name: 'Immortal 3' })!.tierOrdinal).toBe(24);
    expect(normalizeTier({ name: 'Radiant' })).toMatchObject({ tierOrdinal: 25, division: null, ranked: true });
    expect(normalizeTier({ name: 'Unrated' })).toMatchObject({ key: 'unranked', tierOrdinal: null, ranked: false });
    expect(compareTiers(normalizeTier({ name: 'Ascendant 1' }), normalizeTier({ name: 'Diamond 3' }))).toBeGreaterThan(0);
  });
  it('never guesses: unknown / future tier names and schema-ambiguous ids stay unknown', () => {
    expect(normalizeTier({ name: 'Celestial 1' })).toBeNull();
    expect(normalizeTier({ id: 24 })).toBeNull(); // pre-Ascendant 24 = Radiant, current 24 = Immortal 1
    expect(normalizeTier({ id: 24, currentSchema: true })!.label).toBe('Immortal 1');
    expect(normalizeTier({ id: 27, currentSchema: true })!.label).toBe('Radiant');
    expect(normalizeTier({ name: '  gold   2 ' })!.key).toBe('gold_2');
  });
});

describe('Henrik rank parsers (fixtures)', () => {
  it('ranked account: current (rr, providerElo, change), peak with season, seasonal summaries', () => {
    const rows = parseMmrV3(rankedMmr, BASE);
    const current = rows.find((row) => row.kind === 'current')!;
    expect(current).toMatchObject({ providerTierName: 'Gold 3', rr: 57, providerElo: 1257, rrChange: 18, seasonId: null, source: 'henrik:v3/mmr' });
    expect(current.normalized!.key).toBe('gold_3');
    expect(rows.find((row) => row.kind === 'peak')).toMatchObject({ providerTierName: 'Platinum 3', seasonShort: 'e9a1', rr: 12 });
    const seasonal = rows.filter((row) => row.kind === 'seasonal');
    expect(seasonal.map((row) => [row.seasonShort, row.extra.games, row.extra.wins])).toEqual([['e9a1', 55, 30], ['e9a2', 22, 10]]);
  });
  it('unranked account and missing / null fields stay unknown', () => {
    const rows = parseMmrV3(unrankedMmr, BASE);
    expect(rows.map((row) => row.kind)).toEqual(['current']);
    expect(rows[0]!.normalized!.ranked).toBe(false);
    const sparse = parseMmrV3({ data: { current: { tier: { name: 'Mythic 9' } } } }, BASE);
    expect(sparse[0]).toMatchObject({ rr: null, providerElo: null, normalized: null, providerTierName: 'Mythic 9' });
  });
  it('history rows are post-match observations tied to private match refs; empty history is valid', () => {
    const parsed = parseStoredMmrHistory(history, BASE, matchRef);
    expect(parsed).toMatchObject({ total: 3, returned: 3, after: 0 });
    expect(parsed.rows[2]).toMatchObject({ kind: 'history', matchRef: 'ref-m-1', rr: 0, rrChange: -15, effectiveAt: '2026-10-01T10:00:00.000Z' });
    expect(parseStoredMmrHistory({ data: [], results: { total: 0, returned: 0, before: 0, after: 0 } }, BASE, matchRef).rows).toEqual([]);
  });
  it('provider error / malformed payloads fail closed', () => {
    expect(() => parseMmrV3({ errors: [{ code: 24 }] }, BASE)).toThrow(RankPayloadError);
    expect(() => parseStoredMmrHistory({ data: [{ match_id: 'x', date: 'not a date' }] }, BASE, matchRef)).toThrow(RankPayloadError);
  });
  it('match snapshot reads only the known account\'s players[].tier at the match start', () => {
    const document = { metadata: { started_at: '2026-10-02T10:00:00Z', queue: { id: 'competitive' }, season: { id: 's-2', short: 'e9a2' } },
      players: [{ puuid: 'other', tier: { id: 20, name: 'Diamond 3' } }, { puuid: 'mine', tier: { id: 14, name: 'Gold 3' } }] };
    expect(matchSnapshot(document, 'mine', { accountId: ACCOUNT, ingestedAt: BASE.ingestedAt, matchRef: 'ref-x' }))
      .toMatchObject({ kind: 'match_snapshot', providerTierName: 'Gold 3', effectiveAt: '2026-10-02T10:00:00.000Z', queue: 'competitive', seasonShort: 'e9a2' });
    expect(matchSnapshot(document, 'absent', { accountId: ACCOUNT, ingestedAt: BASE.ingestedAt, matchRef: 'ref-x' })).toBeNull();
  });
});

describe('point-in-time resolution (no future leakage)', () => {
  const evidence: RankEvidence[] = [
    ...parseMmrV3(rankedMmr, BASE),
    ...parseStoredMmrHistory(history, BASE, matchRef).rows,
    { ...parseStoredMmrHistory(history, BASE, matchRef).rows[0]!, kind: 'match_snapshot', matchRef: 'ref-m-2', effectiveAt: '2026-10-03T10:00:00.000Z', providerTierName: 'Gold 2', normalized: normalizeTier({ name: 'Gold 2' }) },
  ];
  it('before any observation → unknown; current and peak are NEVER projected backward', () => {
    const context = resolveRankContextAt(evidence, ACCOUNT, '2026-09-01T00:00:00.000Z');
    expect(context).toMatchObject({ status: 'unknown', evidence: null, laterEvidenceExists: true });
  });
  it('the match itself resolves to its in-match snapshot, not to its own post-match history row', () => {
    const context = resolveRankContextAt(evidence, ACCOUNT, '2026-10-03T10:00:00.000Z', 'ref-m-2');
    expect(context.status).toBe('exact_match');
    expect(context.evidence).toMatchObject({ kind: 'match_snapshot', providerTierName: 'Gold 2' });
  });
  it('without an in-match snapshot, only evidence strictly before the match is used (never the same match\'s result)', () => {
    const context = resolveRankContextAt(evidence, ACCOUNT, '2026-10-05T10:00:00.000Z', 'ref-m-3');
    expect(context.status).toBe('prior_observation');
    expect(context.evidence!.matchRef).toBe('ref-m-2');
    expect(context.evidence!.kind).not.toMatch(/peak|seasonal/u);
  });
  it('current evidence applies only to times after it was observed', () => {
    const later = resolveRankContextAt(evidence, ACCOUNT, '2026-10-08T00:00:00.000Z');
    expect(later).toMatchObject({ status: 'prior_observation' });
    expect(later.evidence!.kind).toBe('current');
  });
  it('coverage counts point-in-time rows only and stays "unknown" completeness', () => {
    expect(rankCoverage(evidence, ACCOUNT)).toMatchObject({ rankObservationCount: 4, rankCoverageStart: '2026-10-01T10:00:00.000Z', rankHistoryCompleteness: 'unknown' });
  });
});

async function stagingWithAccount() {
  const db = new PGliteDatabase(new PGlite());
  const rebuild = new RebuildStagingStore(db, 'test-rebuild-key-0123456789abcdef0123456789abcdef');
  await rebuild.initialize();
  await rebuild.upsertAccounts([{ accountPublicId: ACCOUNT, memberPublicId: '00000000-0000-4000-8000-000000000101', communityName: '甲', gameName: 'FakeOne', tag: 'T01', isPrimary: true }]);
  await rebuild.resolveAccount(ACCOUNT, 'ap', 'mine');
  const rank = new RankStagingStore(db);
  await rank.initialize();
  return { db, rebuild, rank };
}

describe('private rank staging (idempotent, isolated)', () => {
  it('same evidence twice → one logical observation; changed current state → a new observation; seasonal updates in place', async () => {
    const { db, rank } = await stagingWithAccount();
    const rows = [...parseMmrV3(rankedMmr, BASE), ...parseStoredMmrHistory(history, BASE, matchRef).rows];
    expect(await rank.upsert(rows)).toBe(rows.length);
    expect(await rank.upsert(rows)).toBe(0);
    const again = (await db.query<{ n: number; max: number }>(`SELECT count(*)::int AS n, max(observation_count)::int AS max FROM rank_staging.rank_evidence`)).rows[0]!;
    expect(again).toEqual({ n: rows.length, max: 2 });
    const changed = structuredClone(rankedMmr);
    changed.data.current.rr = 80; changed.data.seasonal[1]!.games = 23;
    expect(await rank.upsert(parseMmrV3(changed, { ...BASE, observedAt: '2026-10-07T13:00:00.000Z', ingestedAt: '2026-10-07T13:00:00.000Z' }))).toBe(1);
    const seasonal = (await db.query<{ extra: { games: number } }>(`SELECT extra FROM rank_staging.rank_evidence WHERE kind='seasonal' AND season_short='e9a2'`)).rows;
    expect(seasonal).toHaveLength(1);
    expect(seasonal[0]!.extra.games).toBe(23);
    expect(evidenceKey(rows[0]!)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('ingests match snapshots from staged documents with 0 provider requests', async () => {
    const { db, rebuild, rank } = await stagingWithAccount();
    const doc = { metadata: { match_id: 'mm-1', started_at: '2026-10-02T10:00:00Z', queue: { id: 'competitive' } }, players: [{ puuid: 'mine', tier: { id: 14, name: 'Gold 3' } }] };
    const entry = { providerMatchId: 'mm-1', startedAt: '2026-10-02T10:00:00.000Z', mode: 'competitive', mapName: null, seasonShort: null, payload: doc };
    const [account] = await rebuild.accounts();
    await rebuild.commitDiscoveryPage({ account: account!, source: 'live_v4', entries: [entry], cursor: { nextPosition: 1, exhausted: true, termination: 'short_page', lastFingerprint: null, repeatCount: 0, providerTotal: null, pagesRead: 1, entriesSeen: 1 }, at: '2026-10-07T00:00:00.000Z' });
    expect(await ingestMatchSnapshots(db, rebuild, rank)).toMatchObject({ links: 1, snapshots: 1, created: 1 });
    expect(await ingestMatchSnapshots(db, rebuild, rank)).toMatchObject({ created: 0 });
  });

  it('provider ingestion is bounded, resumable and fails closed on 429', async () => {
    const { rebuild, rank } = await stagingWithAccount();
    let calls = 0;
    let fail429 = true;
    const provider: RankProvider = {
      fetchMmrV3: async () => { calls += 1; return rankedMmr; },
      fetchStoredMmrHistory: async () => { calls += 1; if (fail429) throw new PublicApiError(429, 'RATE_LIMITED', 'x'); return history; },
    };
    const options = { provider, rebuild, rank, requestsUsed: async () => calls, maxTaskRequests: 30, historySize: 100, lastRequest: () => undefined, onEvent: () => undefined };
    expect((await ingestProviderRank(options)).stopReason).toBe('provider_429');
    fail429 = false;
    expect((await ingestProviderRank(options)).stopReason).toBeNull();
    expect(calls).toBe(3); // v3 once (already ok on resume), history twice (429, then ok)
    expect((await ingestProviderRank(options)).stopReason).toBeNull();
    expect(calls).toBe(3); // nothing re-requested once complete
    expect((await ingestProviderRank({ ...options, requestsUsed: async () => 30 })).stopReason).toBeNull(); // nothing pending
  });

  it('refuses an application database (shared staging isolation)', async () => {
    const db = new PGliteDatabase(new PGlite());
    await db.query('CREATE TABLE consents (id uuid PRIMARY KEY)');
    await expect(new RebuildStagingStore(db, 'k'.repeat(40)).initialize()).rejects.toThrow(/application database/u);
  });
});

describe('architecture boundary', () => {
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return ['node_modules', 'dist', 'dist-server'].includes(entry.name) ? [] : files(path);
      return /\.(ts|tsx)$/u.test(entry.name) ? [path] : [];
    }))).flat();
  }
  it('rank ingestion never imports canonical consent / persistence / dataset code and writes only rank_staging', async () => {
    for (const file of await files(resolve('server/rankEvidence'))) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(/from '\.\.\/(persistence|dataset|repositories|deletion|staticExport|staticPublish)\//u);
      expect(source, file).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+(?!rank_staging\.)[a-z_]+\b/u);
    }
  });
  it('nothing public imports the private rank ingestion; no multiplier / final score exists', async () => {
    for (const root of ['api', 'src', 'shared'].map((dir) => resolve(dir))) {
      for (const file of await files(root)) expect(await readFile(file, 'utf8'), file).not.toMatch(/from '[^']*(rankEvidence|rank-ingest)/u);
    }
    for (const file of [...await files(resolve('src/analytics/rank')), ...await files(resolve('server/rankEvidence'))]) {
      expect(await readFile(file, 'utf8'), file).not.toMatch(/RANK_WEIGHT|RANK_MULTIPLIER|FINAL_STRENGTH|MMR_ESTIMATE|ELO_ESTIMATE/u);
    }
  });
});
