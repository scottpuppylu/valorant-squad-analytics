import { afterEach, describe, expect, it } from 'vitest';
import { buildAnalyticsContext, PostgresAnalyticsContextRepository } from '../server/dataset/analyticsContext';
import { ServerAnalysisService, type AnalysisRequest } from '../server/dataset/analysisService';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { parseHistoryRequest } from '../server/dataset/historyCursor';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { datasetWindowSize } from '../server/dataset/types';
import { isDatasetAnalysisResponse } from '../src/dataSources/server/analysisResult';
import { isDatasetAnalyticsContextResponse } from '../src/dataSources/server/datasetContract';
import { closeAll, database, seedMatches, seedPlayers, uuid, type Spec } from './support/durableFixtures';

/**
 * TASK-DATA-03B.2C — the REAL website has no 300 (transport) or 2000 (former phase-2) match-count
 * ceiling: every ALL-TRACKED/ACT/PAIR feature aggregates the whole eligible tracked population.
 */
afterEach(closeAll);

const cursorKey = 'full-tracked-cursor-test-key-material-32-bytes-plus';
const projection = (db: Awaited<ReturnType<typeof database>>) => new DatasetProjectionService(new PostgresDatasetReadRepository(db), cursorKey);
const service = (db: Awaited<ReturnType<typeof database>>) => new ServerAnalysisService(db, projection(db));
const request = (partial: Partial<AnalysisRequest>): AnalysisRequest => ({ feature: 'currentStrength', map: 'all', agent: 'all', role: 'all', mode: 'all', player: 'all', form: false, ...partial });
const maps = ['Ascent', 'Bind', 'Haven', 'Lotus'];
const agents = ['Jett', 'Sova', 'Omen', 'Killjoy'];

/** n matches for 3 players; every 4th match is a player 1+2 duo; Act e11a4 on the older half. */
function population(count: number): Spec[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const seats = n % 4 === 0 ? [{ player: 1, agent: agents[n % 4] }, { player: 2, agent: agents[(n + 1) % 4] }] : [{ player: 1 + (n % 3), agent: agents[n % 4] }];
    return { n, hoursAgo: i * 3, seats, map: maps[n % 4], season: i < count / 2 ? 'e11a5' : 'e11a4', queue: 'competitive' };
  });
}

async function seeded(count: number, players = 3) {
  const db = await database();
  await seedPlayers(db, players);
  await seedMatches(db, population(count));
  return db;
}

const totalMatches = (payload: { summary?: { analytics: { stats: { matches: number } }[] } }) => payload.summary!.analytics.reduce((sum, a) => sum + a.stats.matches, 0);

describe('transport snapshot is transport-only', () => {
  it.each([299, 300, 301])('%i tracked matches: snapshot ≤ 300, analytics and history cover every match', async (count) => {
    const db = await seeded(count);
    const snapshot = (await projection(db).read()).payload;
    expect(snapshot.dataset.matches).toHaveLength(Math.min(count, datasetWindowSize));
    // boundedMatchLimit describes the TRANSPORT payload only; it never limits analytics or history.
    expect(snapshot.coverage.boundedMatchLimit).toBe(300);

    const context = buildAnalyticsContext(await new PostgresAnalyticsContextRepository(db).readContextRows());
    expect(isDatasetAnalyticsContextResponse(JSON.parse(JSON.stringify(context)))).toBe(true);
    expect(context.population).toMatchObject({ trackedMatchCount: count, snapshotWindow: 300, snapshotCoversTrackedHistory: count <= 300 });
    expect(context.facets!.maps.reduce((sum, item) => sum + item.matches, 0)).toBe(count);
    expect(context.facets!.agents).toEqual([...agents].sort());
    expect(context.facets!.teamOutcome.matches).toBe(count);

    const lifetime = await service(db).analyze(request({ feature: 'lifetimeTotals' }));
    expect(isDatasetAnalysisResponse(JSON.parse(JSON.stringify(lifetime.payload)))).toBe(true);
    expect(lifetime.payload.coverage).toMatchObject({ trackedMatchCount: count, populationMatches: count, populationComplete: true, serverHistoryUsed: true, transportSnapshotUsed: false, populationLimit: null });
    // Duo matches contribute one entry per member.
    expect(totalMatches(lifetime.payload)).toBe(count + Math.floor(count / 4));

    // History: start strictly older than the snapshot; no duplicate and no gap at match #301.
    const ids = new Set(snapshot.dataset.matches.map((m) => m.id));
    const oldest = snapshot.dataset.matches.at(-1)!;
    let page = (await projection(db).readHistory(parseHistoryRequest({ before: oldest.id, limit: '100' }, cursorKey))).payload;
    for (;;) {
      for (const match of page.dataset.matches) { expect(ids.has(match.id)).toBe(false); ids.add(match.id); }
      if (!page.page.nextCursor) break;
      page = (await projection(db).readHistory(parseHistoryRequest({ cursor: page.page.nextCursor, limit: '100' }, cursorKey))).payload;
    }
    expect(ids.size).toBe(count);
    expect(page.tracked.trackedMatchCount).toBe(count);
  }, 120_000);
});

