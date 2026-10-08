import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { RebuildCollector } from '../server/rebuildStaging/collector';
import { buildMemberCache, MemberCacheError } from '../server/rebuildStaging/memberCache';
import { createRebuildProvider, type RequestRecord } from '../server/rebuildStaging/providerGateway';
import { REBUILD_MAX_REQUESTS_PER_WINDOW, RollingWindowLimiter, runLanes } from '../server/rebuildStaging/rateLimiter';
import { buildCoverageReport } from '../server/rebuildStaging/report';
import { sanitizedEvent, UnsafeLogError } from '../server/rebuildStaging/safeLog';
import { RebuildStagingStore, StagingIsolationError } from '../server/rebuildStaging/stagingStore';

/**
 * TASK-DATA-LOCAL-REBUILD-COLLECT-01 private collector: 6-per-minute ceiling, 2-lane ceiling, resumability,
 * global dedupe / one detail per unique match, staging isolation, no canonical writes, no public imports,
 * sanitized logs. Synthetic accounts and an in-memory fake Henrik API only (no network, no real data).
 */
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

const KEY = 'test-rebuild-key-0123456789abcdef0123456789abcdef';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const matchId = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACCOUNTS = [
  { accountPublicId: uuid(1), memberPublicId: uuid(101), communityName: '甲', gameName: 'FakeOne', tag: 'T01', isPrimary: true, puuid: 'puuid-fake-one', matches: range(1, 20) },
  { accountPublicId: uuid(2), memberPublicId: uuid(102), communityName: '乙', gameName: 'FakeTwo', tag: 'T02', isPrimary: true, puuid: 'puuid-fake-two', matches: range(11, 30) },
];
function range(from: number, to: number) { return Array.from({ length: to - from + 1 }, (_, i) => from + i); }
const LIVE_DEPTH = 4;
const STORED_PAGE = 5;

function documentFor(n: number) {
  const players = ACCOUNTS.filter((account) => account.matches.includes(n)).map((account) => ({ puuid: account.puuid }));
  return { metadata: { match_id: matchId(n), started_at: new Date(Date.UTC(2025, 0, n)).toISOString(), queue: { id: n % 5 === 0 ? 'unrated' : 'competitive' },
    map: { name: 'Ascent' }, season: { short: 'e9a1' } }, players };
}

/** Fake Henrik API; `fail` can inject one status for the next N matching requests. */
function fakeHenrik() {
  const calls: { path: string; detailId?: string }[] = [];
  const fail: { pattern?: RegExp; status?: number; times: number } = { times: 0 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname);
    calls.push({ path });
    if (fail.times > 0 && fail.pattern?.test(path)) { fail.times -= 1; return json({ errors: [] }, fail.status); }
    const byName = (name: string, tag: string) => ACCOUNTS.find((account) => account.gameName === name && account.tag === tag);
    let match = /^\/valorant\/v2\/account\/([^/]+)\/([^/]+)$/u.exec(path);
    if (match) { const account = byName(match[1]!, match[2]!); return account ? json({ data: { name: account.gameName, tag: account.tag, puuid: account.puuid, region: 'ap' } }) : json({}, 404); }
    match = /^\/valorant\/v4\/matches\/ap\/pc\/([^/]+)\/([^/]+)$/u.exec(path);
    if (match) {
      const account = byName(match[1]!, match[2]!)!;
      const newest = [...account.matches].reverse().slice(0, LIVE_DEPTH);
      const start = Number(url.searchParams.get('start')); const size = Number(url.searchParams.get('size'));
      return json({ data: newest.slice(start, start + size).map(documentFor) });
    }
    match = /^\/valorant\/v1\/stored-matches\/ap\/([^/]+)\/([^/]+)$/u.exec(path);
    if (match) {
      const account = byName(match[1]!, match[2]!)!;
      const all = [...account.matches].reverse();
      const page = Number(url.searchParams.get('page')); const size = Number(url.searchParams.get('size'));
      const rows = all.slice((page - 1) * size, page * size);
      const before = Math.min(all.length, (page - 1) * size);
      return json({ results: { total: all.length, returned: rows.length, before, after: all.length - before - rows.length },
        data: rows.map((n) => ({ meta: { id: matchId(n), mode: n % 5 === 0 ? 'Unrated' : 'Competitive', started_at: new Date(Date.UTC(2025, 0, n)).toISOString(),
          map: { name: 'Ascent' }, season: { short: 'e9a1' } }, stats: { puuid: account.puuid } })) });
    }
    match = /^\/valorant\/v4\/match\/ap\/([^/]+)$/u.exec(path);
    if (match) { calls[calls.length - 1]!.detailId = match[1]; const n = Number(match[1]!.slice(-12)); return json({ data: documentFor(n) }); }
    return json({}, 404);
  };
  return { fetchImpl, calls, fail };
}

