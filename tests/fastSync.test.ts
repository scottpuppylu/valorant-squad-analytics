import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { PublicApiError } from '../server/errors';
import type { HistoricalMatchProvider } from '../server/henrikDataProvider';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { HistoricalSyncService } from '../server/sync/historicalSyncService';
import { PostgresSyncStore } from '../server/sync/postgresSyncStore';
import { AUTO_REFRESH_STALE_AFTER_MS, decideRecentRefresh, type RecentRefreshState } from '../server/sync/recentRefresh';
import { parseSyncStartInput } from '../server/validation';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { parseAnalysisRequest, ServerAnalysisService } from '../server/dataset/analysisService';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';

const hmacKey = 'test-fastsync-hmac-key-with-at-least-32-bytes';
const puuid = 'fictional-fastsync-participant';
const connection = { gameName: 'FastGoblin', tag: 'TW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;

class PGliteDatabase implements SqlDatabase {
  constructor(private readonly database: PGlite) {}
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.database.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.database.exec('BEGIN');
    try {
      const value = await work(this);
      await this.database.exec('COMMIT');
      return value;
    } catch (error) {
      await this.database.exec('ROLLBACK');
      throw error;
    }
  }
  async close(): Promise<void> { await this.database.close(); }
}

/** Newest-first provider history; `start` offsets index into it like Henrik v4 recent pages. */
class RecentProvider implements HistoricalMatchProvider {
  calls = 0;
  failure?: PublicApiError;
  onFetch?: () => Promise<void>;
  constructor(public history: string[]) {}
  async fetchHistoryPage(_input: unknown, start: number, size: number): Promise<unknown> {
    this.calls += 1;
    if (this.onFetch) { const hook = this.onFetch; this.onFetch = undefined; await hook(); }
    if (this.failure) throw this.failure;
    return { status: 200, data: this.history.slice(start, start + size).map(match) };
  }
}

/** id = "m<day>"; larger day = newer match. */
function match(id: string) {
  const day = Number(id.slice(1));
  return {
    metadata: {
      match_id: `fictional-fastsync-${id}`,
      started_at: new Date(Date.UTC(2026, 9, 1, 0) + day * 3600_000).toISOString(),
      game_length_in_ms: 1_800_000,
      map: { id: 'map-id', name: 'Ascent' },
      queue: { id: 'competitive', name: 'Competitive' },
    },
    players: [{
      puuid, name: connection.gameName, tag: connection.tag, team_id: 'Blue', agent: { id: 'agent-id', name: 'Sova' },
      stats: { kills: 10, deaths: 5, assists: 2, score: 200, headshots: 1, bodyshots: 1, legshots: 0, damage: { dealt: 1000, received: 800 } },
    }],
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 13, lost: 5 } }],
    rounds: [{ id: 1, winning_team: 'Blue', result: 'Eliminated', plant: null,
      stats: [{ player: { puuid }, stats: { kills: 1, score: 200 }, economy: { loadout_value: 0, remaining: 800 } }] }],
    kills: [],
  };
}

const min = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse('2026-10-05T12:00:00.000Z');

