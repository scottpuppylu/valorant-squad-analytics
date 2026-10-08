import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { PublicApiError } from '../server/errors';
import { sourceMatchHmac } from '../server/identityProtection';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { DEEP_HISTORY_RULE_VERSION, STORED_INDEX_PAGE_SIZE, type HistoricalDiscoveryProvider } from '../server/sync/historicalDiscoveryProvider';
import { HistoricalSyncService } from '../server/sync/historicalSyncService';
import { PostgresSyncStore } from '../server/sync/postgresSyncStore';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';

/**
 * TASK-DATA-STORED-INDEX-01 `stored-index-efficiency-v1` (deep-history-v2). The OLD algorithm is the same
 * code with the legacy 3-entry stored page (`storedPageSize: 3`); the NEW one uses STORED_INDEX_PAGE_SIZE.
 * Both run through the real HistoricalSyncService + PGlite against one deterministic, Henrik-shaped,
 * newest-first, mutable stored index. Request counts are the primary metric. All identifiers are fictional.
 */
const hmacKey = 'test-stored-index-efficiency-hmac-key-32b!';
const connection = { gameName: 'IndexGoblin', tag: 'TW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;
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
  async close() { await this.pg.close(); }
}

const matchId = (n: number) => `fictional-stored-match-${n}`;
function detail(n: number) {
  return {
    metadata: { match_id: matchId(n), started_at: new Date(Date.UTC(2026, 8, 1) - n * 3_600_000).toISOString(), game_length_in_ms: 1_800_000,
      map: { id: 'map', name: 'Ascent' }, queue: { id: 'competitive', name: 'Competitive' } },
    players: [{ puuid: 'fictional-consenting-participant', name: connection.gameName, tag: connection.tag, team_id: 'Blue', agent: { id: 'a', name: 'Sova' },
      stats: { kills: 1, deaths: 1, assists: 1, score: 300, headshots: 1, bodyshots: 1, legshots: 0, damage: { dealt: 150, received: 100 } } }],
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 0 } }],
    rounds: [{ id: 1, winning_team: 'Blue', result: 'Eliminated', plant: null, stats: [{ player: { puuid: 'fictional-consenting-participant' }, stats: { kills: 1, score: 300 } }] }],
    kills: [],
  };
}

/** Henrik-shaped stored index: newest first, 1-based pages, results counters, mutable between calls. */
class StoredIndexProvider implements HistoricalDiscoveryProvider {
  indexCalls = 0;
  detailCalls = 0;
  maxRequestedSize = 0;
  requestedPages: number[] = [];
  unavailable = new Set<number>();
  seasons = new Map<number, { id: string; short: string }>();
  beforeIndexCall?: (call: number) => void;
  failDetailOnce?: PublicApiError;
  constructor(public entries: number[]) {}
  async fetchHistoryPage() { return { status: 200, data: [] }; }
  async fetchStoredIndexPage(_input: unknown, page: number, size: number) {
    this.indexCalls += 1;
    this.beforeIndexCall?.(this.indexCalls);
    this.maxRequestedSize = Math.max(this.maxRequestedSize, size);
    this.requestedPages.push(page);
    const before = (page - 1) * size;
    const data = this.entries.slice(before, before + size).map((n) => ({ meta: { id: matchId(n), ...(this.seasons.has(n) ? { season: this.seasons.get(n) } : {}) } }));
    return { data, results: { total: this.entries.length, returned: data.length, before: Math.min(before, this.entries.length), after: Math.max(0, this.entries.length - before - data.length) } };
  }
  async fetchMatchDetail(_input: unknown, id: string) {
    this.detailCalls += 1;
    if (this.failDetailOnce) { const failure = this.failDetailOnce; this.failDetailOnce = undefined; throw failure; }
    const n = Number(id.split('-').at(-1));
    if (this.unavailable.has(n)) throw new PublicApiError(404, 'PROVIDER_ERROR', 'not found');
    return { status: 200, data: detail(n) };
  }
}

