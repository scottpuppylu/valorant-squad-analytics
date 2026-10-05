import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { decodeHistoryCursor, encodeHistoryCursor, parseDatasetView, parseHistoryRequest } from '../server/dataset/historyCursor';
import type { DatasetHistoryPayload, DatasetHistoryPageRequest } from '../server/dataset/types';
import { PublicApiError } from '../server/errors';
import { lookupHmac } from '../server/identityProtection';
import datasetHandler from '../api/valorant/dataset';
import type { ApiRequest, ApiResponse } from '../server/contracts';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { mergeHistoryPage, emptyHistoryState } from '../src/dataSources/server/historyMerge';
import { isDatasetHistoryResponse } from '../src/dataSources/server/datasetContract';

const migrationsPath = resolve('migrations');
const squadId = '00000000-0000-4000-8000-000000000001';
const cursorKey = 'history-cursor-test-key-material-with-32-bytes-or-more';
const otherKey = 'another-history-cursor-key-material-with-32-bytes-plus';
const openDatabases: PGliteDatabase[] = [];

class PGliteDatabase implements SqlDatabase {
  constructor(private readonly database: PGlite) { openDatabases.push(this); }
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

afterEach(async () => {
  while (openDatabases.length > 0) await openDatabases.pop()!.close();
});

async function migratedDatabase(): Promise<PGliteDatabase> {
  const database = new PGliteDatabase(new PGlite());
  await applyMigrations(database, await loadMigrations(migrationsPath));
  return database;
}

function uuid(kind: number, value: number): string {
  return `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function lookup(value: number): string {
  return value.toString(16).padStart(64, '0');
}

function placeholders(rows: number, width: number): string {
  let index = 1;
  return Array.from({ length: rows }, () => `(${Array.from({ length: width }, () => `$${index++}`).join(',')})`).join(',');
}

async function insertRows(database: SqlDatabase, sql: string, rows: unknown[][], width: number): Promise<void> {
  const chunk = Math.floor(30_000 / width);
  for (let index = 0; index < rows.length; index += chunk) {
    const slice = rows.slice(index, index + chunk);
    await database.query(`${sql} VALUES ${placeholders(slice.length, width)}`, slice.flat());
  }
}

async function seedPlayers(database: SqlDatabase, count: number): Promise<void> {
  await database.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3)', [squadId, 'friends', 'Friends']);
  if (count === 0) return;
  const players = Array.from({ length: count }, (_, index) => [uuid(1, index + 1), uuid(2, index + 1), `Player${index + 1}`, `T${index + 1}`, '🐺']);
  await insertRows(database, 'INSERT INTO players (id,public_id,display_name,display_tag,default_emoji)', players, 5);
  await insertRows(database, 'INSERT INTO squad_memberships (id,squad_id,player_id,status)', players.map((row, index) => [uuid(3, index + 1), squadId, row[0], 'active']), 4);
  await insertRows(database, 'INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at)',
    players.map((row, index) => [uuid(4, index + 1), row[0], 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00.000Z']), 6);
}

interface MatchSpec { n: number; startedAt: string; players: number[] }

/** Match n gets internal id uuid(5,n), public id uuid(6,n), one round, Blue-team participants. */
async function insertMatches(database: SqlDatabase, specs: MatchSpec[]): Promise<void> {
  if (specs.length === 0) return;
  const matches = specs.map(({ n, startedAt }) => [uuid(5, n), squadId, 'HenrikDev', lookup(n), 'v4', 'durable-evidence-v2', 'ap', 'Ascent', 'competitive', 'Competitive', startedAt, 1_800_000, startedAt, startedAt, uuid(6, n), 'observed', 'observed']);
  await insertRows(database, 'INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status)', matches, 17);
  await insertRows(database, 'INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost)', specs.map(({ n }) => [uuid(7, n), uuid(5, n), 'Blue', true, 1, 0]), 6);
  const participants: unknown[][] = [];
  const rounds: unknown[][] = [];
  const presences: unknown[][] = [];
  for (const { n, players } of specs) {
    rounds.push([uuid(9, n), uuid(5, n), 1, 'observed', 'missing', 'missing']);
    for (const player of players) {
      const participantId = uuid(8, n * 16 + player);
      participants.push([participantId, uuid(5, n), uuid(1, player), lookup(1_000_000 + n * 16 + player), 'Blue', 'Jett', 'observed', 1, 0, 1, 300, 150, 1, 1, 0]);
      presences.push([uuid(10, n * 16 + player), uuid(9, n), participantId, 'observed', 'missing', 'missing', 'missing']);
    }
  }
  await insertRows(database, 'INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots)', participants, 15);
  await insertRows(database, 'INSERT INTO rounds (id,source_match_id,round_number,participants_evidence_status,plant_status,defuse_status)', rounds, 6);
  await insertRows(database, 'INSERT INTO round_participants (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status)', presences, 7);
}

/** n=1 is newest; each later n is one minute older. */
function sequentialSpecs(count: number, players: number[], first = 1): MatchSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    n: first + index,
    startedAt: new Date(Date.UTC(2026, 9, 1) - (first + index) * 60_000).toISOString(),
    players,
  }));
}

function service(database: SqlDatabase): DatasetProjectionService {
  return new DatasetProjectionService(new PostgresDatasetReadRepository(database), cursorKey);
}

function request(query: Record<string, string>): DatasetHistoryPageRequest {
  return parseHistoryRequest(query, cursorKey);
}

async function traverse(target: DatasetProjectionService, limit: number, between?: (page: number) => Promise<void>) {
  const pages: DatasetHistoryPayload[] = [];
  let cursor: string | null = null;
  do {
    const { payload } = await target.readHistory(request({ limit: String(limit), ...(cursor ? { cursor } : {}) }));
    pages.push(payload);
    cursor = payload.page.nextCursor;
    if (cursor && between) await between(pages.length);
    if (pages.length > 1000) throw new Error('runaway traversal');
  } while (cursor);
  return pages;
}

function expectRejected(work: () => unknown): void {
  let caught: unknown;
  try { work(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(PublicApiError);
  expect((caught as PublicApiError).status).toBe(400);
  expect((caught as PublicApiError).code).toBe('BAD_REQUEST');
}

describe('DATA-03B.1 history pagination contract', () => {
  it('pages newest to oldest with opaque cursors, explicit hasMore and a null final cursor', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 1);
    await insertMatches(database, sequentialSpecs(120, [1]));
    const pages = await traverse(service(database), 50);
    expect(pages.map((page) => page.dataset.matches.length)).toEqual([50, 50, 20]);
    expect(pages.map((page) => page.page.hasMore)).toEqual([true, true, false]);
    expect(pages.at(-1)!.page.nextCursor).toBeNull();
    const ids = pages.flatMap((page) => page.dataset.matches.map((match) => match.id));
    expect(ids).toEqual(Array.from({ length: 120 }, (_, index) => uuid(6, index + 1)));
    for (const page of pages) {
      expect(page).toMatchObject({ ok: true, schemaVersion: 5, view: 'history', historyVersion: 'dataset-history-v1', projectionVersion: 'evidence-decoupled-projection-v1', identityVersion: 'member-identity-v1' });
      expect(page.tracked).toMatchObject({ trackedMatchCount: 120, lifetimeComplete: false });
      expect(page.tracked.earliestTrackedAt).toBe(new Date(Date.UTC(2026, 9, 1) - 120 * 60_000).toISOString());
      expect(page.page.from! <= page.page.to!).toBe(true);
      expect(isDatasetHistoryResponse(page)).toBe(true);
    }
    expect(pages[0]!.page.limit).toBe(50);
  });

  it('uses the default page size of 50 and returns the same boundary on repeated reads', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 1);
    await insertMatches(database, sequentialSpecs(60, [1]));
    const target = service(database);
    const first = (await target.readHistory(request({}))).payload;
    const again = (await target.readHistory(request({}))).payload;
    expect(first.page.limit).toBe(50);
    expect(first.page.nextCursor).toBe(again.page.nextCursor);
    expect(first.dataset.matches.map((match) => match.id)).toEqual(again.dataset.matches.map((match) => match.id));
    const second = (await target.readHistory(request({ cursor: first.page.nextCursor! }))).payload;
    expect(second.dataset.matches[0]!.id).toBe(uuid(6, 51));
  });

  it('orders exact duplicate and microsecond-distinct timestamps deterministically without skips', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 1);
    const tied = Array.from({ length: 7 }, (_, index) => ({ n: index + 1, startedAt: '2026-09-30T10:00:00.000000Z', players: [1] }));
    const micro = [
      { n: 20, startedAt: '2026-09-30T09:00:00.000003Z', players: [1] },
      { n: 21, startedAt: '2026-09-30T09:00:00.000002Z', players: [1] },
      { n: 22, startedAt: '2026-09-30T09:00:00.000001Z', players: [1] },
    ];
    await insertMatches(database, [...tied, ...micro]);
    const runs = [await traverse(service(database), 3), await traverse(service(database), 2), await traverse(service(database), 1)];
    const order = (pages: DatasetHistoryPayload[]) => pages.flatMap((page) => page.dataset.matches.map((match) => match.id));
    const tiedIds = tied.map(({ n }) => uuid(6, n)).sort().reverse();
    for (const pages of runs) {
      expect(order(pages)).toEqual([...tiedIds, uuid(6, 20), uuid(6, 21), uuid(6, 22)]);
    }
  });

  it('returns an explicit empty page with zero tracked matches', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 1);
    const result = await service(database).readHistory(request({}));
    expect(result.payload).toMatchObject({ state: 'empty', page: { hasMore: false, nextCursor: null, traversedMatchCount: 0, withheldMatchCount: 0 }, tracked: { trackedMatchCount: 0, lifetimeComplete: false } });
    expect(result.payload.dataset.matches).toEqual([]);
    expect(result.payload.dataset.players).toHaveLength(1);
    expect(result.metrics.sqlQueryCount).toBe(2);
  });

  it('advances past matches withheld for incomplete core evidence and reports them honestly', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 1);
    await insertMatches(database, sequentialSpecs(4, [1]));
    await database.query('UPDATE match_participants SET score=NULL WHERE source_match_id=$1', [uuid(5, 2)]);
    const pages = await traverse(service(database), 2);
    expect(pages.map((page) => [page.page.traversedMatchCount, page.page.withheldMatchCount, page.dataset.matches.length])).toEqual([[2, 1, 1], [2, 0, 2]]);
    expect(pages[0]!.tracked.trackedMatchCount).toBe(4);
  });
});

describe('DATA-03B.1 cursor and request validation', () => {
  const key = { startedAtMicros: '1790000000000123', publicMatchId: 'abcdef09-0000-4000-8000-00000000000a' };

  it('round-trips only a signed position and rejects malformed, tampered or foreign cursors generically', () => {
    const cursor = encodeHistoryCursor(key, cursorKey);
    expect(decodeHistoryCursor(cursor, cursorKey)).toEqual(key);
    const [payload, signature] = cursor.split('.') as [string, string];
    expect(Object.keys(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))).toEqual(['v', 't', 'p']);
    const forgedPayload = Buffer.from(JSON.stringify({ v: 1, t: '1790000000000124', p: key.publicMatchId })).toString('base64url');
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
    for (const invalid of [
      '', 'abc', '.', `${payload}.`, `${payload}.${flipped}`, `${forgedPayload}.${signature}`,
      encodeHistoryCursor(key, otherKey), `${cursor}x`, `${cursor}.${signature}`, 'x'.repeat(500),
      `${payload}.${signature}`.replace('.', '..'), `<script>.${signature}`,
    ]) expectRejected(() => decodeHistoryCursor(invalid, cursorKey));
  });

  it('rejects signed payloads with unsupported versions, extra fields or out-of-range positions', () => {
    // Correctly signed but structurally invalid payloads must still fail closed.
    const signed = (raw: string) => {
      const payload = Buffer.from(raw, 'utf8').toString('base64url');
      return `${payload}.${Buffer.from(lookupHmac('dataset-history-cursor:v1', payload, cursorKey), 'hex').subarray(0, 16).toString('base64url')}`;
    };
    expect(decodeHistoryCursor(signed(JSON.stringify({ v: 1, t: key.startedAtMicros, p: key.publicMatchId })), cursorKey)).toEqual(key);
    for (const raw of [
      JSON.stringify({ v: 2, t: key.startedAtMicros, p: key.publicMatchId }),
      JSON.stringify({ v: 1, t: key.startedAtMicros, p: key.publicMatchId, scope: 'all' }),
      JSON.stringify({ v: 1, t: '9223372036854775808', p: key.publicMatchId }),
      JSON.stringify({ v: 1, t: 1790000000000123, p: key.publicMatchId }),
      JSON.stringify({ v: 1, t: '1e6', p: key.publicMatchId }),
      JSON.stringify({ v: 1, t: key.startedAtMicros, p: key.publicMatchId.toUpperCase() }),
      JSON.stringify({ v: 1, t: key.startedAtMicros, p: "x' OR 1=1 --" }),
      JSON.stringify([1, key.startedAtMicros, key.publicMatchId]),
      'not json',
    ]) expectRejected(() => decodeHistoryCursor(signed(raw), cursorKey));
    expectRejected(() => parseHistoryRequest({ cursor: 'a'.repeat(201) }, cursorKey));
  });

  it('validates page size, parameter shape, view and conflicting positions', () => {
    for (const limit of ['0', '101', '1000', '-1', 'abc', '1.5', '', ' 5']) expectRejected(() => request({ limit }));
    expect(request({ limit: '100' }).pageSize).toBe(100);
    expect(request({ limit: '1' }).pageSize).toBe(1);
    expectRejected(() => parseHistoryRequest({ limit: ['5', '6'] }, cursorKey));
    expectRejected(() => parseHistoryRequest({ cursor: encodeHistoryCursor(key, cursorKey), before: uuid(6, 1) }, cursorKey));
    expectRejected(() => request({ before: 'not-a-uuid' }));
    expectRejected(() => request({ before: 'ABCDEF09-0000-4000-8000-00000000000A' }));
    expect(parseDatasetView(undefined)).toBe('snapshot');
    expect(parseDatasetView({ cursor: 'ignored-by-snapshot' })).toBe('snapshot');
    expect(parseDatasetView({ view: 'history' })).toBe('history');
    expectRejected(() => parseDatasetView({ view: 'all' }));
    expectRejected(() => parseDatasetView({ view: ['history'] }));
  });

  it('starts strictly older than a currently visible public match and rejects unavailable anchors', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 2);
    await insertMatches(database, [...sequentialSpecs(5, [1]), ...sequentialSpecs(3, [2], 6)]);
    const target = service(database);
    const page = (await target.readHistory(request({ before: uuid(6, 3) }))).payload;
    expect(page.dataset.matches.map((match) => match.id)).toEqual([4, 5, 6, 7, 8].map((n) => uuid(6, n)));
    await expect(target.readHistory(request({ before: uuid(6, 999) }))).rejects.toMatchObject({ status: 400, code: 'BAD_REQUEST' });
    await database.query("UPDATE consents SET status='revoked',revoked_at=now() WHERE player_id=$1", [uuid(1, 2)]);
    await expect(target.readHistory(request({ before: uuid(6, 7) }))).rejects.toMatchObject({ status: 400 });
  });
});

describe('DATA-03B.1 consent and cron-mutation safety', () => {
  it('re-evaluates current consent on every page; an old cursor never grants revoked visibility', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 2);
    await insertMatches(database, [...sequentialSpecs(4, [1, 2]), ...sequentialSpecs(4, [2], 5), ...sequentialSpecs(2, [1], 9)]);
    const pages = await traverse(service(database), 4, async (page) => {
      if (page === 1) await database.query("UPDATE consents SET status='revoked',revoked_at=now() WHERE player_id=$1", [uuid(1, 2)]);
    });
    expect(pages[0]!.dataset.players).toHaveLength(2);
    const later = pages.slice(1);
    const serialized = JSON.stringify(later);
    expect(serialized).not.toContain(uuid(2, 2));
    expect(serialized).not.toContain('Player2');
    expect(later.flatMap((page) => page.dataset.matches.map((match) => match.id))).toEqual([uuid(6, 9), uuid(6, 10)]);
    expect(later[0]!.tracked.trackedMatchCount).toBe(6);
  });

  it('never duplicates or loops when cron inserts newer and older matches mid-traversal', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 1);
    await insertMatches(database, sequentialSpecs(10, [1], 100));
    const pages = await traverse(service(database), 3, async (page) => {
      if (page === 1) {
        await insertMatches(database, [
          { n: 1, startedAt: '2026-10-02T00:00:00.000Z', players: [1] },
          { n: 500, startedAt: '2026-01-01T00:00:00.000Z', players: [1] },
          { n: 501, startedAt: new Date(Date.UTC(2026, 9, 1) - 100.5 * 60_000).toISOString(), players: [1] },
        ]);
      }
    });
    const ids = pages.flatMap((page) => page.dataset.matches.map((match) => match.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(uuid(6, 1));
    expect(ids).toContain(uuid(6, 500));
    expect(ids).not.toContain(uuid(6, 501));
    expect(ids.filter((id) => id !== uuid(6, 500))).toEqual(Array.from({ length: 10 }, (_, index) => uuid(6, 100 + index)));
    expect(pages.at(-1)!.tracked.trackedMatchCount).toBe(13);
  });

  it('merges snapshot and history pages in the browser without duplicate matches', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 2);
    await insertMatches(database, sequentialSpecs(30, [1, 2]));
    const target = service(database);
    const snapshot = (await target.read()).payload.dataset;
    const pages = await traverse(target, 7);
    let state = emptyHistoryState();
    for (const page of pages) state = mergeHistoryPage(state, page, snapshot);
    expect(state.matches).toHaveLength(0);
    expect(state.duplicateMatchesIgnored).toBe(30);
    const older = await traverse(target, 7);
    let fresh = emptyHistoryState();
    for (const page of [...older, ...older]) fresh = mergeHistoryPage(fresh, page, { ...snapshot, matches: snapshot.matches.slice(0, 10) });
    expect(fresh.matches.map((match) => match.id)).toEqual(snapshot.matches.slice(10).map((match) => match.id));
    expect(new Set(fresh.matches.map((match) => match.id)).size).toBe(20);
  });
});

describe('DATA-03B.1 privacy boundary', () => {
  it('exposes no internal, provider or HMAC identifier in pages or cursors', async () => {
    const database = await migratedDatabase();
    await seedPlayers(database, 2);
    await insertMatches(database, sequentialSpecs(12, [1, 2]));
    const pages = await traverse(service(database), 5);
    const serialized = JSON.stringify(pages);
    for (let n = 1; n <= 12; n += 1) {
      expect(serialized).not.toContain(uuid(5, n));
      expect(serialized).not.toContain(uuid(9, n));
      expect(serialized).not.toContain(lookup(n));
    }
    expect(serialized).not.toContain(uuid(1, 1));
    expect(serialized).not.toContain(uuid(8, 17));
    expect(serialized.toLowerCase()).not.toMatch(/henrikdev|puuid|hmac|internal_|source_match|database_url|identifier_hmac_key|henrik_api_key|cron_secret/u);
    for (const page of pages) {
      if (!page.page.nextCursor) continue;
      const decoded = JSON.parse(Buffer.from(page.page.nextCursor.split('.')[0]!, 'base64url').toString('utf8')) as { p: string };
      expect(page.dataset.matches.map((match) => match.id)).toContain(decoded.p);
    }
  });
});

describe('DATA-03B.1 handler', () => {
  function invoke(query: Record<string, string | string[]>) {
    let status = 0;
    let body: unknown;
    const headers = new Map<string, string>();
    const response: ApiResponse = {
      status(code) { status = code; return this; },
      json(value) { body = value; },
      setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    };
    return datasetHandler({ method: 'GET', headers: {}, query, socket: { remoteAddress: `history-${Math.random()}` } } satisfies ApiRequest, response)
      .then(() => ({ status, body, headers }));
  }

  it('fails closed for history while exposure is disabled and rejects unknown views', async () => {
    const previous = process.env.REAL_DATASET_READ_MODE;
    delete process.env.REAL_DATASET_READ_MODE;
    try {
      const disabled = await invoke({ view: 'history', cursor: 'tampered.cursor' });
      expect(disabled.status).toBe(200);
      expect(disabled.body).toEqual({ ok: true, schemaVersion: 5, state: 'disabled', source: 'REAL_SERVER' });
      expect(disabled.headers.get('cache-control')).toBe('no-store');
      const unknown = await invoke({ view: 'everything' });
      expect(unknown.status).toBe(400);
      expect(JSON.stringify(unknown.body)).not.toMatch(/cursor|sql|stack/iu);
    } finally {
      if (previous === undefined) delete process.env.REAL_DATASET_READ_MODE;
      else process.env.REAL_DATASET_READ_MODE = previous;
    }
  });
});

describe('DATA-03B.1 bounded history performance', () => {
  it.each([[1, 50], [4, 300], [4, 1000]])('keeps every page within six queries for %i players and %i matches', async (players, matches) => {
    const database = await migratedDatabase();
    await seedPlayers(database, players);
    await insertMatches(database, sequentialSpecs(matches, Array.from({ length: players }, (_, index) => index + 1)));
    const target = service(database);
    const first = await target.readHistory(request({ limit: '100' }));
    expect(first.metrics.sqlQueryCount).toBe(6);
    expect(first.metrics.serializedBytes).toBeLessThan(400_000);
    const started = performance.now();
    const ids = new Set<string>();
    let pages = 0;
    let maxQueries = 0;
    let maxBytes = 0;
    let cursor: string | null = null;
    let mergeMs = 0;
    let state = emptyHistoryState();
    const emptySnapshot = { players: [], matches: [], sourceId: 'durable-neon-v4', isDemo: false as const, mode: 'REAL' as const };
    do {
      const result = await target.readHistory(request({ limit: '100', ...(cursor ? { cursor } : {}) }));
      pages += 1;
      maxQueries = Math.max(maxQueries, result.metrics.sqlQueryCount);
      maxBytes = Math.max(maxBytes, result.metrics.serializedBytes);
      for (const match of result.payload.dataset.matches) ids.add(match.id);
      const mergeStarted = performance.now();
      state = mergeHistoryPage(state, result.payload, emptySnapshot);
      mergeMs += performance.now() - mergeStarted;
      cursor = result.payload.page.nextCursor;
    } while (cursor);
    expect(ids.size).toBe(matches);
    expect(state.matches).toHaveLength(matches);
    expect(pages).toBe(Math.ceil(matches / 100));
    expect(maxQueries).toBeLessThanOrEqual(6);
    const snapshot = await target.read();
    expect(snapshot.payload.dataset.matches).toHaveLength(Math.min(300, matches));
    expect(snapshot.payload.coverage.boundedMatchLimit).toBe(300);
    process.stdout.write(`HISTORY_PERFORMANCE ${players}p/${matches}m ${JSON.stringify({
      firstPage: first.metrics, traversal: { pages, totalMs: Math.round((performance.now() - started) * 100) / 100, maxQueries, maxPageBytes: maxBytes, browserMergeMs: Math.round(mergeMs * 100) / 100 },
      snapshot: { sqlQueryCount: snapshot.metrics.sqlQueryCount, serializedBytes: snapshot.metrics.serializedBytes, databaseMs: snapshot.metrics.databaseMs, projectionMs: snapshot.metrics.projectionMs },
    })}\n`);
  }, 120_000);
});