describe('no generic 2000 phase-2 cap', () => {
  it.each([1999, 2000, 2001])('%i matches: ALL TRACKED / map / agent / Act / pair stay complete', async (count) => {
    const db = await seeded(count);
    const server = service(db);
    const lifetime = await server.analyze(request({ feature: 'lifetimeTotals' }));
    expect(lifetime.payload.status).toBe('available');
    expect(lifetime.payload.coverage).toMatchObject({ populationMatches: count, populationComplete: true, populationLimit: null });
    expect(totalMatches(lifetime.payload)).toBe(count + Math.floor(count / 4));
    expect(lifetime.metrics.shippedMatches).toBe(0);
    expect(lifetime.metrics.phase2Chunks).toBe(Math.ceil(count / 250));

    const bind = await server.analyze(request({ feature: 'mapStats', map: 'Bind' }));
    expect(bind.payload.summary!.groups.maps).toEqual([expect.objectContaining({ id: 'Bind', matches: population(count).filter((s) => s.map === 'Bind').length })]);
    const omen = await server.analyze(request({ feature: 'agentStats', agent: 'Omen' }));
    const omenAppearances = population(count).flatMap((s) => s.seats).filter((seat) => seat.agent === 'Omen').length;
    expect(omen.payload.summary!.groups.agents).toEqual([expect.objectContaining({ id: 'Omen', appearances: omenAppearances })]);
    const act = await server.analyze(request({ feature: 'actOverview', act: 'e11a4' }));
    expect(act.payload.coverage.populationMatches).toBe(population(count).filter((s) => s.season === 'e11a4').length);
    expect(act.payload.coverage.populationComplete).toBe(true);

    const pair = await server.analyze(request({ feature: 'synergy' }));
    const duo = pair.payload.synergy!.find((r) => r.pair.key === JSON.stringify([uuid(2, 1), uuid(2, 2)].sort()))!;
    expect(duo.sharedSample.matches).toBe(Math.floor(count / 4));
    expect(duo.sharedSample.matches).toBeGreaterThan(300);
    expect(pair.payload.coverage).toMatchObject({ populationMatches: count, populationComplete: true });

    // Intentional analytical windows stay bounded (they are definitions, not caps).
    const current = await server.analyze(request({ form: true }));
    expect(current.metrics.selectedMatches).toBeLessThanOrEqual(3 * (50 + 10 + 30));
    const progress = await server.analyze(request({ feature: 'improvementIndex' }));
    expect(progress.metrics.selectedMatches).toBeLessThanOrEqual(3 * (30 + 60));
  }, 300_000);

  it('5000 matches: full population, response size independent of match count', async () => {
    const small = await service(await seeded(500)).analyze(request({ feature: 'lifetimeTotals' }));
    const db = await seeded(5000);
    const big = await service(db).analyze(request({ feature: 'lifetimeTotals' }));
    expect(big.payload.coverage).toMatchObject({ trackedMatchCount: 5000, populationMatches: 5000, populationComplete: true });
    expect(totalMatches(big.payload)).toBe(5000 + 1250);
    expect(big.metrics.serializedBytes).toBeLessThan(small.metrics.serializedBytes * 1.2);
    // Linear in chunks, never one query per match.
    expect(big.metrics.sqlQueryCount).toBe(3 + 2 + 4 * Math.ceil(5000 / 250));
  }, 300_000);
});

