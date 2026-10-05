import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { normalizeSeasonEvidence } from '../server/evidence/seasonEvidence';
import { normalizeHenrikEvidence } from '../server/evidence/normalizeHenrikEvidence';
import type { HistoricalMatchProvider } from '../server/henrikDataProvider';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { HistoricalSyncService } from '../server/sync/historicalSyncService';
import { PostgresSyncStore } from '../server/sync/postgresSyncStore';
import type { HistoricalDiscoveryProvider } from '../server/sync/historicalDiscoveryProvider';
import { sourceMatchHmac } from '../server/identityProtection';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { buildAnalyticsContext, PostgresAnalyticsContextRepository } from '../server/dataset/analyticsContext';
import { parseHistoryRequest } from '../server/dataset/historyCursor';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { isDatasetHistoryResponse, isDatasetResponse } from '../src/dataSources/server/datasetContract';
import { createPerformanceEntries, defaultAnalysisFilters, selectPerformances } from '../src/analytics/filters';
import { populationFromMatches } from '../src/analytics/scope/resolveScope';
import { resolveAdaptiveWindow } from '../src/analytics/scope/adaptiveWindow';
import { policyFor } from '../src/analytics/scope/policies';
import type { MatchRecord, Player } from '../src/types/valorant';

const hmacKey = 'test-season-hmac-key-with-at-least-32-bytes';
const cursorKey = 'season-history-cursor-key-material-with-32-bytes';
const seasonA = '0df5adb9-4dcb-6899-1306-3e9860661dd3';
const seasonB = '1f9a4f73-4f5e-4b8a-9f2b-7e9d1c2b3a40';
const connection = { gameName: 'SeasonGoblin', tag: 'TW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;
const other = { ...connection, gameName: 'OtherGoblin' };

class PGliteDatabase implements SqlDatabase {
  constructor(private readonly database: PGlite) {}
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.database.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.database.exec('BEGIN');
    try { const value = await work(this); await this.database.exec('COMMIT'); return value; }
    catch (error) { await this.database.exec('ROLLBACK'); throw error; }
  }
  async close(): Promise<void> { await this.database.close(); }
}

type Season = { id?: unknown; short?: unknown } | string | null | undefined;

function match(index: number, season: Season | 'omit' = { id: seasonA, short: 'e9a3' }, puuid = 'season-participant', name: string = connection.gameName) {
  return {
    metadata: {
      match_id: `fictional-season-match-${index}`,
      started_at: new Date(Date.UTC(2026, 8, 30 - index, 12)).toISOString(),
      game_length_in_ms: 1_800_000,
      map: { id: 'map-id', name: 'Ascent' },
      queue: { id: 'competitive', name: 'Competitive' },
      ...(season === 'omit' ? {} : { season }),
    },
    players: [{
      puuid, name, tag: connection.tag, team_id: 'Blue', agent: { id: 'agent-id', name: 'Sova' },
      stats: { kills: 3, deaths: 1, assists: 1, score: 200, headshots: 1, bodyshots: 1, legshots: 0, damage: { dealt: 150, received: 50 } },
    }],
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 0 } }],
    rounds: [{ id: 1, winning_team: 'Blue', result: 'Eliminated', plant: null,
      stats: [{ player: { puuid }, stats: { kills: 3, score: 200 }, economy: { loadout_value: 0, remaining: 800 } }] }],
    kills: [],
  };
}
const page = (...matches: ReturnType<typeof match>[]) => ({ status: 200, data: matches });

class Provider implements HistoricalMatchProvider, HistoricalDiscoveryProvider {
  calls = 0; storedCalls = 0; detailCalls = 0;
  constructor(private readonly pages: Map<number, unknown>, private readonly stored = new Map<number, { index: number; season: Season }[]>()) {}
  async fetchHistoryPage(_input: unknown, start: number) { this.calls += 1; return this.pages.get(start) ?? { status: 200, data: [] }; }
  async fetchStoredIndexPage(_input: unknown, number: number) {
    this.storedCalls += 1;
    return { data: (this.stored.get(number) ?? []).map(({ index, season }) => ({ meta: { id: match(index).metadata.match_id, ...(season === undefined ? {} : { season }) } })) };
  }
  async fetchMatchDetail(_input: unknown, id: string) { this.detailCalls += 1; return { status: 200, data: match(Number(id.split('-').at(-1))) }; }
}

async function seasons(database: SqlDatabase) {
  return (await database.query<{ season_id: string | null; season_short: string | null }>(
    'SELECT season_id, season_short FROM source_matches ORDER BY started_at DESC')).rows;
}
async function counts(database: SqlDatabase) {
  const tables = ['source_matches', 'match_participants', 'match_teams', 'rounds', 'round_participants', 'kill_events', 'kill_assistants', 'event_player_locations'];
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table, Number((await database.query<{ c: string }>(`SELECT count(*)::text AS c FROM ${table}`)).rows[0]!.c)])));
}

