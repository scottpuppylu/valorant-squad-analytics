import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { HistoricalSyncService } from '../server/sync/historicalSyncService';
import { PostgresSyncStore } from '../server/sync/postgresSyncStore';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';

/**
 * TASK-DATA-BULK-01C — local fault injection for the Phase-2 DATABASE_ERROR. Each candidate stage is
 * injected into the REAL deep_backfill path; the resulting durable state signature is compared with the
 * production signature of the failed run:
 *   run failed / DATABASE_ERROR, run retry +1, provider requests +1, pages +0, cursor unchanged,
 *   lease released, and the page's newer matches durably committed (2 observed in production).
 */
const hmacKey = 'test-sync-db-failure-hmac-key-with-32-bytes';
const connection = { gameName: 'SyncGoblin', tag: 'TW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;
const open: { close(): Promise<void> }[] = [];
afterEach(async () => { vi.restoreAllMocks(); while (open.length) await open.pop()!.close(); });

class PGliteDatabase implements SqlDatabase {
  /** Throws inside the Nth transaction (1-based) when set: a failing per-match persistence transaction. */
  failTransactionNumber?: number;
  private transactions = 0;
  constructor(private readonly pg: PGlite) { open.push(this); }
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.pg.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const fail = this.failTransactionNumber === this.transactions;
    await this.pg.exec('BEGIN');
    try {
      const value = await work(this);
      if (fail) throw Object.assign(new Error('injected failure'), { code: '57P01' });
      await this.pg.exec('COMMIT');
      return value;
    } catch (error) { await this.pg.exec('ROLLBACK'); throw error; }
  }
  resetCount() { this.transactions = 0; }
  async close() { await this.pg.close(); }
}

function match(index: number, name: string = connection.gameName, puuid = 'fictional-consenting-participant') {
  return {
    metadata: { match_id: `fictional-db-failure-match-${index}`, started_at: new Date(Date.UTC(2026, 4, 30 - index, 12)).toISOString(), game_length_in_ms: 120_000,
      map: { id: 'map-id', name: 'Ascent' }, queue: { id: 'competitive', name: 'Competitive' } },
    players: [{ puuid, name, tag: connection.tag, team_id: 'Blue', agent: { id: 'agent-id', name: 'Sova' },
      stats: { kills: 3, deaths: 1, assists: 1, score: 300, headshots: 1, bodyshots: 1, legshots: 0, damage: { dealt: 200, received: 50 } } }],
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 0 } }],
    rounds: [{ id: 1, winning_team: 'Blue', result: 'Eliminated', plant: null,
      stats: [{ player: { puuid }, stats: { kills: 3, score: 300 }, economy: { loadout_value: 3900, remaining: 800 } }] }],
    kills: [],
  };
}

class Provider {
  calls = 0;
  constructor(public pages: Map<number, unknown[]>) {}
  async fetchHistoryPage(_input: unknown, start: number) { this.calls += 1; return { status: 200, data: this.pages.get(start) ?? [] }; }
  async fetchStoredIndexPage() { this.calls += 1; return { data: [] }; }
  async fetchMatchDetail() { throw new Error('not used'); }
}

async function setup(pages: Map<number, unknown[]>) {
  const database = new PGliteDatabase(new PGlite());
  await applyMigrations(database, await loadMigrations('migrations'));
  const durable = new DurableEvidenceService(database, hmacKey);
  const store = new PostgresSyncStore(database);
  const { publicPlayerId } = await durable.persistConnection(connection, 'fictional-consenting-participant', '2026-10-01T00:00:00.000Z');
  const provider = new Provider(pages);
  const service = new HistoricalSyncService(store, durable, provider as never, hmacKey, { now: () => new Date('2026-10-06T11:21:39.000Z') });
  return { database, durable, store, provider, service, publicPlayerId: publicPlayerId! };
}

async function signature(database: SqlDatabase) {
  const run = (await database.query<Record<string, unknown>>(`SELECT status, error_category, retry_count, page_count, provider_request_count FROM sync_runs WHERE sync_kind='deep_backfill'`)).rows[0]!;
  const cursor = (await database.query<Record<string, unknown>>(`SELECT next_start, history_phase, lease_token, last_error_category FROM sync_cursors WHERE sync_kind='deep_backfill'`)).rows[0]!;
  const matches = Number((await database.query<{ n: string }>('SELECT count(*)::text AS n FROM source_matches')).rows[0]!.n);
  return { runStatus: run.status, runError: run.error_category, retries: Number(run.retry_count), pages: Number(run.page_count), providerRequests: Number(run.provider_request_count),
    nextStart: Number(cursor.next_start), phase: cursor.history_phase, leaseHeld: cursor.lease_token !== null, cursorError: cursor.last_error_category, matches };
}