describe('low-volume member whose evidence is entirely beyond #300 and #2000', () => {
  it('contributes to lifetime, map, agent, pair and the adaptive baseline search', async () => {
    const db = await database();
    await seedPlayers(db, 3);
    const flood: Spec[] = Array.from({ length: 2050 }, (_, i) => ({ n: i + 1, hoursAgo: i, seats: [{ player: 1 }], map: 'Ascent' }));
    const duo: Spec[] = Array.from({ length: 320 }, (_, i) => ({ n: 5000 + i, hoursAgo: 2100 + i * 2, map: 'Lotus', seats: [{ player: 2, agent: 'Sova' }, { player: 3, agent: 'Omen' }] }));
    await seedMatches(db, [...flood, ...duo]);
    const server = service(db);
    const lifetime = await server.analyze(request({ feature: 'lifetimeTotals' }));
    expect(lifetime.payload.summary!.analytics.find((a) => a.player.id === uuid(2, 2))!.stats.matches).toBe(320);
    const lotus = await server.analyze(request({ feature: 'mapStats', map: 'Lotus' }));
    expect(lotus.payload.summary!.groups.maps[0]).toMatchObject({ id: 'Lotus', matches: 320, players: 2 });
    const sova = await server.analyze(request({ feature: 'agentStats', agent: 'Sova' }));
    expect(sova.payload.summary!.analytics.map((a) => [a.player.id, a.stats.matches])).toEqual([[uuid(2, 2), 320]]);
    const pair = await server.analyze(request({ feature: 'synergy' }));
    expect(pair.payload.synergy!.find((r) => r.pair.key === JSON.stringify([uuid(2, 2), uuid(2, 3)].sort()))!.sharedSample.matches).toBe(320);
    const current = await server.analyze(request({}));
    const p2 = current.payload.scope!.players.find((p) => p.playerId === uuid(2, 2))!;
    // The adaptive search reaches the whole chronology (older than #2000) to choose its bounded window.
    expect(p2.window!.currentMatchIds.length).toBeGreaterThan(0);
    expect(p2.window!.currentMatchIds.length).toBeLessThanOrEqual(50);
    const text = JSON.stringify(lifetime.payload);
    expect(text).not.toContain(uuid(5, 5000));
    expect(text.toLowerCase()).not.toMatch(/henrikdev|puuid|hmac|internal_|season_id|provider_match/u);
  }, 300_000);
});

describe('populationComplete is truthful', () => {
  it('is false (and the status partial) when a selected match loses its evidence before phase 2', async () => {
    const db = await database();
    await seedPlayers(db, 2);
    await seedMatches(db, Array.from({ length: 12 }, (_, i) => ({ n: i + 1, hoursAgo: i * 5, seats: [{ player: i < 3 ? 2 : 1 }] })));
    // Player 2's consent is revoked right after phase 1: their 3 solo matches can no longer be projected.
    db.hook = async () => { await db.pg.query("UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id=$1", [uuid(1, 2)]); };
    const result = await service(db).analyze(request({ feature: 'lifetimeTotals' }));
    expect(result.payload.coverage.populationComplete).toBe(false);
    expect(result.payload.status).toBe('partial');
    expect(result.payload.reasons).toEqual(['population_incomplete']);
    expect(result.payload.summary!.analytics.map((a) => a.player.id)).toEqual([uuid(2, 1)]);
  }, 60_000);
});