describe('season evidence normalization (TASK-DATA-SEASON-01)', () => {
  it('validates each field independently and never derives or guesses', () => {
    expect(normalizeSeasonEvidence({ id: seasonA.toUpperCase(), short: ' E9A3 ' })).toEqual({ seasonId: seasonA, seasonShort: 'e9a3' });
    expect(normalizeSeasonEvidence(undefined)).toEqual({});
    expect(normalizeSeasonEvidence(null)).toEqual({});
    expect(normalizeSeasonEvidence('e9a3')).toEqual({});
    expect(normalizeSeasonEvidence([seasonA, 'e9a3'])).toEqual({});
    expect(normalizeSeasonEvidence({ id: seasonA })).toEqual({ seasonId: seasonA });
    expect(normalizeSeasonEvidence({ id: seasonA, short: '' })).toEqual({ seasonId: seasonA });
    expect(normalizeSeasonEvidence({ short: 'e9a3' })).toEqual({ seasonShort: 'e9a3' });
    expect(normalizeSeasonEvidence({ id: 'not-a-uuid', short: 'e9a3' })).toEqual({ seasonShort: 'e9a3' });
    expect(normalizeSeasonEvidence({ id: 42, short: 7 })).toEqual({});
    expect(normalizeSeasonEvidence({ id: seasonA, short: '<script>' })).toEqual({ seasonId: seasonA });
    expect(normalizeSeasonEvidence({ id: seasonA, short: 'x'.repeat(40) })).toEqual({ seasonId: seasonA });
    // Unknown but safe code persists as evidence; the public Act key is derived only from recognized formats.
    expect(normalizeSeasonEvidence({ short: 'beta-2' })).toEqual({ seasonShort: 'beta-2' });
  });

  it('keeps an otherwise-valid match when the season is malformed', () => {
    const input = { ...connection, playerId: '00000000-0000-4000-8000-000000000001', limit: 1 as const };
    const [evidence] = normalizeHenrikEvidence(page(match(0, 'garbage')), input, hmacKey);
    expect(evidence).toBeDefined();
    expect(evidence!.seasonId).toBeUndefined();
    expect(evidence!.seasonShort).toBeUndefined();
    expect(evidence!.participants).toHaveLength(1);
  });
});