/** Fake clock: sleeping advances time instantly, so a 6-per-minute ceiling costs no wall time. */
function fakeClock() {
  let now = 1_700_000_000_000;
  return { now: () => now, sleep: async (ms: number) => { now += ms; } };
}

async function harness(options: { maxProviderRequests?: number; db?: PGliteDatabase; henrik?: ReturnType<typeof fakeHenrik>; clock?: ReturnType<typeof fakeClock> } = {}) {
  const db = options.db ?? new PGliteDatabase(new PGlite());
  const henrik = options.henrik ?? fakeHenrik();
  const clock = options.clock ?? fakeClock();
  const store = new RebuildStagingStore(db, KEY);
  await store.initialize();
  await store.upsertAccounts(ACCOUNTS.map((account) => ({ accountPublicId: account.accountPublicId, memberPublicId: account.memberPublicId,
    communityName: account.communityName, gameName: account.gameName, tag: account.tag, isPrimary: account.isPrimary })));
  const limiter = new RollingWindowLimiter({ now: clock.now, sleep: clock.sleep });
  const starts: number[] = [];
  const lines: string[] = [];
  const observer: { collector?: RebuildCollector } = {};
  const provider = createRebuildProvider({ apiKey: 'HDEV-test', limiter, fetchImpl: henrik.fetchImpl, now: clock.now,
    record: async (request: RequestRecord) => { observer.collector?.observe(request); starts.push(Date.parse(request.at)); await store.recordRequest(request); } });
  const collector = new RebuildCollector({ store, provider, limiter, sink: (line) => lines.push(line), maxProviderRequests: options.maxProviderRequests ?? 1_000,
    now: clock.now, sleep: clock.sleep, storedPageSize: STORED_PAGE });
  observer.collector = collector;
  return { db, henrik, clock, store, limiter, collector, starts, lines };
}

const maxInWindow = (starts: number[], windowMs = 60_000) => Math.max(0, ...starts.map((start) => starts.filter((other) => other > start - windowMs && other <= start).length));

