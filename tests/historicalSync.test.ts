import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { PublicApiError } from '../server/errors';
import type { HistoricalMatchProvider } from '../server/henrikDataProvider';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { HistoricalSyncService } from '../server/sync/historicalSyncService';
import { PostgresSyncStore } from '../server/sync/postgresSyncStore';

const hmacKey = 'test-sync-hmac-key-with-at-least-32-bytes';
const connection = { gameName: 'SyncGoblin', tag: 'TW', affinity: 'ap', consent: true } as const;

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

class FixtureProvider implements HistoricalMatchProvider {
  calls = 0;
  failure?: PublicApiError;
  constructor(private readonly pages: Map<number, unknown>) {}
  async fetchHistoryPage(_input: unknown, start: number): Promise<unknown> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    return this.pages.get(start) ?? { status: 200, data: [] };
  }
}

function match(index: number, id = `fictional-history-match-${index}`) {
  return {
    metadata: {
      match_id: id,
      started_at: new Date(Date.UTC(2026, 8, 30 - index, 12)).toISOString(),
      game_length_in_ms: 120_000,
      map: { id: 'map-id', name: 'Ascent' },
      queue: { id: 'competitive', name: 'Competitive' },
    },
    players: [{
      puuid: 'fictional-consenting-participant', name: connection.gameName, tag: connection.tag,
      team_id: 'Blue', agent: { id: 'agent-id', name: 'Sova' },
      stats: { kills: 0, deaths: 0, assists: 0, score: 0, headshots: 0, bodyshots: 0, legshots: 0, damage: { dealt: 0, received: 0 } },
    }],
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 0 } }],
    rounds: [{
      id: 1, winning_team: 'Blue', result: 'Eliminated', plant: null,
      stats: [{ player: { puuid: 'fictional-consenting-participant' }, stats: { kills: 0, score: 0 }, economy: { loadout_value: 0, remaining: 800 } }],
    }],
    kills: [],
  };
}

const page = (...matches: ReturnType<typeof match>[]) => ({ status: 200, data: matches });