describe('recent-refresh-v1 decision (pure, server-authoritative)', () => {
  const state = (lastSuccessMinutesAgo?: number, extra: Partial<RecentRefreshState> = {}): RecentRefreshState => ({
    eligible: true,
    cursor: { version: '1', ...(lastSuccessMinutesAgo === undefined ? {} : { lastSuccessAt: iso(T0 - lastSuccessMinutesAgo * min) }) },
    latestRun: { publicId: 'run', status: 'complete' },
    ...extra,
  });
  const now = new Date(T0);

  it('no cursor → stale new run; the threshold is 30 minutes and exactly 30 is stale', () => {
    expect(AUTO_REFRESH_STALE_AFTER_MS).toBe(30 * min);
    expect(decideRecentRefresh({ eligible: true }, now)).toEqual({ decision: 'STALE', action: 'new_run', expectedVersion: null });
    expect(decideRecentRefresh(state(5), now)).toMatchObject({ decision: 'FRESH', nextEligibleAt: iso(T0 + 25 * min) });
    expect(decideRecentRefresh(state(29), now).decision).toBe('FRESH');
    expect(decideRecentRefresh(state(30 - 1 / 60_000), now).decision).toBe('FRESH');
    expect(decideRecentRefresh(state(30), now)).toEqual({ decision: 'STALE', action: 'new_run', expectedVersion: '1' });
    expect(decideRecentRefresh(state(31), now).decision).toBe('STALE');
  });

  it('active lease → busy; expired lease is not busy', () => {
    expect(decideRecentRefresh(state(60, { cursor: { version: '1', leaseExpiresAt: iso(T0 + 10_000) } }), now).decision).toBe('BUSY');
    expect(decideRecentRefresh(state(60, { cursor: { version: '1', leaseExpiresAt: iso(T0 - 10_000) } }), now).decision).toBe('STALE');
  });

  it('future next_attempt_at → backoff even for a paused run; never bypassed', () => {
    const backoff = { cursor: { version: '1', nextAttemptAt: iso(T0 + 5 * min) }, latestRun: { publicId: 'r', status: 'paused' as const } };
    expect(decideRecentRefresh(state(60, backoff), now)).toEqual({ decision: 'BACKOFF', nextEligibleAt: iso(T0 + 5 * min) });
  });

  it('ineligible (revoked, deleted, inactive, anonymized) → no provider work', () => {
    expect(decideRecentRefresh({ ...state(60), eligible: false }, now)).toEqual({ decision: 'INELIGIBLE' });
  });

  it('a paused incremental run continues without waiting for the completed-run cooldown', () => {
    const paused = state(1, { latestRun: { publicId: 'r', status: 'paused' } });
    expect(decideRecentRefresh(paused, now)).toEqual({ decision: 'CONTINUE_PENDING', runId: 'r', expectedVersion: '1' });
    expect(decideRecentRefresh(state(1), now).decision).toBe('FRESH');
  });

  it('a recent non-retryable failure is a cooldown; a stale one resumes the same run', () => {
    const failed = (minutes: number) => state(120, { cursor: { version: '1', lastSuccessAt: iso(T0 - 120 * min), lastErrorAt: iso(T0 - minutes * min) }, latestRun: { publicId: 'f', status: 'failed' } });
    expect(decideRecentRefresh(failed(5), now)).toEqual({ decision: 'BACKOFF', nextEligibleAt: iso(T0 + 25 * min) });
    expect(decideRecentRefresh(failed(31), now)).toEqual({ decision: 'STALE', action: 'resume_failed', runId: 'f', expectedVersion: '1' });
  });

  it('is deterministic', () => {
    const input = state(45);
    expect(decideRecentRefresh(input, now)).toEqual(decideRecentRefresh(structuredClone(input), new Date(T0)));
  });
});

describe('refresh_if_stale request contract', () => {
  const playerId = randomUUID();
  it('TASK-IDENTITY-01: sync input is an ACCOUNT id; accountId and legacy playerId are accepted and must agree', () => {
    const other = randomUUID();
    expect(parseSyncStartInput({ accountId: playerId, kind: 'incremental', intent: 'refresh_if_stale' })).toEqual({ playerId, kind: 'incremental', intent: 'refresh_if_stale' });
    expect(parseSyncStartInput({ accountId: playerId, playerId, kind: 'incremental' })).toEqual({ playerId, kind: 'incremental' });
    expect(() => parseSyncStartInput({ accountId: playerId, playerId: other, kind: 'incremental' })).toThrow();
    expect(() => parseSyncStartInput({ accountId: 'not-a-uuid', kind: 'incremental' })).toThrow();
  });

  it('accepts only the declared intent with incremental; existing callers are unchanged', () => {
    expect(parseSyncStartInput({ playerId, kind: 'incremental' })).toEqual({ playerId, kind: 'incremental' });
    expect(parseSyncStartInput({ playerId, kind: 'incremental', intent: 'refresh_if_stale' })).toEqual({ playerId, kind: 'incremental', intent: 'refresh_if_stale' });
    expect(() => parseSyncStartInput({ playerId, kind: 'backfill', intent: 'refresh_if_stale' })).toThrow();
    expect(() => parseSyncStartInput({ playerId, kind: 'incremental', intent: 'force' })).toThrow();
    // A client-supplied cooldown is never read.
    expect(parseSyncStartInput({ playerId, kind: 'incremental', intent: 'refresh_if_stale', staleAfterMs: 0 })).not.toHaveProperty('staleAfterMs');
  });
});