describe('rate and lane ceilings', () => {
  it('never starts more than 6 requests in any rolling 60 s window, and refuses a higher configured rate', async () => {
    const clock = fakeClock();
    const limiter = new RollingWindowLimiter({ now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    for (let i = 0; i < 40; i += 1) { await limiter.acquire(); starts.push(clock.now()); }
    expect(maxInWindow(starts)).toBe(REBUILD_MAX_REQUESTS_PER_WINDOW);
    expect(limiter.maxObservedInWindow()).toBe(6);
    // Jitter guard: any 7 consecutive starts span >= 61 s, so sub-second send jitter cannot fit 7 into 60 s.
    for (let i = 6; i < starts.length; i += 1) expect(starts[i]! - starts[i - 6]!).toBeGreaterThanOrEqual(61_000);
    expect(() => new RollingWindowLimiter({ maxRequests: 7 })).toThrow(/1\.\.6/u);
    expect(() => new RollingWindowLimiter({ windowMs: 30_000 })).toThrow(/60 s/u);
  });

  it('a request queued behind the limiter never times out while waiting (timeout starts at the real request)', async () => {
    let fakeNow = 1_700_000_000_000;
    // Each limiter wait takes REAL time longer than the request timeout (the pre-fix client timer fired here).
    const limiter = new RollingWindowLimiter({ now: () => fakeNow, sleep: async (ms) => { await new Promise((r) => setTimeout(r, 120)); fakeNow += ms; } });
    const henrik = fakeHenrik();
    const records: RequestRecord[] = [];
    const provider = createRebuildProvider({ apiKey: 'HDEV-test', limiter, fetchImpl: henrik.fetchImpl, timeoutMs: 60, now: () => fakeNow,
      record: (request) => { records.push(request); } });
    for (let i = 0; i < 7; i += 1) await provider.fetchAccount('FakeOne', 'T01');
    expect(records.map((record) => record.outcome)).toEqual(Array(7).fill('ok'));
  });

  it('seeds earlier processes\' request starts, so a restart cannot exceed the ceiling across processes', async () => {
    const clock = fakeClock();
    const limiter = new RollingWindowLimiter({ now: clock.now, sleep: clock.sleep });
    const previous = [clock.now() - 50_000, clock.now() - 40_000, clock.now() - 30_000, clock.now() - 20_000, clock.now() - 10_000, clock.now() - 120_000];
    limiter.seed(previous);
    const starts: number[] = [];
    for (let i = 0; i < 3; i += 1) { await limiter.acquire(); starts.push(clock.now()); }
    expect(maxInWindow([...previous, ...starts])).toBeLessThanOrEqual(6);
    expect(starts[1]! - clock.now()).toBeLessThan(0); // later acquisitions had to wait for the seeded window
    const lower = new RollingWindowLimiter({ maxRequests: 3, now: clock.now, sleep: clock.sleep });
    const lowStarts: number[] = [];
    for (let i = 0; i < 10; i += 1) { await lower.acquire(); lowStarts.push(clock.now()); }
    expect(maxInWindow(lowStarts)).toBe(3);
  });

  it('records only numeric provider rate-limit headers', async () => {
    const { rateLimitHeaders } = await import('../server/rebuildStaging/providerGateway');
    expect(rateLimitHeaders(new Headers({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': '41' }))).toEqual({ limit: 30, remaining: 2, reset: 41 });
    expect(rateLimitHeaders(new Headers({ 'x-ratelimit-limit': 'abc' }))).toBeUndefined();
  });

  it('pauses until the provider reset when its reported remaining budget is nearly spent', async () => {
    const clock = fakeClock();
    const limiter = new RollingWindowLimiter({ now: clock.now, sleep: clock.sleep });
    const fetchImpl = async () => new Response(JSON.stringify({ data: { name: 'FakeOne', tag: 'T01', puuid: 'p', region: 'ap' } }),
      { status: 200, headers: { 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': '30' } });
    const starts: number[] = [];
    const provider = createRebuildProvider({ apiKey: 'HDEV-test', limiter, fetchImpl, now: clock.now, record: (request) => { starts.push(Date.parse(request.at)); } });
    await provider.fetchAccount('FakeOne', 'T01');
    await provider.fetchAccount('FakeOne', 'T01');
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(31_000);
  });

  it('runs at most 2 lanes concurrently and refuses 3', async () => {
    let active = 0; let peak = 0;
    await runLanes(range(1, 12), 2, async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 2)); active -= 1; });
    expect(peak).toBe(2);
    await expect(runLanes([1], 3, async () => undefined)).rejects.toThrow(/1\.\.2/u);
  });
});

describe('private staging collection (fake provider)', () => {
  it('resolves, discovers and hydrates: global dedupe, exactly one detail per unique match, ≤ 6 per minute', async () => {
    const h = await harness();
    expect(await h.collector.resolve(true)).toEqual({ resolved: 1, unresolved: 1 });
    expect(await h.collector.resolve()).toEqual({ resolved: 2, unresolved: 0 });
    await h.collector.discover();
    await h.collector.hydrate();
    const report = await buildCoverageReport(h.db);
    expect(report.uniqueDiscovered).toBe(30);
    expect(report.discoveredLinks).toBe(40);
    expect(report.duplicateDiscoveries).toBe(10);
    expect(report.uniqueHydrated).toBe(30);
    const details = h.henrik.calls.filter((call) => call.detailId).map((call) => call.detailId!);
    expect(new Set(details).size).toBe(details.length); // never the same match twice
    expect(details.length).toBe(30 - 2 * LIVE_DEPTH); // live history documents are hydrated for free
    expect(h.collector.result().stopReason).toBeNull();
    expect(maxInWindow(h.starts)).toBeLessThanOrEqual(6);
    expect(report.maxRequestsInAnyRollingMinute).toBeLessThanOrEqual(6);
    expect(report.integrity).toMatchObject({ duplicate_matches: 0, duplicate_payloads: 0, orphan_links: 0, malformed_payloads: 0,
      missing_timestamps: 0, account_identity_mismatches: 0, hydration_failures: 0, unresolved_accounts: 0 });
    expect(report.competitiveByYear['甲']).toEqual({ 2025: 16 });
    expect(report.lifetimeComplete).toBe(false);
    expect(report.cursors.every((cursor) => cursor.exhausted)).toBe(true);
  });

  it('is resumable: a budget stop continues where it left off, with no repeated detail fetch', async () => {
    const db = new PGliteDatabase(new PGlite());
    const henrik = fakeHenrik();
    const clock = fakeClock();
    let first = await harness({ db, henrik, clock, maxProviderRequests: 7 });
    await first.collector.resolve();
    await first.collector.discover();
    expect(first.collector.result().stopReason).toBe('budget_reached');
    for (let round = 0; round < 20; round += 1) {
      first = await harness({ db, henrik, clock, maxProviderRequests: 5 });
      await first.collector.discover();
      if (first.collector.result().stopReason) continue;
      await first.collector.hydrate();
      if (!first.collector.result().stopReason) break;
    }
    const report = await buildCoverageReport(db);
    expect(report.uniqueDiscovered).toBe(30);
    expect(report.uniqueHydrated).toBe(30);
    const details = henrik.calls.filter((call) => call.detailId).map((call) => call.detailId!);
    expect(new Set(details).size).toBe(details.length);
    expect(henrik.calls.filter((call) => call.path.includes('/v2/account/')).length).toBe(2); // resolved accounts are never looked up again
  });

  it('stops fail-closed on 429 and on a rejected credential, keeping state', async () => {
    const h = await harness();
    await h.collector.resolve();
    h.henrik.fail.pattern = /stored-matches/u; h.henrik.fail.status = 429; h.henrik.fail.times = 1;
    await h.collector.discover();
    expect(h.collector.result().stopReason).toBe('provider_429');
    const rejected = await harness();
    rejected.henrik.fail.pattern = /\/v2\/account\//u; rejected.henrik.fail.status = 401; rejected.henrik.fail.times = 5;
    await rejected.collector.resolve(true);
    expect(rejected.collector.result().stopReason).toBe('credential_rejected');
    expect(rejected.henrik.calls.length).toBe(1); // one validation request, never retried
  });

  it('refuses an application database and writes nothing outside the private schema', async () => {
    const canonical = new PGliteDatabase(new PGlite());
    await canonical.query('CREATE TABLE consents (id uuid PRIMARY KEY)');
    await expect(new RebuildStagingStore(canonical, KEY).initialize()).rejects.toBeInstanceOf(StagingIsolationError);
    const h = await harness();
    await h.collector.resolve(); await h.collector.discover();
    const outside = await h.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('rebuild_staging','pg_catalog','information_schema')`);
    expect(outside.rows[0]!.n).toBe(0);
  });

  /**
   * Structural check: every line is JSON whose `at` is a well-formed timestamp; secrets are searched in everything
   * EXCEPT that timestamp (an ISO time such as 2026-10-08T01:13:08Z contains the fake tag "T01" by coincidence).
   */
  const sanitizedContent = (lines: readonly string[]) => lines.map((line) => {
    const { at, ...rest } = JSON.parse(line) as Record<string, unknown>;
    expect(typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(at) && Number.isFinite(Date.parse(at)), line).toBe(true);
    return JSON.stringify(rest);
  }).join('\n');
  const secrets = () => [...ACCOUNTS.flatMap((a) => [a.gameName, a.tag, a.puuid, a.accountPublicId]), matchId(1), matchId(30), 'HDEV-test'];

  it('logs only sanitized counters (no Riot IDs, provider ids or match ids)', async () => {
    const h = await harness();
    await h.collector.resolve(); await h.collector.discover(); await h.collector.hydrate();
    expect(h.lines.length).toBeGreaterThan(0);
    const content = sanitizedContent(h.lines);
    for (const secret of secrets()) expect(content).not.toContain(secret);
    expect(() => sanitizedEvent('x', { value: matchId(3) })).toThrow(UnsafeLogError);
    expect(() => sanitizedEvent('x', { value: 'FakeOne#T01' })).toThrow(UnsafeLogError);
    expect(() => sanitizedEvent('x', { value: 'https://api.henrikdev.xyz' })).toThrow(UnsafeLogError);
    expect(sanitizedEvent('ok', { phase: 'discover', requests: 3 })).toContain('"phase":"discover"');
  });

  it('stays correct when the wall clock is inside the 01:00-01:59 UTC hour (the timestamp contains "T01")', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-08T01:30:00.000Z'));
      const h = await harness();
      await h.collector.resolve(); await h.collector.discover(); await h.collector.hydrate();
      expect(h.lines.join('\n')).toContain('T01:'); // the coincidental collision is present in the raw timestamps …
      const content = sanitizedContent(h.lines);
      for (const secret of secrets()) expect(content).not.toContain(secret); // … and never reaches the secret check
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('member cache (exact public mapping)', () => {
  const dataset = (players: unknown[]) => ({ schemaVersion: 6, snapshot: { version: 'v', identityVersion: 'member-identity-v2' }, dataset: { mode: 'REAL', players } });
  const player = (n: number, name: string, game: string) => ({ id: uuid(100 + n), displayName: name, accounts: [{ id: uuid(n), gameName: game, tag: `T${n}`, isPrimary: true }] });
  it('maps by exact game name and refuses a mismatch or a wrong account count', () => {
    const cache = buildMemberCache(dataset([player(1, '甲', 'FakeOne'), player(2, '乙', 'FakeTwo')]),
      [{ gameName: 'FakeOne', communityName: '甲' }, { gameName: 'FakeTwo', communityName: '乙' }], 2);
    expect(cache.members.map((m) => m.accounts[0]!.affinity)).toEqual([null, null]);
    expect(() => buildMemberCache(dataset([player(1, '甲', 'fakeone'), player(2, '乙', 'FakeTwo')]),
      [{ gameName: 'FakeOne', communityName: '甲' }, { gameName: 'FakeTwo', communityName: '乙' }], 2)).toThrow(MemberCacheError);
    expect(() => buildMemberCache(dataset([player(1, '甲', 'FakeOne')]), [{ gameName: 'FakeOne', communityName: '甲' }], 9)).toThrow(/exactly 9/u);
  });
});

describe('architecture isolation', () => {
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return ['node_modules', 'dist', 'dist-server', '.git'].includes(entry.name) ? [] : files(path);
      return /\.(ts|tsx|js|mjs)$/u.test(entry.name) ? [path] : [];
    }));
    return nested.flat();
  }
  it('the collector never imports canonical consent / persistence / dataset / sync-store code', async () => {
    for (const file of await files(resolve('server/rebuildStaging'))) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(/from '\.\.\/(persistence|dataset|repositories|deletion|staticExport|staticPublish)\//u);
      expect(source, file).not.toMatch(/postgresSyncStore|historicalSyncService|durableEvidenceService|privacyPolicy/u);
      // Reading to_regclass('public.consents') to REFUSE an application database is allowed; writing one never is.
      expect(source, file).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?(players|members|consents|provider_identities|source_matches|match_participants|sync_cursors|sync_runs|analysis_participant_facts)\b/u);
      expect(source, file).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+(?!rebuild_staging\.)[a-z_]+\b/u);
    }
  });
  it('nothing public (api/, src/, the app server, publishers) imports the collector', async () => {
    const roots = ['api', 'src', 'server', 'shared', 'scripts'].map((root) => resolve(root));
    for (const root of roots) {
      for (const file of await files(root)) {
        // Private maintainer tools may share the private gateway/limiter: the collector itself and rank ingestion.
        if (file.includes(`${join('server', 'rebuildStaging')}`) || file.includes(`${join('server', 'rankEvidence')}`)
          || file.endsWith(join('scripts', 'rebuild-collect.ts')) || file.endsWith(join('scripts', 'rank-ingest.ts'))
          // Private offline analysis tools over the staging store (never imported by public code).
          || file.endsWith(join('scripts', 'shared-match.ts')) || file.endsWith(join('scripts', 'internal-strength.ts'))
          || file.endsWith(join('scripts', 'event-metrics-rollout.ts')) || file.endsWith(join('scripts', 'agent-catalog-check.ts'))
          || file.endsWith(join('scripts', 'team-composition.ts')) || file.endsWith(join('scripts', 'position-evidence.ts'))) continue;
        const source = await readFile(file, 'utf8');
        expect(source, file).not.toMatch(/rebuildStaging|rebuild-collect/u);
      }
    }
  });
});
