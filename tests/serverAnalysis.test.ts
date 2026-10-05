import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { buildAnalyticsContext, PostgresAnalyticsContextRepository } from '../server/dataset/analyticsContext';
import { filtersFor, parseAnalysisRequest, ServerAnalysisService, type AnalysisRequest } from '../server/dataset/analysisService';
import { PublicApiError } from '../server/errors';
import datasetHandler from '../api/valorant/dataset';
import type { ApiResponse } from '../server/contracts';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { buildAnalytics } from '../src/data/analytics';
import { calculateRecentForm } from '../src/analytics/analysis';
import { selectPerformances } from '../src/analytics/filters';
import { aggregateSelection } from '../src/analytics/rankings';
import { buildSynergy, defaultSynergyFilters } from '../src/synergy/analytics';
import { isDatasetAnalysisResponse, selectionFromAnalysis } from '../src/dataSources/server/analysisResult';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types';

const squadId = '00000000-0000-4000-8000-000000000001';
const open: PGlite[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

class PGliteDatabase implements SqlDatabase {
  hook?: (sql: string) => Promise<void>;
  constructor(readonly pg: PGlite) { open.push(pg); }
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.pg.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.pg.exec('BEGIN');
    const executor: SqlExecutor = { query: async <Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      // Test hook simulates writes between phases (only possible here because PGlite is one session).
      if (this.hook && sql.startsWith('SET TRANSACTION')) return { rows: [] as Row[], rowCount: 0 };
      const result = await this.query<Row>(sql, params);
      if (this.hook && sql.includes('first_team_key')) { const hook = this.hook; this.hook = undefined; await hook(sql); }
      return result;
    } };
    try { const value = await work(executor); await this.pg.exec('COMMIT'); return value; }
    catch (error) { await this.pg.exec('ROLLBACK'); throw error; }
  }
  async close(): Promise<void> { await this.pg.close(); }
}

async function database(): Promise<PGliteDatabase> {
  const db = new PGliteDatabase(new PGlite());
  await applyMigrations(db, await loadMigrations(resolve('migrations')));
  return db;
}

const uuid = (kind: number, value: number) => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const hex = (value: number) => value.toString(16).padStart(64, '0');
function placeholders(rows: number, width: number): string {
  let index = 1;
  return Array.from({ length: rows }, () => `(${Array.from({ length: width }, () => `$${index++}`).join(',')})`).join(',');
}
async function insertRows(db: SqlDatabase, sql: string, rows: unknown[][], width: number) {
  const chunk = Math.floor(30_000 / width);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    if (slice.length) await db.query(`${sql} VALUES ${placeholders(slice.length, width)}`, slice.flat());
  }
}

interface Seat { player: number; team?: 'Blue' | 'Red'; agent?: string; kills?: number }
interface Spec { n: number; hoursAgo: number; seats: Seat[]; queue?: string; season?: string | null; map?: string; rounds?: number }
const anchor = Date.UTC(2026, 9, 5, 12);