/** First page succeeds (3 matches); the failing chunk is the second page. Baseline = after page 1. */
const firstPage: [number, unknown[]] = [0, [match(0), match(1), match(2)]];
const productionLike = (s: Awaited<ReturnType<typeof signature>>) => ({ runStatus: s.runStatus, runError: s.runError, retries: s.retries, pages: s.pages, providerRequests: s.providerRequests, nextStart: s.nextStart, leaseHeld: s.leaseHeld });
const PRODUCTION = { runStatus: 'failed', runError: 'DATABASE_ERROR', retries: 1, pages: 1, providerRequests: 2, nextStart: 3, leaseHeld: false };

async function runFailingChunk(env: Awaited<ReturnType<typeof setup>>) {
  const first = await env.service.start(env.publicPlayerId, 'deep_backfill');
  let error: unknown;
  try { await env.service.continue(first.runId); } catch (caught) { error = caught; }
  return { first, error: error as { status?: number; code?: string } | undefined, after: await signature(env.database) };
}

describe('database-failure stage signatures (deep_backfill live_v4)', () => {
  it('C1a (FIXED by historical-identity-v1) — a 3rd match under an older Riot ID now persists: no failure, cursor advances', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4), match(5, 'OldRiotName')]]]));
    const { error, after } = await runFailingChunk(env);
    expect(error).toBeUndefined();
    expect(after).toMatchObject({ runError: null, nextStart: 6, leaseHeld: false, matches: 6 });
  });

  it('C1a true identity absence (no participant with the account PUUID): 2 of 3 commit, MALFORMED_RESPONSE (not DATABASE_ERROR), cursor kept', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4), match(5, connection.gameName, 'fictional-someone-else')]]]));
    const { error, after } = await runFailingChunk(env);
    expect(error).toMatchObject({ status: 502, code: 'MALFORMED_PROVIDER_RESPONSE' });
    expect(productionLike(after)).toEqual({ ...PRODUCTION, runError: 'MALFORMED_RESPONSE' });
    expect(after.matches).toBe(5); // page 1 (3) + the failing page's 2 newer matches (per-match atomicity)
  });

  it('C1b — the 3rd per-match persistence transaction fails in the database: same signature → MATCHES production', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4), match(5)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    // Count only the failing chunk's transactions: lease (1), match tx 1..3 (2..4).
    env.database.resetCount();
    env.database.failTransactionNumber = 4;
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    await expect(env.service.continue(run)).rejects.toMatchObject({ status: 503, code: 'DATABASE_ERROR' });
    const after = await signature(env.database);
    expect(productionLike(after)).toEqual(PRODUCTION);
    expect(after.matches).toBe(5);
  });

  it('C2 — a short final live page (2 matches) whose cursor commit fails: same signature → MATCHES production', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    vi.spyOn(env.store, 'recordSuccess').mockRejectedValueOnce(Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }));
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    await expect(env.service.continue(run)).rejects.toMatchObject({ status: 503, code: 'DATABASE_ERROR' });
    const after = await signature(env.database);
    expect(productionLike(after)).toEqual(PRODUCTION);
    expect(after.phase).toBe('live_v4'); // the short-page phase transition was rolled back with the cursor
    expect(after.matches).toBe(5);
  });

  it('normalization failure before any match transaction: 0 of the page commit → does NOT match (production committed 2)', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4), match(5)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    vi.spyOn(env.durable, 'persistSyncPage').mockRejectedValueOnce(new TypeError('Cannot read properties of undefined'));
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    await expect(env.service.continue(run)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    const after = await signature(env.database);
    expect(productionLike(after)).toEqual(PRODUCTION);
    expect(after.matches).toBe(3);
  });

  it('failure commit (recordFailure) also fails: run stays running, retries unchanged → does NOT match', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    vi.spyOn(env.store, 'recordSuccess').mockRejectedValueOnce(new Error('down'));
    vi.spyOn(env.store, 'recordFailure').mockRejectedValueOnce(new Error('down'));
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    await expect(env.service.continue(run)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    const after = await signature(env.database);
    expect(after).toMatchObject({ runStatus: 'running', retries: 0, providerRequests: 1, leaseHeld: false }); // finally releaseLease ran
  });

  it('existingMatchHmacs read fails: classified UNKNOWN → public 502 PROVIDER_ERROR → does NOT match', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4), match(5)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    vi.spyOn(env.store, 'existingMatchHmacs').mockRejectedValueOnce(new Error('read failed'));
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    await expect(env.service.continue(run)).rejects.toMatchObject({ status: 502, code: 'PROVIDER_ERROR' });
    expect(await signature(env.database)).toMatchObject({ runStatus: 'failed', runError: 'UNKNOWN', matches: 3 });
  });

  // Characterizes current behavior: executeChunk returns requireStatus() without awaiting, so a status-read
  // rejection AFTER the cursor commit escapes its try/catch (the '同步已安全提交' 503 branch is unreachable
  // for this case); the route maps the raw error to 502 PROVIDER_ERROR. Recorded as a separate minor defect.
  it('status read after a committed cursor fails: raw error escapes, run paused, cursor advanced → does NOT match', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4), match(5)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    vi.spyOn(env.store, 'status').mockRejectedValueOnce(new Error('read failed'));
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    await expect(env.service.continue(run)).rejects.toThrow('read failed');
    expect(await signature(env.database)).toMatchObject({ runStatus: 'paused', runError: null, nextStart: 6, matches: 6, leaseHeld: false });
  });

  it('a failed page replays idempotently: no duplicate source match, committed matches count as overlaps, cursor advances once', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4), match(5)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    env.database.resetCount();
    env.database.failTransactionNumber = 4;
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    await expect(env.service.continue(run)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    env.database.failTransactionNumber = undefined;
    const replay = await env.service.continue(run);
    const after = await signature(env.database);
    expect(after).toMatchObject({ matches: 6, nextStart: 6, runError: null, leaseHeld: false });
    expect(replay.progress.overlapsUpdated).toBe(2);
    expect(Number((await env.database.query<{ n: string }>('SELECT count(*)::text AS n FROM match_participants')).rows[0]!.n)).toBe(6);
    expect(Number((await env.database.query<{ n: string }>('SELECT count(DISTINCT provider_match_lookup_hmac)::text AS n FROM source_matches')).rows[0]!.n)).toBe(6);
  });
});