async function setup(known: number[]) {
  const database = new PGliteDatabase(new PGlite());
  await applyMigrations(database, await loadMigrations('migrations'));
  const durable = new DurableEvidenceService(database, hmacKey);
  const store = new PostgresSyncStore(database);
  const { publicPlayerId } = await durable.persistConnection(connection, 'fictional-consenting-participant', '2026-10-01T00:00:00.000Z');
  const playerId = (await database.query<{ id: string }>('SELECT id FROM players WHERE public_id=$1', [publicPlayerId])).rows[0]!.id;
  // Already-durable matches (the Phase-3 overlap): source match + this account's participant row.
  for (let i = 0; i < known.length; i += 400) {
    const slice = known.slice(i, i + 400);
    await database.query(`INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,first_observed_at,last_observed_at,public_id)
      SELECT gen_random_uuid(), $1, 'HenrikDev', h, 'v4', 'durable-evidence-v2', 'ap', now(), now(), gen_random_uuid() FROM unnest($2::text[]) AS h`,
    [squadId, slice.map((n) => sourceMatchHmac('HenrikDev', matchId(n), hmacKey))]);
    await database.query(`INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,stats_evidence_status)
      SELECT gen_random_uuid(), sm.id, $1, md5(sm.id::text) || md5(sm.public_id::text), 'Blue', 'observed' FROM source_matches sm
      WHERE sm.provider_match_lookup_hmac = ANY($2::text[])`, [playerId, slice.map((n) => sourceMatchHmac('HenrikDev', matchId(n), hmacKey))]);
  }
  return { database, durable, store, publicPlayerId: publicPlayerId! };
}

interface CrawlResult { indexCalls: number; detailCalls: number; discovered: string[]; status: string; sourceExhausted: boolean; storedExhausted: boolean; chunks: number; maxProviderPerChunk: number; detailUnavailable: number }

/** Drive one deep_backfill run to completion (live_v4 is empty → stored_index). */
async function crawl(env: Awaited<ReturnType<typeof setup>>, provider: StoredIndexProvider, storedPageSize?: number, limit = 5000): Promise<CrawlResult> {
  const before = new Set((await env.database.query<{ h: string }>('SELECT provider_match_lookup_hmac AS h FROM source_matches')).rows.map((r) => r.h));
  const service = new HistoricalSyncService(env.store, env.durable, provider as never, hmacKey, storedPageSize ? { storedPageSize } : {});
  let progress = await service.start(env.publicPlayerId, 'deep_backfill');
  let chunks = 1; let maxProviderPerChunk = progress.performance.providerRequests;
  let previous = progress.performance.providerRequests;
  while (progress.status !== 'complete' && chunks < limit) {
    progress = await service.continue(progress.runId);
    chunks += 1;
    maxProviderPerChunk = Math.max(maxProviderPerChunk, progress.performance.providerRequests - previous);
    previous = progress.performance.providerRequests;
  }
  const after = (await env.database.query<{ h: string }>('SELECT provider_match_lookup_hmac AS h FROM source_matches')).rows.map((r) => r.h);
  return { indexCalls: provider.indexCalls, detailCalls: provider.detailCalls, discovered: after.filter((h) => !before.has(h)).sort(),
    status: progress.status, sourceExhausted: progress.history!.sourceExhausted, storedExhausted: progress.history!.storedHistoryExhausted,
    chunks, maxProviderPerChunk, detailUnavailable: progress.progress.detailUnavailableCount ?? 0 };
}