async function seedPlayers(db: SqlDatabase, count: number) {
  await db.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3)', [squadId, 'friends', 'Friends']);
  const players = Array.from({ length: count }, (_, i) => [uuid(1, i + 1), uuid(2, i + 1), `Player${i + 1}`, 'T', '🐺']);
  await insertRows(db, 'INSERT INTO players (id,public_id,display_name,display_tag,default_emoji)', players, 5);
  await insertRows(db, 'INSERT INTO squad_memberships (id,squad_id,player_id,status)', players.map((p, i) => [uuid(3, i + 1), squadId, p[0], 'active']), 4);
  await insertRows(db, 'INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at)', players.map((p, i) => [uuid(4, i + 1), p[0], 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00Z']), 6);
}

async function seedMatches(db: SqlDatabase, specs: Spec[]) {
  const matches: unknown[][] = []; const teams: unknown[][] = []; const parts: unknown[][] = []; const rounds: unknown[][] = []; const presences: unknown[][] = [];
  for (const s of specs) {
    const started = new Date(anchor - s.hoursAgo * 3_600_000).toISOString();
    const roundCount = s.rounds ?? 2;
    matches.push([uuid(5, s.n), squadId, 'HenrikDev', hex(s.n), 'v4', 'durable-evidence-v2', 'ap', s.map ?? 'Ascent', s.queue ?? 'competitive', s.queue ?? 'Competitive', started, 2_100_000, started, started, uuid(6, s.n), 'observed', 'observed', s.season === undefined ? 'e11a5' : s.season]);
    teams.push([uuid(7, s.n * 2), uuid(5, s.n), 'Blue', true, 13, 9], [uuid(7, s.n * 2 + 1), uuid(5, s.n), 'Red', false, 9, 13]);
    for (let r = 1; r <= roundCount; r += 1) rounds.push([uuid(9, s.n * 4 + r), uuid(5, s.n), r, 'observed', 'missing', 'missing']);
    for (const seat of s.seats) {
      const pid = uuid(8, s.n * 16 + seat.player);
      parts.push([pid, uuid(5, s.n), uuid(1, seat.player), hex(1_000_000 + s.n * 16 + seat.player), seat.team ?? 'Blue', seat.agent ?? 'Jett', 'observed', seat.kills ?? 15 + (s.n % 7), 12, 4, 4200 + (s.n % 11) * 90, 3000 + (s.n % 13) * 70, 9, 20, 3]);
      for (let r = 1; r <= roundCount; r += 1) presences.push([uuid(10, (s.n * 16 + seat.player) * 4 + r), uuid(9, s.n * 4 + r), pid, 'observed', 'missing', 'missing', 'missing']);
    }
  }
  await insertRows(db, 'INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status,season_short)', matches, 18);
  await insertRows(db, 'INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost)', teams, 6);
  await insertRows(db, 'INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots)', parts, 15);
  await insertRows(db, 'INSERT INTO rounds (id,source_match_id,round_number,participants_evidence_status,plant_status,defuse_status)', rounds, 6);
  await insertRows(db, 'INSERT INTO round_participants (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status)', presences, 7);
}

/** A varied history: shared duos, opponents, queues, two Acts, maps, agents and an unknown season. */
function variedSpecs(count: number, first = 1): Spec[] {
  const maps = ['Ascent', 'Bind', 'Haven', 'Lotus'];
  const agents = ['Jett', 'Sova', 'Omen', 'Killjoy'];
  return Array.from({ length: count }, (_, i) => {
    const n = first + i;
    const seats: Seat[] = [{ player: 1 + (n % 4), agent: agents[n % 4] }];
    if (n % 3 === 0) seats.push({ player: 1 + ((n + 1) % 4), agent: agents[(n + 1) % 4] });
    if (n % 5 === 0) seats.push({ player: 1 + ((n + 2) % 4), team: 'Red', agent: agents[(n + 2) % 4] });
    return { n, hoursAgo: i * 7 + (n % 3), seats, queue: n % 6 === 0 ? 'unrated' : 'competitive', season: n % 17 === 0 ? null : i < count / 2 ? 'e11a5' : 'e11a4', map: maps[n % 4], rounds: 2 + (n % 3) };
  });
}

function request(partial: Partial<AnalysisRequest>): AnalysisRequest {
  return { feature: 'currentStrength', map: 'all', agent: 'all', role: 'all', mode: 'all', player: 'all', form: false, ...partial };
}

async function clientView(db: SqlDatabase) {
  const snapshot = (await new DatasetProjectionService(new PostgresDatasetReadRepository(db)).read()).payload;
  const context = buildAnalyticsContext(await new PostgresAnalyticsContextRepository(db).readContextRows());
  const analytics = buildAnalytics(snapshot.dataset, {
    snapshotCoversTrackedHistory: context.population.snapshotCoversTrackedHistory,
    seasonKeys: context.evidence.season.acts.map((act) => act.key), seasonStatus: context.evidence.season.status, rankStatus: context.evidence.rank.status,
  });
  return { snapshot, analytics };
}

const service = (db: SqlDatabase) => new ServerAnalysisService(db, new DatasetProjectionService(new PostgresDatasetReadRepository(db)));
const lifetimeFeature = (r: AnalysisRequest) => (r.feature === 'mapStats' || r.feature === 'agentStats' ? r.feature : 'lifetimeTotals');
const scoreSummary = (_dataset: NormalizedAnalyticsDataset, selection: ReturnType<typeof selectPerformances>) =>
  aggregateSelection(selection).map((a) => [a.player.id, a.stats.matches, a.stats.rounds, a.stats.acs, a.scores.overall.value ?? null, a.scores.overall.status, a.scores.confidence])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe('DATA-03B.2B request contract', () => {
  it('accepts only declared features and context; the registry decides the population', () => {
    expect(parseAnalysisRequest({ feature: 'currentStrength', form: '1' })).toMatchObject({ feature: 'currentStrength', form: true });
    expect(filtersFor(parseAnalysisRequest({ feature: 'mapStats', map: 'Bind', from: '2026-09-01' }))).toMatchObject({ period: 'custom', map: 'Bind', dateFrom: '2026-09-01' });
    expect(filtersFor(parseAnalysisRequest({ feature: 'fixedRecent', recent: '10' })).period).toBe('recent10');
    for (const bad of [{}, { feature: 'everything' }, { feature: 'currentStrength', limit: undefined, recent: '10' }, { feature: 'fixedRecent', recent: '742' },
      { feature: 'actOverview' }, { feature: 'actOverview', act: 'E11A5' }, { feature: 'currentStrength', from: '2026-01-01' },
      { feature: 'currentStrength', player: 'Player1' }, { feature: 'currentStrength', role: 'Carry' }, { feature: 'synergy', form: '1' },
      { feature: ['currentStrength', 'synergy'] }, { feature: 'currentStrength', map: '<script>' }]) {
      let caught: unknown;
      try { parseAnalysisRequest(bad as never); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(PublicApiError);
    }
  });
});

describe('client/server parity while tracked history fits the snapshot', () => {
  it('produces identical populations, scores, windows and recent form for every feature/context', async () => {
    const db = await database();
    await seedPlayers(db, 4);
    await seedMatches(db, variedSpecs(120));
    const { snapshot, analytics } = await clientView(db);
    const server = service(db);
    const requests: AnalysisRequest[] = [
      request({ form: true }), request({ map: 'Bind' }), request({ agent: 'Sova' }),
      request({ feature: 'lifetimeTotals' }), request({ feature: 'lifetimeTotals', from: '2026-09-20', to: '2026-10-01' }),
      request({ feature: 'mapStats', map: 'Haven' }), request({ feature: 'agentStats', agent: 'Omen', mode: 'Competitive' }),
      request({ feature: 'actOverview', act: 'e11a4' }), request({ feature: 'actOverview', act: 'e11a5', map: 'Lotus' }),
      request({ feature: 'fixedRecent', recent: 10 }), request({ feature: 'fixedRecent', recent: 30, role: 'Initiator' }),
      request({ player: uuid(2, 2) }),
    ];
    for (const r of requests) {
      const { payload } = await server.analyze(r);
      expect(isDatasetAnalysisResponse(payload)).toBe(true);
      const client = selectPerformances(analytics.performanceEntries, filtersFor(r), { population: analytics.population, lifetimeFeature: lifetimeFeature(r) });
      const serverSelection = selectionFromAnalysis(payload);
      const ids = (s: typeof client) => Object.fromEntries([...s.byPlayer].map(([p, e]) => [p, e.map((x) => x.match.id)]));
      expect(ids(serverSelection), JSON.stringify(r)).toEqual(ids(client));
      expect(scoreSummary(payload.dataset, serverSelection), JSON.stringify(r)).toEqual(scoreSummary(snapshot.dataset, client));
      const strip = (scope: NonNullable<typeof client.scope>) => ({ ...scope, players: [...scope.players.values()].map(({ window, ...p }) => ({ ...p, ...(window ? { confidence: window.confidence, status: window.status } : {}) })).sort((x, y) => x.playerId.localeCompare(y.playerId)) });
      const serverScope = serverSelection.scope!;
      expect(strip(serverScope), JSON.stringify(r)).toEqual(strip(client.scope!));
      if (r.form) {
        for (const form of payload.forms!) {
          const entries = selectPerformances(analytics.performanceEntries, { ...filtersFor(r), period: 'all' }, { population: analytics.population }).byPlayer.get(form.playerId)!;
          const local = calculateRecentForm(entries[0]!.player, entries, analytics.population);
          expect(form.window.currentMatchIds).toEqual(local.window!.currentEntries.map((e) => e.match.id));
          expect(form.window.baselineMatchIds).toEqual(local.window!.baselineEntries.map((e) => e.match.id));
        }
      }
    }
    const pair = await server.analyze(request({ feature: 'synergy', act: 'e11a5' }));
    const strip = (results: ReturnType<typeof buildSynergy>) => results.map((r) => [r.pair.key, r.status, r.value ?? null, r.sharedSample.matches, [r.playerA.baseline.matches, r.playerB.baseline.matches]]);
    expect(strip(buildSynergy(pair.payload.dataset, { ...defaultSynergyFilters, act: 'e11a5' }))).toEqual(strip(buildSynergy(snapshot.dataset, { ...defaultSynergyFilters, act: 'e11a5' })));
  }, 120_000);
});

describe('parity regressions found by production read-only acceptance', () => {
  it('is independent of SQL row order and uses real evidence for unavailable windows', async () => {
    const db = await database();
    await seedPlayers(db, 5);
    // Insert oldest-first (reverse of playedAt) so SQL row order differs from the snapshot order.
    await seedMatches(db, [...variedSpecs(90)].reverse());
    // Player 5 gets a thin, mostly non-Competitive recent history -> unavailable current window.
    await seedMatches(db, Array.from({ length: 3 }, (_, i) => ({ n: 5000 + i, hoursAgo: 1 + i, seats: [{ player: 5 }], map: 'Summit', queue: i ? 'unrated' : 'competitive' })));
    // Missing kill evidence on a third of matches -> partial/unavailable KAST/Opening event evidence.
    await db.query("UPDATE source_matches SET kills_evidence_status='missing' WHERE right(public_id::text, 1) IN ('1','4','7','a')");
    await db.query("UPDATE source_matches SET kills_evidence_status='missing' WHERE id = ANY($1::uuid[])", [[uuid(5, 5000), uuid(5, 5001), uuid(5, 5002)]]);
    const { analytics } = await clientView(db);
    const server = service(db);
    for (const r of [request({ feature: 'actOverview', act: 'e11a5' }), request({ map: 'Summit' }), request({}), request({ feature: 'actOverview', act: 'e11a4', mode: 'Competitive' })]) {
      const { payload } = await server.analyze(r);
      const serverSel = selectionFromAnalysis(payload);
      const client = selectPerformances(analytics.performanceEntries, filtersFor(r), { population: analytics.population });
      const ids = (sel: typeof client) => [...sel.byPlayer].map(([p, e]) => [p, e.map((x) => x.match.id)]).sort();
      expect(ids(serverSel), JSON.stringify(r)).toEqual(ids(client));
      expect(scoreSummary(payload.dataset, serverSel), JSON.stringify(r)).toEqual(scoreSummary(payload.dataset, client));
      const windows = (sel: typeof client) => [...sel.scope!.players.values()].map((p) => [p.playerId, p.status, p.reasons, p.window?.confidence ?? null]).sort();
      expect(windows(serverSel), JSON.stringify(r)).toEqual(windows(client));
    }
    const current = (await server.analyze(request({}))).payload.scope!.players.find((p) => p.playerId === uuid(2, 5))!;
    expect(current.status).toBe('unavailable');
    expect(current.window!.confidence.evidence).toBeLessThan(1);
  }, 120_000);
});

describe('analytics beyond the newest-300 transport snapshot', () => {
  it('reaches older durable evidence for currentStrength, recentForm, lifetime, Act, map, agent and pair baselines', async () => {
    const db = await database();
    await seedPlayers(db, 3);
    // Player 1 floods the newest 330 matches; players 2/3 (a duo) only played before them.
    const flood: Spec[] = Array.from({ length: 330 }, (_, i) => ({ n: i + 1, hoursAgo: i * 2, seats: [{ player: 1 }], map: 'Ascent', season: 'e11a5' }));
    const older: Spec[] = Array.from({ length: 40 }, (_, i) => ({ n: 1000 + i, hoursAgo: 700 + i * 20, map: i % 2 ? 'Bind' : 'Haven', season: i < 25 ? 'e11a5' : 'e11a4',
      seats: i % 4 === 0 ? [{ player: 2, agent: 'Sova' }] : [{ player: 2, agent: 'Sova' }, { player: 3, agent: 'Omen' }] }));
    const p3solo: Spec[] = Array.from({ length: 10 }, (_, i) => ({ n: 2000 + i, hoursAgo: 710 + i * 31, seats: [{ player: 3, agent: 'Omen' }], season: 'e11a4', map: 'Bind' }));
    await seedMatches(db, [...flood, ...older, ...p3solo]);
    const { snapshot, analytics } = await clientView(db);
    expect(snapshot.dataset.matches).toHaveLength(300);
    expect(analytics.population.complete).toBe(false);
    const server = service(db);

    const current = await server.analyze(request({ form: true }));
    expect(current.payload.coverage).toMatchObject({ trackedMatchCount: 380, serverHistoryUsed: true, transportSnapshotUsed: false, populationComplete: true });
    const p2 = current.payload.scope!.players.find((p) => p.playerId === uuid(2, 2))!;
    expect(p2.status).not.toBe('unavailable');
    expect(p2.reasons).not.toContain('transport_window_truncated');
    const snapshotIds = new Set(snapshot.dataset.matches.map((m) => m.id));
    expect(current.payload.selection[uuid(2, 2)]!.every((id) => !snapshotIds.has(id))).toBe(true);
    const clientP2 = selectPerformances(analytics.performanceEntries, filtersFor(request({})), { population: analytics.population }).scope!.players.get(uuid(2, 2));
    expect(clientP2?.sample.matches ?? 0).toBe(0);
    const form = current.payload.forms!.find((f) => f.playerId === uuid(2, 2))!;
    expect(form.window.baselineMatchIds.length).toBeGreaterThan(0);
    expect([...form.window.currentMatchIds, ...form.window.baselineMatchIds].every((id) => !snapshotIds.has(id))).toBe(true);
    expect(current.payload.dataset.matches.length).toBeLessThanOrEqual(3 * (50 + 30 + 10));

    const lifetime = await server.analyze(request({ feature: 'lifetimeTotals' }));
    expect(new Set(Object.values(lifetime.payload.selection).flat()).size).toBe(380);
    const act = await server.analyze(request({ feature: 'actOverview', act: 'e11a4' }));
    expect(new Set(Object.values(act.payload.selection).flat()).size).toBe(25);
    expect(act.payload.dataset.matches.every((m) => m.seasonKey === 'e11a4')).toBe(true);
    const map = await server.analyze(request({ feature: 'mapStats', map: 'Bind' }));
    expect(new Set(Object.values(map.payload.selection).flat()).size).toBe(30);
    const agent = await server.analyze(request({ feature: 'agentStats', agent: 'Omen' }));
    expect(agent.payload.selection[uuid(2, 3)]).toHaveLength(40);
    const pair = await server.analyze(request({ feature: 'synergy' }));
    const duo = buildSynergy(pair.payload.dataset, defaultSynergyFilters).find((r) => r.pair.key === JSON.stringify([uuid(2, 2), uuid(2, 3)].sort()))!;
    expect(duo.sharedSample.matches).toBe(30);
    expect([duo.playerA.baseline.matches, duo.playerB.baseline.matches].sort()).toEqual([10, 10]);
    expect(buildSynergy(snapshot.dataset, defaultSynergyFilters).find((r) => r.pair.key === duo.pair.key)).toBeUndefined();
  }, 120_000);
});

describe('consistency, consent and privacy', () => {
  it('is deterministic, re-evaluates consent per request and never leaks internal identifiers', async () => {
    const db = await database();
    await seedPlayers(db, 3);
    await seedMatches(db, variedSpecs(60).map((s) => ({ ...s, seats: s.seats.filter((seat) => seat.player <= 3) })).filter((s) => s.seats.length));
    const server = service(db);
    const a = (await server.analyze(request({ form: true }))).payload;
    const b = (await server.analyze(request({ form: true }))).payload;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const text = JSON.stringify(a);
    for (let n = 1; n <= 60; n += 1) { expect(text).not.toContain(uuid(5, n)); expect(text).not.toContain(hex(n)); }
    expect(text).not.toContain(uuid(1, 1));
    expect(text.toLowerCase()).not.toMatch(/henrikdev|puuid|hmac|internal_|season_id|provider_match/u);
    await db.query("UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id=$1", [uuid(1, 2)]);
    const revoked = (await server.analyze(request({ feature: 'lifetimeTotals' }))).payload;
    expect(revoked.selection[uuid(2, 2)]).toBeUndefined();
    expect(JSON.stringify(revoked)).not.toContain('Player2');
  }, 60_000);

  it('drops a selected match that vanishes before phase 2 instead of scoring a skeleton', async () => {
    const db = await database();
    await seedPlayers(db, 2);
    await seedMatches(db, Array.from({ length: 20 }, (_, i) => ({ n: i + 1, hoursAgo: i * 5, seats: [{ player: 1 }, { player: 2 }] })));
    db.hook = async () => { await db.pg.query("UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id=$1", [uuid(1, 2)]); };
    const payload = (await service(db).analyze(request({ feature: 'lifetimeTotals' }))).payload;
    expect(payload.selection[uuid(2, 2)]).toBeUndefined();
    expect(payload.dataset.matches.every((m) => m.performances.every((p) => p.acs > 0))).toBe(true);
    expect(payload.selection[uuid(2, 1)]).toHaveLength(20);
  }, 60_000);

  it('serves view=analysis through the existing function and fails closed while disabled', async () => {
    const previous = process.env.REAL_DATASET_READ_MODE;
    delete process.env.REAL_DATASET_READ_MODE;
    let status = 0; let body: unknown; const headers = new Map<string, string>();
    const response: ApiResponse = { status(code) { status = code; return this; }, json(value) { body = value; }, setHeader(n, v) { headers.set(n.toLowerCase(), v); } };
    try { await datasetHandler({ method: 'GET', headers: {}, query: { view: 'analysis', feature: 'currentStrength' }, socket: { remoteAddress: 'analysis-test' } }, response); }
    finally { if (previous === undefined) delete process.env.REAL_DATASET_READ_MODE; else process.env.REAL_DATASET_READ_MODE = previous; }
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, schemaVersion: 4, state: 'disabled', source: 'REAL_SERVER' });
    expect(headers.get('cache-control')).toBe('no-store');
  });
});

describe('DATA-03B.2B bounded performance', () => {
  it.each([100, 300, 1000, 5000, 10_000])('keeps phase-2 evidence bounded by policy over %i durable matches', async (count) => {
    const db = await database();
    await seedPlayers(db, 4);
    const specs = variedSpecs(count);
    await seedMatches(db, specs);
    const server = service(db);
    const current = await server.analyze(request({ form: true }));
    expect(current.metrics.eligibleMatches).toBe(count);
    expect(current.metrics.selectedMatches).toBeLessThanOrEqual(4 * (50 + 10 + 30));
    expect(current.metrics.sqlQueryCount).toBeLessThanOrEqual(9);
    const act = await server.analyze(request({ feature: 'actOverview', act: 'e11a4', map: 'Bind' }));
    const pair = await server.analyze(request({ feature: 'synergy', act: 'e11a5' }));
    const lifetime = await server.analyze(request({ feature: 'lifetimeTotals' }));
    expect(lifetime.payload.status).toBe(count > 2000 ? 'partial' : 'available');
    process.stdout.write(`SERVER_ANALYSIS ${count} ${JSON.stringify({ currentStrength: current.metrics, actBind: act.metrics, synergyAct: pair.metrics, lifetime: lifetime.metrics })}\n`);
  }, 600_000);
});