async function count(database: SqlDatabase, table: string): Promise<number> {
  const result = await database.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

describe('bounded historical synchronization', () => {
  let database: PGliteDatabase;
  let durable: DurableEvidenceService;
  let store: PostgresSyncStore;
  let publicPlayerId: string;

  beforeEach(async () => {
    database = new PGliteDatabase(new PGlite());
    await applyMigrations(database, await loadMigrations('migrations'));
    durable = new DurableEvidenceService(database, hmacKey);
    store = new PostgresSyncStore(database);
    const connected = await durable.persistConnection(connection, 'fictional-consenting-participant', '2026-09-30T00:00:00.000Z');
    publicPlayerId = connected.publicPlayerId!;
  });

  afterEach(async () => { await database.close(); });

  it('creates a cursor, pauses after one bounded page, and resumes to short-page termination', async () => {
    const provider = new FixtureProvider(new Map([
      [0, page(match(0), match(1), match(2))],
      [3, page(match(3), match(4))],
    ]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);

    const first = await service.start(publicPlayerId, 'backfill');
    expect(first).toMatchObject({ status: 'paused', progress: { pages: 1, matchesSeen: 3 } });
    const second = await service.continue(first.runId);
    expect(second).toMatchObject({
      status: 'complete',
      terminationReason: 'short_page',
      progress: { pages: 2, matchesSeen: 5, matchesPersisted: 5, overlapsUpdated: 0 },
      coverage: { completeForProviderWindow: true },
    });
    expect(provider.calls).toBe(2);
    expect(await count(database, 'source_matches')).toBe(5);
    expect(JSON.stringify(second)).not.toContain('fictional-history-match');
    expect(JSON.stringify(second)).not.toContain('fictional-consenting-participant');
    const cursor = await database.query<{ next_start: number; last_successful_page: number }>(
      `SELECT next_start,last_successful_page FROM sync_cursors WHERE sync_kind='backfill'`,
    );
    expect(cursor.rows[0]).toMatchObject({ next_start: 5, last_successful_page: 1 });
  });

  it('terminates safely on an empty first page', async () => {
    const service = new HistoricalSyncService(store, durable, new FixtureProvider(new Map([[0, page()]])), hmacKey);
    const result = await service.start(publicPlayerId, 'backfill');
    expect(result).toMatchObject({ status: 'complete', terminationReason: 'empty_page', coverage: { completeForProviderWindow: true } });
    expect(await count(database, 'source_matches')).toBe(0);
  });

  it('prevents infinite pagination when the provider repeats a page', async () => {
    const repeated = page(match(0), match(1), match(2));
    const service = new HistoricalSyncService(store, durable, new FixtureProvider(new Map([[0, repeated], [3, repeated]])), hmacKey);
    const first = await service.start(publicPlayerId, 'backfill');
    const second = await service.continue(first.runId);
    expect(second).toMatchObject({
      status: 'complete', terminationReason: 'repeated_page',
      coverage: { completeForProviderWindow: false, incompleteReason: 'provider_repeated_page' },
    });
    expect(await count(database, 'source_matches')).toBe(3);
  });

  it('does not advance the cursor when database persistence fails and safely retries the same page', async () => {
    let fail = true;
    const writer = {
      persistSyncPage: (...args: Parameters<DurableEvidenceService['persistSyncPage']>) => {
        if (fail) throw new Error('forced database failure');
        return durable.persistSyncPage(...args);
      },
    };
    const provider = new FixtureProvider(new Map([[0, page(match(0), match(1))]]));
    const service = new HistoricalSyncService(store, writer, provider, hmacKey);
    await expect(service.start(publicPlayerId, 'backfill')).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    const cursorAfterFailure = await database.query<{ next_start: number }>(`SELECT next_start FROM sync_cursors WHERE sync_kind='backfill'`);
    expect(cursorAfterFailure.rows[0]?.next_start).toBe(0);
    expect(await count(database, 'source_matches')).toBe(0);

    fail = false;
    const run = await database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs ORDER BY started_at DESC LIMIT 1`);
    const retried = await service.continue(run.rows[0]!.public_id);
    expect(retried).toMatchObject({ status: 'complete', terminationReason: 'short_page', progress: { retries: 1 } });
    expect(await count(database, 'source_matches')).toBe(2);
  });

  it('keeps a previously committed chunk when the next chunk fails', async () => {
    let writes = 0;
    const writer = {
      async persistSyncPage(...args: Parameters<DurableEvidenceService['persistSyncPage']>) {
        writes += 1;
        if (writes === 2) throw new Error('forced second-page failure');
        return durable.persistSyncPage(...args);
      },
    };
    const provider = new FixtureProvider(new Map([
      [0, page(match(0), match(1), match(2))],
      [3, page(match(3), match(4), match(5))],
    ]));
    const service = new HistoricalSyncService(store, writer, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'backfill');
    await expect(service.continue(first.runId)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    expect(await count(database, 'source_matches')).toBe(3);
    const cursor = await database.query<{ next_start: number }>(`SELECT next_start FROM sync_cursors WHERE sync_kind='backfill'`);
    expect(cursor.rows[0]?.next_start).toBe(3);
  });

  it('uses a durable lease, rejects contention, and recovers after lease expiry', async () => {
    const subject = await store.findSubject(publicPlayerId);
    expect(subject).toBeDefined();
    const first = await store.acquireCursorLease(subject!, 'backfill', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:45.000Z');
    const contended = await store.acquireCursorLease(subject!, 'backfill', '2026-09-30T00:00:10.000Z', '2026-09-30T00:00:55.000Z');
    const recovered = await store.acquireCursorLease(subject!, 'backfill', '2026-09-30T00:00:46.000Z', '2026-09-30T00:01:31.000Z');
    expect(first).toBeDefined();
    expect(contended).toBeUndefined();
    expect(recovered).toBeDefined();
    expect(recovered?.leaseToken).not.toBe(first?.leaseToken);
  });

  it('persists rate-limit retry state and does not call the provider during backoff', async () => {
    let now = new Date('2026-09-30T00:00:00.000Z');
    const provider = new FixtureProvider(new Map());
    provider.failure = new PublicApiError(429, 'RATE_LIMITED', 'bounded fixture');
    const service = new HistoricalSyncService(store, durable, provider, hmacKey, { now: () => now });
    await expect(service.start(publicPlayerId, 'backfill')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const run = await database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs LIMIT 1`);
    await expect(service.continue(run.rows[0]!.public_id)).rejects.toMatchObject({ code: 'SYNC_BACKOFF' });
    expect(provider.calls).toBe(1);
    const retry = await database.query<{ retry_count: number; last_error_category: string; next_attempt_at: Date }>(
      `SELECT retry_count,last_error_category,next_attempt_at FROM sync_cursors WHERE sync_kind='backfill'`,
    );
    expect(retry.rows[0]).toMatchObject({ retry_count: 1, last_error_category: 'RATE_LIMITED' });
    now = new Date('2026-09-30T00:01:01.000Z');
  });

  it('classifies provider timeout without moving the cursor', async () => {
    const provider = new FixtureProvider(new Map());
    provider.failure = new PublicApiError(504, 'PROVIDER_TIMEOUT', 'bounded fixture');
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    await expect(service.start(publicPlayerId, 'backfill')).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    const cursor = await database.query<{ next_start: number; last_error_category: string }>(
      `SELECT next_start,last_error_category FROM sync_cursors WHERE sync_kind='backfill'`,
    );
    expect(cursor.rows[0]).toMatchObject({ next_start: 0, last_error_category: 'PROVIDER_TIMEOUT' });
  });

  it('blocks provider access without active consent and cancels a resumed run after revocation', async () => {
    const provider = new FixtureProvider(new Map([[0, page(match(0), match(1), match(2))], [3, page(match(3))]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'backfill');
    await database.query(`UPDATE consents SET status='revoked', revoked_at='2026-09-30T01:00:00.000Z' WHERE status='active'`);
    await expect(service.continue(first.runId)).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(provider.calls).toBe(1);
    expect((await service.status(first.runId)).status).toBe('cancelled');
  });

  it('blocks a first sync without consent before any provider call', async () => {
    await database.query(`UPDATE consents SET status='revoked', revoked_at='2026-09-30T01:00:00.000Z' WHERE status='active'`);
    const provider = new FixtureProvider(new Map());
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    await expect(service.start(publicPlayerId, 'backfill')).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(provider.calls).toBe(0);
  });

  it('performs incremental newest sync with overlap and stops at a known boundary', async () => {
    const backfill = new HistoricalSyncService(
      store,
      durable,
      new FixtureProvider(new Map([[0, page(match(1), match(2))]])),
      hmacKey,
    );
    await backfill.start(publicPlayerId, 'backfill');
    const incremental = new HistoricalSyncService(
      store,
      durable,
      new FixtureProvider(new Map([[0, page(match(0), match(1), match(2))]])),
      hmacKey,
    );
    const result = await incremental.start(publicPlayerId, 'incremental');
    expect(result).toMatchObject({
      status: 'complete', terminationReason: 'known_boundary',
      progress: { matchesSeen: 3, matchesPersisted: 3, overlapsUpdated: 2 },
    });
    expect(await count(database, 'source_matches')).toBe(3);
    await expect(incremental.start(publicPlayerId, 'backfill')).resolves.toMatchObject({ progress: { matchesSeen: 2 } });
    expect(await count(database, 'source_matches')).toBe(3);
  });

  it('keeps absent location evidence absent instead of converting it to zero', async () => {
    const service = new HistoricalSyncService(store, durable, new FixtureProvider(new Map([[0, page(match(0))]])), hmacKey);
    await service.start(publicPlayerId, 'backfill');
    expect(await count(database, 'event_player_locations')).toBe(0);
    const evidence = await database.query<{ loadout_value: number; remaining_credits: number }>(
      `SELECT loadout_value,remaining_credits FROM round_participants LIMIT 1`,
    );
    expect(evidence.rows[0]).toMatchObject({ loadout_value: 0, remaining_credits: 800 });
  });

  it.each([1, 2, 3])('keeps page size %i bounded to one provider request', async (pageSize) => {
    const matches = Array.from({ length: pageSize }, (_value, index) => match(index));
    const provider = new FixtureProvider(new Map([[0, page(...matches)]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey, { pageSize, historyHorizon: pageSize });
    const result = await service.start(publicPlayerId, 'backfill');
    expect(provider.calls).toBe(1);
    expect(result.progress.matchesSeen).toBe(pageSize);
    expect(result.performance.providerRequests).toBe(1);
    expect(result.performance.totalMs).toBeLessThan(25_000);
  });
});
