import { describe, expect, it } from 'vitest';
import { hydrateAnalysisFacts } from '../server/dataset/analysisFactHydration';
import { ServerAnalysisService, type AnalysisRequest } from '../server/dataset/analysisService';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { benchDatabase, seedBenchAccounts, seedBenchMatches } from './support/analysisBenchFixture';

/**
 * TASK-DATA-03B.2D full-tracked-aggregate-v1 structural gates on REALISTIC topology (10 participants,
 * 13–20 rounds, kills with assistants, mixed queues, partial evidence).
 *
 * HARD (CI): constant SQL statement count for every unbounded feature, no phase-2 chunks, no fallback once
 * facts exist, full population, response bytes independent of match count.
 * INFORMATIONAL (local): wall-clock timings, printed as FULL_TRACKED_LATENCY lines. Set
 * ANALYSIS_BENCH_SIZES="300,1000,2000,5000,10000" to run the full local benchmark; CI runs 300 and 1000.
 */
const sizes = (process.env.ANALYSIS_BENCH_SIZES ?? '300,1000').split(',').map(Number);
const r = (p: Partial<AnalysisRequest>): AnalysisRequest => ({ feature: 'lifetimeTotals', map: 'all', agent: 'all', role: 'all', mode: 'all', player: 'all', form: false, ...p });
const features: [string, AnalysisRequest, boolean][] = [
  ['currentStrength', r({ feature: 'currentStrength', form: true }), false],
  ['lifetimeTotals', r({}), true],
  ['mapStats', r({ feature: 'mapStats' }), true],
  ['agentStats', r({ feature: 'agentStats' }), true],
  ['actOverview', r({ feature: 'actOverview', act: 'e11a5' }), true],
  ['synergy', r({ feature: 'synergy' }), true],
  ['improvementIndex', r({ feature: 'improvementIndex' }), false],
];

describe('full-tracked-aggregate-v1 scalability (realistic topology)', () => {
  const bytes = new Map<string, number[]>();
  it.each(sizes)('%i matches: constant statements, no chunks, full population, compact responses', async (count) => {
    const db = await benchDatabase();
    await seedBenchAccounts(db, { matches: count });
    const raw = await seedBenchMatches(db, { matches: count });
    await db.pg.exec('ANALYZE');
    const hydrationStarted = performance.now();
    const hydration = await hydrateAnalysisFacts(db, { batchSize: 250 });
    const hydrationMs = Math.round(performance.now() - hydrationStarted);
    expect(hydration.refreshedMatches + hydration.withheldMatches).toBe(count);
    const server = new ServerAnalysisService(db, new DatasetProjectionService(new PostgresDatasetReadRepository(db)));
    const line: Record<string, unknown> = { count, raw, hydrationMs, facts: hydration.facts };
    for (const [name, request, unbounded] of features) {
      const { payload, metrics } = await server.analyze(request);
      expect(payload.coverage).toMatchObject({ populationComplete: true, populationLimit: null, serverHistoryUsed: true, transportSnapshotUsed: false });
      // Constant: 5 phase-1/context statements + 1 fact read, at every population size.
      expect(metrics).toMatchObject({ sqlQueryCount: 6, phase2Chunks: 0, fallbackMatches: 0 });
      if (unbounded) {
        expect(metrics.shippedMatches).toBe(0);
        expect(payload.coverage.populationMatches).toBe(metrics.selectedMatches);
        bytes.set(name, [...(bytes.get(name) ?? []), metrics.serializedBytes]);
      }
      line[name] = { totalMs: metrics.totalMs, phase1Ms: metrics.phase1Ms, resolveMs: metrics.resolveMs, factMs: metrics.factMs, phase2Ms: metrics.phase2Ms,
        projectionMs: metrics.projectionMs, aggregateMs: metrics.aggregateMs, queries: metrics.sqlQueryCount, selected: metrics.selectedMatches, bytes: metrics.serializedBytes };
    }
    process.stdout.write(`FULL_TRACKED_LATENCY ${JSON.stringify(line)}\n`);
    // Response size depends on members x maps x agents x pairs, never on the number of matches.
    for (const values of bytes.values()) expect(Math.max(...values)).toBeLessThan(Math.min(...values) * 1.25);
    await db.close();
  }, 3_600_000);
});