describe('opportunistic recent refresh (durable, race-safe)', () => {
  let database: PGliteDatabase;
  let durable: DurableEvidenceService;
  let store: PostgresSyncStore;
  let publicPlayerId: string;
  let now: number;
  let provider: RecentProvider;
  let service: HistoricalSyncService;
  const sourceCount = async () => Number((await database.query<{ c: string }>('SELECT count(*)::text AS c FROM source_matches')).rows[0]!.c);
  const advance = (minutes: number) => { now += minutes * min; };

  beforeEach(async () => {
    database = new PGliteDatabase(new PGlite());
    await applyMigrations(database, await loadMigrations('migrations'));
    durable = new DurableEvidenceService(database, hmacKey);
    store = new PostgresSyncStore(database);
    publicPlayerId = (await durable.persistConnection(connection, puuid, '2026-10-01T00:00:00.000Z')).publicPlayerId!;
    now = T0;
    provider = new RecentProvider(['m10']);
    service = new HistoricalSyncService(store, durable, provider, hmacKey, { now: () => new Date(now) });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(async () => { vi.restoreAllMocks(); await database.close(); });

  it('no cursor → one bounded provider chunk; a reload within 30 minutes makes no provider call', async () => {
    const first = await service.refreshIfStale(publicPlayerId);
    expect(first.refresh).toMatchObject({ status: 'refreshed', providerRequested: true, newMatches: 1, morePending: false, lastSuccessAt: iso(T0) });
    expect(first.sync).toMatchObject({ kind: 'incremental', status: 'complete' });
    expect(provider.calls).toBe(1);
    for (const minutes of [5, 24]) {
      advance(minutes);
      const fresh = await service.refreshIfStale(publicPlayerId);
      expect(fresh).toEqual({ refresh: { policyVersion: 'recent-refresh-v1', status: 'fresh', providerRequested: false, lastSuccessAt: iso(T0), nextEligibleAt: iso(T0 + 30 * min) } });
    }
    expect(provider.calls).toBe(1);
    advance(2); // 31 minutes
    provider.history = ['m11', 'm10'];
    const stale = await service.refreshIfStale(publicPlayerId);
    expect(stale.refresh).toMatchObject({ status: 'refreshed', providerRequested: true, newMatches: 1 });
    expect(provider.calls).toBe(2);
    expect(await sourceCount()).toBe(2);
  });

  it('0 new matches is a valid refresh (known boundary) and writes no duplicate', async () => {
    await service.refreshIfStale(publicPlayerId);
    advance(31);
    const again = await service.refreshIfStale(publicPlayerId);
    expect(again.refresh).toMatchObject({ status: 'refreshed', providerRequested: true, newMatches: 0, morePending: false });
    expect(again.sync?.terminationReason).toBe('short_page');
    expect(await sourceCount()).toBe(1);
  });

  it('empty page → refreshed with zero new matches', async () => {
    provider.history = [];
    const result = await service.refreshIfStale(publicPlayerId);
    expect(result.refresh).toMatchObject({ status: 'refreshed', newMatches: 0, morePending: false });
    expect(result.sync?.terminationReason).toBe('empty_page');
  });

  it('3 new matches stop at a known boundary; >3 pending stays paused and continues without the cooldown', async () => {
    provider.history = ['m10', 'm9', 'm8', 'm7'];
    await service.refreshIfStale(publicPlayerId); // seeds m10,m9,m8 (full page → paused)
    await service.refreshIfStale(publicPlayerId); // continues immediately: m7 short page → complete
    expect(provider.calls).toBe(2);
    advance(31);
    provider.history = ['m15', 'm14', 'm13', 'm12', 'm11', 'm10', 'm9', 'm8', 'm7'];
    const first = await service.refreshIfStale(publicPlayerId);
    expect(first.refresh).toMatchObject({ status: 'refreshed', newMatches: 3, morePending: true });
    // Same minute: a paused run is not blocked by the completed-run cooldown.
    const second = await service.refreshIfStale(publicPlayerId);
    expect(second.refresh).toMatchObject({ status: 'refreshed', newMatches: 2, morePending: false });
    expect(second.sync?.terminationReason).toBe('known_boundary');
    expect(provider.calls).toBe(4);
    const third = await service.refreshIfStale(publicPlayerId);
    expect(third.refresh).toMatchObject({ status: 'fresh', providerRequested: false });
    expect(provider.calls).toBe(4);
    expect(await sourceCount()).toBe(9);
    const duplicates = await database.query('SELECT provider_match_lookup_hmac FROM source_matches GROUP BY 1 HAVING count(*) > 1');
    expect(duplicates.rows).toHaveLength(0);
  });

  it('exactly 3 new matches then a known match completes on the next continuation', async () => {
    await service.refreshIfStale(publicPlayerId);
    advance(31);
    provider.history = ['m13', 'm12', 'm11', 'm10'];
    expect((await service.refreshIfStale(publicPlayerId)).refresh).toMatchObject({ newMatches: 3, morePending: true });
    expect((await service.refreshIfStale(publicPlayerId)).refresh).toMatchObject({ newMatches: 0, morePending: false });
    expect(await sourceCount()).toBe(4);
  });

  it.each([
    ['RATE_LIMITED', 429],
    ['PROVIDER_TIMEOUT', 504],
    ['PROVIDER_ERROR', 502],
  ] as const)('%s → backoff with the existing retry timing; repeated requests do not hammer', async (code, status) => {
    provider.failure = new PublicApiError(status, code, 'fixture');
    const failed = await service.refreshIfStale(publicPlayerId);
    expect(failed.refresh).toMatchObject({ status: 'backoff', providerRequested: true, errorCategory: code, nextEligibleAt: iso(T0 + 60_000) });
    for (let index = 0; index < 3; index += 1) {
      expect((await service.refreshIfStale(publicPlayerId)).refresh).toMatchObject({ status: 'backoff', providerRequested: false });
    }
    expect(provider.calls).toBe(1);
    provider.failure = undefined;
    advance(2);
    expect((await service.refreshIfStale(publicPlayerId)).refresh).toMatchObject({ status: 'refreshed', newMatches: 1 });
    expect(provider.calls).toBe(2);
  });

  it('an active lease (e.g. a running cron chunk) → busy, no provider call', async () => {
    const subject = (await store.findSubject(publicPlayerId))!;
    await store.acquireCursorLease(subject, 'incremental', iso(now), iso(now + 45_000));
    expect((await service.refreshIfStale(publicPlayerId)).refresh).toMatchObject({ status: 'busy', providerRequested: false });
    expect(provider.calls).toBe(0);
  });

  it('race: a concurrent request during provider work is busy and never fetches', async () => {
    let concurrent: Awaited<ReturnType<HistoricalSyncService['refreshIfStale']>> | undefined;
    provider.onFetch = async () => { concurrent = await service.refreshIfStale(publicPlayerId); };
    const winner = await service.refreshIfStale(publicPlayerId);
    expect(winner.refresh.status).toBe('refreshed');
    expect(concurrent?.refresh).toMatchObject({ status: 'busy', providerRequested: false });
    expect(provider.calls).toBe(1);
  });

  it('race: a request that decided "stale" before the winner committed re-checks under the lease and skips', async () => {
    await service.refreshIfStale(publicPlayerId);
    advance(45);
    const subject = (await store.findSubject(publicPlayerId))!;
    const observed = await store.recentRefreshState(subject); // B observes: 45 minutes old
    expect(decideRecentRefresh(observed, new Date(now)).decision).toBe('STALE');
    await service.refreshIfStale(publicPlayerId); // A wins and commits
    expect(provider.calls).toBe(2);
    const original = store.recentRefreshState.bind(store);
    vi.spyOn(store, 'recentRefreshState').mockResolvedValueOnce(observed).mockImplementation(original);
    const loser = await service.refreshIfStale(publicPlayerId); // B proceeds from its stale observation
    expect(loser.refresh).toMatchObject({ status: 'fresh', providerRequested: false });
    expect(provider.calls).toBe(2);
    expect(Number((await database.query<{ c: string }>("SELECT count(*)::text AS c FROM sync_runs WHERE sync_kind='incremental'")).rows[0]!.c)).toBe(2);
  });

  it('race: two first-ever requests (no cursor yet) → only one creates provider work', async () => {
    const subject = (await store.findSubject(publicPlayerId))!;
    const observed = await store.recentRefreshState(subject);
    expect(observed.cursor).toBeUndefined();
    await service.refreshIfStale(publicPlayerId);
    const original = store.recentRefreshState.bind(store);
    vi.spyOn(store, 'recentRefreshState').mockResolvedValueOnce(observed).mockImplementation(original);
    expect((await service.refreshIfStale(publicPlayerId)).refresh).toMatchObject({ status: 'fresh', providerRequested: false });
    expect(provider.calls).toBe(1);
  });

  it.each([
    ['revoked consent', "UPDATE consents SET status='revoked', revoked_at=now()"],
    ['old policy consent', "UPDATE consents SET privacy_version='obsolete'"],
    ['inactive membership', "UPDATE squad_memberships SET status='inactive'"],
    ['anonymized player', 'UPDATE players SET anonymized_at=now()'],
    ['open deletion job', "INSERT INTO deletion_jobs (id, public_id, player_id, status, requested_at) SELECT gen_random_uuid(), gen_random_uuid(), id, 'pending', now() FROM players"],
  ])('%s → unavailable, no provider request', async (_label, sql) => {
    await database.query(sql);
    expect((await service.refreshIfStale(publicPlayerId)).refresh).toEqual({ policyVersion: 'recent-refresh-v1', status: 'unavailable', providerRequested: false });
    expect(provider.calls).toBe(0);
  });

  it('revocation during provider work → no durable write', async () => {
    provider.onFetch = async () => { await database.query("UPDATE consents SET status='revoked', revoked_at=now()"); };
    expect((await service.refreshIfStale(publicPlayerId)).refresh).toMatchObject({ status: 'unavailable' });
    expect(await sourceCount()).toBe(0);
  });

  it('existing incremental start without intent keeps its behaviour (no freshness gate)', async () => {
    await service.refreshIfStale(publicPlayerId);
    advance(1);
    await service.start(publicPlayerId, 'incremental');
    expect(provider.calls).toBe(2);
  });

  it('opportunistic runs keep trigger_kind manual (no new DB value) and the response leaks no identifiers', async () => {
    const result = await service.refreshIfStale(publicPlayerId);
    expect((await database.query('SELECT trigger_kind FROM sync_runs')).rows).toEqual([{ trigger_kind: 'manual' }]);
    const text = JSON.stringify(result);
    const internal = await database.query<{ id: string; lease: string | null }>('SELECT p.id, sc.lease_token AS lease FROM players p CROSS JOIN sync_cursors sc');
    for (const forbidden of [puuid, 'fictional-fastsync-m10', hmacKey, internal.rows[0]!.id, 'lease', 'hmac', 'puuid', connection.gameName]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    const logs = (process.stdout.write as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => String(call[0])).join('');
    expect(logs).toContain('"event":"recent_refresh"');
    expect(logs).not.toContain(publicPlayerId);
    expect(logs).not.toContain(puuid);
  });

  it('a refreshed new match reaches the snapshot, server analysis (lifetime, current strength, progress) and Matches', async () => {
    provider.history = Array.from({ length: 12 }, (_, index) => `m${20 - index}`);
    for (let index = 0; index < 5; index += 1) await service.refreshIfStale(publicPlayerId); // 4 full pages, then an empty page completes
    advance(31);
    provider.history = ['m21', ...provider.history];
    const projection = () => new DatasetProjectionService(new PostgresDatasetReadRepository(database));
    const analysis = new ServerAnalysisService(database, projection());
    const before = (await projection().read()).payload;
    const result = await service.refreshIfStale(publicPlayerId);
    expect(result.refresh).toMatchObject({ status: 'refreshed', newMatches: 1 });
    const after = (await projection().read()).payload;
    if (before.state !== 'ready' || after.state !== 'ready') throw new Error('dataset not ready');
    expect(after.snapshot.version).not.toBe(before.snapshot.version);
    expect(after.dataset.matches).toHaveLength(before.dataset.matches.length + 1);
    const newest = after.dataset.matches.reduce((a, b) => (a.playedAt > b.playedAt ? a : b));
    expect(before.dataset.matches.some((m) => m.id === newest.id)).toBe(false);
    for (const feature of ['lifetimeTotals', 'currentStrength', 'improvementIndex'] as const) {
      const { payload } = await analysis.analyze(parseAnalysisRequest({ view: 'analysis', feature }));
      if (!('dataset' in payload) || !payload.dataset) throw new Error(`no dataset for ${feature}`);
      expect(payload.dataset.matches.map((m) => m.id)).toContain(newest.id);
    }
  });

  it('fresh skip path costs two cheap queries and no provider call', async () => {
    await service.refreshIfStale(publicPlayerId);
    advance(1);
    const query = vi.spyOn(database, 'query');
    const started = performance.now();
    await service.refreshIfStale(publicPlayerId);
    const elapsed = performance.now() - started;
    expect(query).toHaveBeenCalledTimes(2);
    expect(provider.calls).toBe(1);
    expect(elapsed).toBeLessThan(500);
  });
});