describe('database-failure-stage-v1 telemetry distinguishes the three production-matching candidates', () => {
  const capture = () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { lines.push(String(chunk)); return true; });
    return () => lines.flatMap((line) => line.split(/\r?\n/u)).filter((line) => line.includes('sync_database_failure')).map((line) => JSON.parse(line) as Record<string, unknown>);
  };
  const forbidden = /fictional|SyncGoblin|OldRiotName|puuid|hmac|[0-9a-f]{8}-[0-9a-f]{4}-|injected failure|Connection terminated|SELECT|INSERT|UPDATE/iu;

  it('C1a: a renamed match and a true identity absence both emit NO sync_database_failure (historical-identity-v1)', async () => {
    const renamed = await setup(new Map([firstPage, [3, [match(3), match(4), match(5, 'OldRiotName')]]]));
    const absent = await setup(new Map([firstPage, [3, [match(3), match(4), match(5, connection.gameName, 'fictional-someone-else')]]]));
    const events = capture();
    await runFailingChunk(renamed);
    await runFailingChunk(absent);
    expect(events()).toEqual([]);
  });
  it('C1b logs persist_sync_page / connection with the SQLSTATE class only', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4), match(5)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    env.database.resetCount();
    env.database.failTransactionNumber = 4;
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    const events = capture();
    await expect(env.service.continue(run)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    expect(events()).toEqual([{ event: 'sync_database_failure', failureStageVersion: 'database-failure-stage-v1', stage: 'persist_sync_page', syncKind: 'deep_backfill', historyPhase: 'live_v4', errorKind: 'connection', sqlState: '57P01' }]);
  });
  it('C2 logs cursor_success_commit; nothing logged is an identifier, name, SQL or raw message', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    vi.spyOn(env.store, 'recordSuccess').mockRejectedValueOnce(Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }));
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    const events = capture();
    await expect(env.service.continue(run)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    const logged = events();
    expect(logged).toEqual([{ event: 'sync_database_failure', failureStageVersion: 'database-failure-stage-v1', stage: 'cursor_success_commit', syncKind: 'deep_backfill', historyPhase: 'live_v4', errorKind: 'connection' }]);
    expect(JSON.stringify(logged)).not.toMatch(forbidden);
  });
  it('a failing failure commit is labelled failure_commit', async () => {
    const env = await setup(new Map([firstPage, [3, [match(3), match(4)]]]));
    await env.service.start(env.publicPlayerId, 'deep_backfill');
    vi.spyOn(env.store, 'recordSuccess').mockRejectedValueOnce(Object.assign(new Error('x'), { code: '23505' }));
    vi.spyOn(env.store, 'recordFailure').mockRejectedValueOnce(Object.assign(new Error('y'), { code: 'ETIMEDOUT' }));
    const run = (await env.database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs`)).rows[0]!.public_id;
    const events = capture();
    await expect(env.service.continue(run)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    expect(events().map((e) => [e.stage, e.errorKind, e.sqlState ?? null])).toEqual([['cursor_success_commit', 'postgres', '23505'], ['failure_commit', 'connection', null]]);
  });
});