/** Deterministic unknown selection (mulberry32). */
function pick(total: number, unknown: number, seed: number): Set<number> {
  let a = seed >>> 0; const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const set = new Set<number>();
  while (set.size < unknown) set.add(Math.floor(rand() * total));
  return set;
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

async function oldVersusNew(entries: number[], unknownSet: Set<number>, configure: (p: StoredIndexProvider) => void = () => undefined) {
  const known = entries.filter((n) => !unknownSet.has(n));
  const oldEnv = await setup(known); const oldProvider = new StoredIndexProvider([...entries]); configure(oldProvider);
  const old = await crawl(oldEnv, oldProvider, 3);
  const newEnv = await setup(known); const newProvider = new StoredIndexProvider([...entries]); configure(newProvider);
  const fresh = await crawl(newEnv, newProvider);
  return { old, fresh, newProvider };
}

const benchmark: Record<string, unknown>[] = [];

describe('stored-index-efficiency-v1: exact discovery parity and request reduction', () => {
  it('uses a stored page size separate from live_v4 and versions the cursor', () => {
    expect(STORED_INDEX_PAGE_SIZE).toBe(20);
    expect(DEEP_HISTORY_RULE_VERSION).toBe('deep-history-v2');
  });

  it.each([
    ['A: 1,500 entries, all already durable', 1500, 0],
    ['B: 1,500 entries, 14 unknown (Phase-3 overlap density)', 1500, 14],
    ['C: 600 entries, 50% unknown', 600, 300],
  ] as const)('%s', async (name, total, unknownCount) => {
    const entries = range(total);
    const unknown = pick(total, unknownCount, 1234 + total + unknownCount);
    const { old, fresh, newProvider } = await oldVersusNew(entries, unknown);
    const expected = [...unknown].map((n) => sourceMatchHmac('HenrikDev', matchId(n), hmacKey)).sort();
    // Exactness: both algorithms discover EXACTLY the unknown set, reach the same exhaustion conclusion.
    expect(old.discovered).toEqual(expected);
    expect(fresh.discovered).toEqual(expected);
    expect({ status: fresh.status, sourceExhausted: fresh.sourceExhausted, storedExhausted: fresh.storedExhausted })
      .toEqual({ status: old.status, sourceExhausted: old.sourceExhausted, storedExhausted: old.storedExhausted });
    expect(fresh.sourceExhausted).toBe(true);
    // Bounded per invocation: 1 index + at most 1 detail; detail count is exactly the unknown count.
    expect(fresh.maxProviderPerChunk).toBeLessThanOrEqual(2);
    expect(fresh.detailCalls).toBe(unknownCount);
    expect(old.detailCalls).toBe(unknownCount);
    expect(newProvider.maxRequestedSize).toBe(20);
    const reduction = 1 - fresh.indexCalls / old.indexCalls;
    benchmark.push({ scenario: name, entries: total, unknown: unknownCount, oldIndex: old.indexCalls, newIndex: fresh.indexCalls, details: fresh.detailCalls,
      oldTotal: old.indexCalls + old.detailCalls, newTotal: fresh.indexCalls + fresh.detailCalls, indexReductionPct: Math.round(reduction * 1000) / 10 });
    if (unknownCount <= 14) expect(reduction).toBeGreaterThanOrEqual(0.8);
  }, 600_000);

  it('D: unknown entries clustered at page boundaries are all discovered', async () => {
    const entries = range(400);
    const unknown = new Set([0, 19, 20, 39, 40, 59, 60, 61, 199, 200, 201, 399]);
    const { old, fresh } = await oldVersusNew(entries, unknown);
    expect(fresh.discovered).toEqual(old.discovered);
    expect(fresh.discovered).toHaveLength(unknown.size);
  }, 300_000);

  it('F: a detail 404 is counted as unavailable, fabricates nothing, and the walk continues', async () => {
    const entries = range(120);
    const unknown = new Set([5, 30, 31, 90]);
    const { old, fresh } = await oldVersusNew(entries, unknown, (p) => { p.unavailable.add(30); });
    expect(fresh.discovered).toEqual(old.discovered);
    expect(fresh.discovered).toHaveLength(3);
    expect(fresh.detailUnavailable).toBe(1);
    expect(fresh.sourceExhausted).toBe(true);
  }, 300_000);

  it('E: mutable index — matches stored at the front between continuations are never skipped', async () => {
    const entries = range(300).map((n) => n + 1000);
    const unknown = new Set([1003, 1050, 1150, 1290]);
    const env = await setup(entries.filter((n) => !unknown.has(n)));
    const provider = new StoredIndexProvider([...entries]);
    // Newest-first growth: new matches appear at the FRONT (shifting every later page) during the walk.
    const arrivals = [1, 2, 3, 4, 5];
    provider.beforeIndexCall = (call) => { if (call % 4 === 0 && arrivals.length) provider.entries.unshift(arrivals.shift()!); };
    const result = await crawl(env, provider);
    // Every pre-existing unknown is found; arrivals ahead of the cursor are left for later runs (never fabricated).
    for (const n of unknown) expect(result.discovered).toContain(sourceMatchHmac('HenrikDev', matchId(n), hmacKey));
    expect(result.sourceExhausted).toBe(true);
    const duplicates = await env.database.query<{ n: string }>('SELECT count(*)::text AS n FROM (SELECT provider_match_lookup_hmac FROM source_matches GROUP BY 1 HAVING count(*) > 1) d');
    expect(Number(duplicates.rows[0]!.n)).toBe(0);
  }, 300_000);

  it('E2: a page that changes mid-way (shift inside the in-progress page) restarts that page, never skips', async () => {
    const entries = range(60);
    const unknown = new Set([10, 11, 12]);
    const env = await setup(entries.filter((n) => !unknown.has(n)));
    const provider = new StoredIndexProvider([...entries]);
    // After the first detail on page 1 the index shifts by 7 (new matches at the front).
    provider.beforeIndexCall = (call) => { if (call === 3) provider.entries.unshift(900, 901, 902, 903, 904, 905, 906); };
    const result = await crawl(env, provider);
    for (const n of unknown) expect(result.discovered).toContain(sourceMatchHmac('HenrikDev', matchId(n), hmacKey));
  }, 300_000);
});

describe('stored-index-efficiency-v1: cursor transition, resume, season, accounting', () => {
  it('upgrades a deep-history-v1 stored_index cursor by restarting stored discovery at page 1 (no skipped entry)', async () => {
    const entries = range(240);
    const unknown = new Set([2, 70, 71, 150, 239]);
    const env = await setup(entries.filter((n) => !unknown.has(n)));
    // Phase-3-like legacy state: a v1 run deep inside stored_index (size-3 pages), mid-page.
    const legacy = new StoredIndexProvider([...entries]);
    const oldService = new HistoricalSyncService(env.store, env.durable, legacy as never, hmacKey, { storedPageSize: 3 });
    let progress = await oldService.start(env.publicPlayerId, 'deep_backfill');
    for (let i = 0; i < 30; i += 1) progress = await oldService.continue(progress.runId);
    await env.database.query("UPDATE sync_cursors SET history_rule_version='deep-history-v1'");
    const legacyCursor = (await env.database.query<{ stored_page: number; stored_item_index: number }>('SELECT stored_page, stored_item_index FROM sync_cursors')).rows[0]!;
    expect(legacyCursor.stored_page).toBeGreaterThan(1);
    // Meanwhile the mutable index gained a match at the front and an unknown exists before the old position.
    const fresh = new StoredIndexProvider([77_777, ...entries]);
    const newService = new HistoricalSyncService(env.store, env.durable, fresh as never, hmacKey);
    progress = await newService.continue(progress.runId);
    // Restarted at page 1 under the new page size (the old coordinates are never offset-rebased).
    expect(fresh.requestedPages[0]).toBe(1);
    expect(progress.history).toMatchObject({ ruleVersion: 'deep-history-v2', historyPhase: 'stored_index' });
    expect(progress.history!.storedPage).toBeLessThanOrEqual(2);
    while (progress.status !== 'complete') progress = await newService.continue(progress.runId);
    const all = (await env.database.query<{ h: string }>('SELECT provider_match_lookup_hmac AS h FROM source_matches')).rows.map((r) => r.h);
    for (const n of [...unknown, 77_777]) expect(all).toContain(sourceMatchHmac('HenrikDev', matchId(n), hmacKey));
    expect(new Set(all).size).toBe(all.length);
    // A complete v1 cursor is NOT reopened by the version change.
    await env.database.query("UPDATE sync_cursors SET history_rule_version='deep-history-v1'");
    const callsBefore = fresh.indexCalls;
    const again = await newService.continue(progress.runId);
    expect(again.status).toBe('complete');
    expect(fresh.indexCalls).toBe(callsBefore);
  }, 300_000);

  it('crash/resume: index timeout, detail timeout and a failed cursor commit never skip or duplicate', async () => {
    const entries = range(100);
    const unknown = new Set([4, 25, 26, 80]);
    const env = await setup(entries.filter((n) => !unknown.has(n)));
    const provider = new StoredIndexProvider([...entries]);
    const service = new HistoricalSyncService(env.store, env.durable, provider as never, hmacKey, { now: () => new Date('2026-10-07T00:00:00Z') });
    let progress = await service.start(env.publicPlayerId, 'deep_backfill');
    const step = async () => { try { progress = await service.continue(progress.runId); } catch { progress = (await env.store.status(progress.runId))!; } };
    // 1) detail timeout (before persistence)
    provider.failDetailOnce = new PublicApiError(504, 'PROVIDER_TIMEOUT', 'timeout');
    await step();
    // 2) cursor commit failure after a detail was persisted (evidence committed, cursor not)
    const spy = vi.spyOn(env.store, 'recordSuccess').mockRejectedValueOnce(Object.assign(new Error('injected'), { code: '57P01' }));
    await step(); spy.mockRestore();
    // 3) index timeout
    const original = provider.fetchStoredIndexPage.bind(provider);
    let failIndex = true;
    provider.fetchStoredIndexPage = async (...args: Parameters<StoredIndexProvider['fetchStoredIndexPage']>) => {
      if (failIndex) { failIndex = false; throw new PublicApiError(504, 'PROVIDER_TIMEOUT', 'timeout'); }
      return original(...args);
    };
    await step();
    // Resume (paused runs wait for nextAttemptAt; the service clock is fixed, so clear it like time passing).
    for (let i = 0; i < 40 && progress.status !== 'complete'; i += 1) {
      await env.database.query('UPDATE sync_cursors SET next_attempt_at=NULL');
      await step();
    }
    expect(progress.status).toBe('complete');
    const all = (await env.database.query<{ h: string }>('SELECT provider_match_lookup_hmac AS h FROM source_matches')).rows.map((r) => r.h);
    for (const n of unknown) expect(all).toContain(sourceMatchHmac('HenrikDev', matchId(n), hmacKey));
    expect(new Set(all).size).toBe(all.length);
  }, 300_000);

  it('fills missing season evidence for every known entry on the larger page', async () => {
    const entries = range(45);
    const env = await setup(entries);
    const provider = new StoredIndexProvider([...entries]);
    for (const n of entries) provider.seasons.set(n, { id: '0a1b2c3d-0000-4000-8000-000000000011', short: 'e9a3' });
    const result = await crawl(env, provider);
    expect(result.indexCalls).toBe(3);
    const filled = await env.database.query<{ n: string }>("SELECT count(*)::text AS n FROM source_matches WHERE season_short='e9a3'");
    expect(Number(filled.rows[0]!.n)).toBe(45);
  }, 300_000);

  it('repeated identical pages stall (never exhaust), and after=0 is the only exhaustion signal on a full page', async () => {
    const env = await setup(range(40));
    const provider = new StoredIndexProvider(range(40));
    // Page 2 returns page 1's entries again (provider repetition) while claiming more exist.
    provider.fetchStoredIndexPage = async (_input: unknown, _page: number, size: number) => {
      provider.indexCalls += 1;
      const data = range(size).map((n) => ({ meta: { id: matchId(n) } }));
      return { data, results: { total: 100, returned: data.length, before: 0, after: 100 - data.length } };
    };
    const service = new HistoricalSyncService(env.store, env.durable, provider as never, hmacKey);
    let progress = await service.start(env.publicPlayerId, 'deep_backfill');
    progress = await service.continue(progress.runId);
    progress = await service.continue(progress.runId);
    expect(progress).toMatchObject({ status: 'paused', lastErrorCategory: 'PROVIDER_PAGINATION_UNSTABLE', history: { sourceExhausted: false, storedHistoryExhausted: false, lifetimeComplete: false } });
  }, 300_000);

  it('consent revocation stops a stored-index continuation before any provider call', async () => {
    const env = await setup(range(20));
    const provider = new StoredIndexProvider(range(60));
    const service = new HistoricalSyncService(env.store, env.durable, provider as never, hmacKey);
    const progress = await service.start(env.publicPlayerId, 'deep_backfill');
    await env.database.query("UPDATE consents SET status='revoked', revoked_at=now()");
    const calls = provider.indexCalls;
    await expect(service.continue(progress.runId)).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(provider.indexCalls).toBe(calls);
  }, 120_000);

  it('rejects more rows than the requested stored page size (fail closed)', async () => {
    const env = await setup([]);
    const provider = new StoredIndexProvider(range(10));
    provider.fetchStoredIndexPage = async () => ({ data: range(21).map((n) => ({ meta: { id: matchId(n) } })), results: { total: 21, returned: 21, before: 0, after: 0 } });
    const service = new HistoricalSyncService(env.store, env.durable, provider as never, hmacKey);
    const progress = await service.start(env.publicPlayerId, 'deep_backfill');
    await expect(service.continue(progress.runId)).rejects.toMatchObject({ code: 'MALFORMED_PROVIDER_RESPONSE' });
  }, 120_000);

  it('prints the request benchmark', () => {
    process.stdout.write(`STORED_INDEX_BENCHMARK ${JSON.stringify(benchmark)}\n`);
    expect(benchmark.length).toBeGreaterThan(0);
  });
});