describe('season persistence and reconciliation', () => {
  let database: PGliteDatabase;
  let durable: DurableEvidenceService;
  let store: PostgresSyncStore;
  let publicPlayerId: string;
  const input = () => ({ ...connection, playerId: publicPlayerId, limit: 3 as const });

  beforeEach(async () => {
    database = new PGliteDatabase(new PGlite());
    await applyMigrations(database, await loadMigrations('migrations'));
    durable = new DurableEvidenceService(database, hmacKey);
    store = new PostgresSyncStore(database);
    publicPlayerId = (await durable.persistConnection(connection, 'season-participant', '2026-09-30T00:00:00.000Z')).publicPlayerId!;
  });
  afterEach(async () => { await database.close(); });

  it('persists, reobserves idempotently, never erases on omission and accepts valid corrections', async () => {
    await durable.persistMatches(input(), page(match(0)));
    expect(await seasons(database)).toEqual([{ season_id: seasonA, season_short: 'e9a3' }]);
    const baseline = await counts(database);
    await durable.persistMatches(input(), page(match(0)));
    expect(await counts(database)).toEqual(baseline);
    await durable.persistMatches(input(), page(match(0, 'omit')));
    await durable.persistMatches(input(), page(match(0, { id: 'broken', short: '' })));
    expect(await seasons(database)).toEqual([{ season_id: seasonA, season_short: 'e9a3' }]);
    await durable.persistMatches(input(), page(match(0, { id: seasonB, short: 'e9a2' })));
    expect(await seasons(database)).toEqual([{ season_id: seasonB, season_short: 'e9a2' }]);
    await durable.persistMatches(input(), page(match(0, { short: 'e9a1' })));
    expect(await seasons(database)).toEqual([{ season_id: seasonB, season_short: 'e9a1' }]);
    expect(await counts(database)).toEqual(baseline);
    const publicIds = (await database.query('SELECT public_id, provider_match_lookup_hmac FROM source_matches')).rows;
    await durable.persistMatches(input(), page(match(0)));
    expect((await database.query('SELECT public_id, provider_match_lookup_hmac FROM source_matches')).rows).toEqual(publicIds);
  });

  it('fills a durable match without season when deep live_v4 reobserves it as an overlap', async () => {
    await durable.persistMatches(input(), page(match(0, 'omit'), match(1, 'omit')));
    expect(await seasons(database)).toEqual([{ season_id: null, season_short: null }, { season_id: null, season_short: null }]);
    const provider = new Provider(new Map([[0, page(match(0), match(1, { id: seasonB, short: 'e9a2' }))]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const run = await service.start(publicPlayerId, 'deep_backfill');
    expect(run.progress.overlapsUpdated).toBe(2);
    expect(await seasons(database)).toEqual([{ season_id: seasonA, season_short: 'e9a3' }, { season_id: seasonB, season_short: 'e9a2' }]);
    expect(await counts(database)).toMatchObject({ source_matches: 2 });
  });

  it('fills season for already durable matches from Stored Matches rows without fabricating evidence', async () => {
    await durable.persistMatches(input(), page(match(0, 'omit'), match(1, 'omit'), match(2, 'omit')));
    const before = await counts(database);
    const provider = new Provider(new Map([[0, page()]]), new Map([[1, [
      { index: 0, season: { id: seasonA, short: 'e9a3' } },
      { index: 1, season: { short: 'e9a3' } },
      { index: 2, season: 'malformed' },
    ]]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'deep_backfill');
    expect(first.history?.historyPhase).toBe('stored_index');
    await service.continue(first.runId);
    expect(provider.detailCalls).toBe(0);
    expect(await counts(database)).toEqual(before);
    expect(await seasons(database)).toEqual([
      { season_id: seasonA, season_short: 'e9a3' },
      { season_id: null, season_short: 'e9a3' },
      { season_id: null, season_short: null },
    ]);
  });

  it('stored-row fill never touches non-participant, revoked, unknown or omitted rows', async () => {
    const otherId = (await durable.persistConnection(other, 'other-participant', '2026-09-30T00:00:00.000Z')).publicPlayerId!;
    await durable.persistMatches(input(), page(match(0, 'omit')));
    await durable.persistMatches({ ...other, playerId: otherId, limit: 1 }, page(match(5, 'omit', 'other-participant', other.gameName)));
    const internal = async (publicId: string) => (await database.query<{ id: string }>('SELECT id FROM players WHERE public_id=$1', [publicId])).rows[0]!.id;
    const me = await internal(publicPlayerId);
    const hmac = (index: number) => sourceMatchHmac('HenrikDev', `fictional-season-match-${index}`, hmacKey);
    expect(await store.fillKnownMatchSeasons(me, [{ hmac: hmac(5), seasonId: seasonA, seasonShort: 'e9a3' }])).toBe(0);
    expect(await store.fillKnownMatchSeasons(me, [{ hmac: hmac(99), seasonShort: 'e9a3' }])).toBe(0);
    expect(await store.fillKnownMatchSeasons(me, [{ hmac: hmac(0) }])).toBe(0);
    await database.query("UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id=$1", [me]);
    expect(await store.fillKnownMatchSeasons(me, [{ hmac: hmac(0), seasonShort: 'e9a3' }])).toBe(0);
    await database.query("UPDATE consents SET status='active', revoked_at=NULL WHERE player_id=$1", [me]);
    expect(await store.fillKnownMatchSeasons(me, [{ hmac: hmac(0), seasonShort: 'e9a3' }])).toBe(1);
    expect(await store.fillKnownMatchSeasons(me, [{ hmac: hmac(0), seasonShort: 'e9a3' }])).toBe(0);
    expect(await counts(database)).toMatchObject({ source_matches: 2 });
    expect((await seasons(database)).filter((row) => row.season_short)).toEqual([{ season_id: null, season_short: 'e9a3' }]);
  });

  it('activates truthful Act facts and public seasonKeys without exposing season ids or changing history order', async () => {
    await durable.persistMatches({ ...input(), limit: 10 }, page(match(0), match(1), match(2, { id: seasonB, short: 'e9a2' }), match(3, 'omit'), match(4, { id: seasonB, short: 'beta-2' })));
    const context = buildAnalyticsContext(await new PostgresAnalyticsContextRepository(database).readContextRows());
    expect(context.evidence.season).toMatchObject({
      status: 'partial', matchesWithSeasonId: 4, matchesWithSeasonShort: 4, matchesWithAct: 3, matchesWithoutAct: 2,
      unrecognizedSeasonCodes: 1, currentActKnown: false, latestRecordedAct: 'e9a3',
      acts: [{ key: 'e9a3', label: 'E9:A3', matches: 2 }, { key: 'e9a2', label: 'E9:A2', matches: 1 }],
    });
    const service = new DatasetProjectionService(new PostgresDatasetReadRepository(database), cursorKey);
    const snapshot = (await service.read()).payload;
    expect(isDatasetResponse(snapshot)).toBe(true);
    expect(snapshot.dataset.matches.map((m) => m.seasonKey)).toEqual(['e9a3', 'e9a3', 'e9a2', undefined, undefined]);
    const serialized = JSON.stringify([snapshot, context]);
    for (const secret of [seasonA, seasonB, 'beta-2']) expect(serialized).not.toContain(secret);
    const pages = [];
    let cursor: string | null = null;
    do {
      const history: Awaited<ReturnType<typeof service.readHistory>>['payload'] = (await service.readHistory(parseHistoryRequest({ limit: '2', ...(cursor ? { cursor } : {}) }, cursorKey))).payload;
      expect(isDatasetHistoryResponse(history)).toBe(true);
      pages.push(...history.dataset.matches);
      cursor = history.page.nextCursor;
    } while (cursor);
    expect(pages.map((m) => m.id)).toEqual(snapshot.dataset.matches.map((m) => m.id));
    expect(pages.map((m) => m.seasonKey)).toEqual(snapshot.dataset.matches.map((m) => m.seasonKey));
  });
});

describe('Act-aware analytics once season evidence exists', () => {
  const player: Player = { id: 'p', handle: 'p#T', displayName: 'p', role: 'Duelist', agents: ['Jett'], accent: '#fff', tagline: '', playstyle: '', defaultEmoji: '🐺' };
  const day = 86_400_000;
  const at = Date.UTC(2026, 9, 1);
  const record = (i: number, seasonKey?: string, mode = 'Competitive'): MatchRecord => ({
    id: `m-${String(i).padStart(3, '0')}`, playedAt: new Date(at - i * day / 2).toISOString(), map: i % 2 ? 'Bind' : 'Ascent', gameMode: mode, opponent: 'x',
    scoreFor: 13, scoreAgainst: 11, won: true, durationMinutes: 38, ...(seasonKey ? { seasonKey } : {}),
    performances: [{ playerId: 'p', agent: 'Jett', kills: 18, deaths: 14, assists: 4, acs: 230, adr: 150, kast: 0.7, eventEvidence: { kast: 'reconstructed', opening: 'reconstructed' }, firstKills: 2, firstDeaths: 2 }],
  });

  it('currentStrength (crossSeason=false) stops at the observed Act boundary; recentForm baseline may cross and records it', () => {
    const matches = [...Array.from({ length: 8 }, (_, i) => record(i, 'e9a3')), ...Array.from({ length: 30 }, (_, i) => record(i + 8, 'e9a2'))];
    const entries = createPerformanceEntries({ players: [player], matches, sourceId: 't', isDemo: false, mode: 'REAL' });
    const population = populationFromMatches(matches, true);
    const current = resolveAdaptiveWindow(entries, policyFor('currentStrength'), { population });
    expect(current.current.seasons).toEqual(['e9a3']);
    expect(current.current.matches).toBe(8);
    expect(current.reasons).toContain('act_boundary_respected');
    expect(current.reasons).not.toContain('season_evidence_unavailable');
    const form = resolveAdaptiveWindow(entries, policyFor('recentForm'), { population });
    expect(form.current.seasons).toEqual(['e9a3']);
    expect(form.baseline!.seasons).toContain('e9a2');
    expect(form.boundaries.seasonCrossed).toBe(true);
    expect(form.reasons).toContain('season_crossed_in_baseline');
  });

  it('partial coverage keeps ACT partial, excludes unknown-season matches and treats unknown as a boundary', () => {
    const matches = [...Array.from({ length: 6 }, (_, i) => record(i, 'e9a3')), record(6), ...Array.from({ length: 10 }, (_, i) => record(i + 7, 'e9a3'))];
    const entries = createPerformanceEntries({ players: [player], matches, sourceId: 't', isDemo: false, mode: 'REAL' });
    const population = populationFromMatches(matches, true);
    expect(population.seasonStatus).toBe('partial');
    const act = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'act', act: 'e9a3' }, { population });
    expect(act.scope).toMatchObject({ kind: 'ACT', status: 'partial' });
    expect(act.scope!.reasons).toContain('season_evidence_partial');
    expect(act.entries).toHaveLength(16);
    expect(act.entries.every((entry) => entry.match.seasonKey === 'e9a3')).toBe(true);
    const lifetime = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'all' }, { population });
    expect(lifetime.entries).toHaveLength(17);
    const current = resolveAdaptiveWindow(entries, policyFor('currentStrength'), { population });
    expect(current.current.matches).toBe(6);
    expect(current.reasons).toEqual(expect.arrayContaining(['act_boundary_respected', 'season_evidence_partial']));
  });
});
