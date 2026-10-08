import { hydrateAnalysisFacts } from '../server/dataset/analysisFactHydration.js';
import { createDatabase } from '../server/db/runtime.js';

/**
 * TASK-DATA-03B.2D: deterministic analysis-match-facts-v1 hydration in the normal Vercel Production build,
 * right after `db:migrate:vercel` (same DATABASE_URL, never printed). It only derives facts from durable
 * evidence already in the database: no provider call, no evidence change. Aggregate counts only.
 * A failure never blocks the deploy: the analysis read path reconstructs any match without a fresh fact
 * from raw evidence (exact, slower), so correctness never depends on this step.
 */
if (process.env.VERCEL_ENV !== 'production') {
  process.stdout.write('Skipping analysis fact hydration outside Vercel Production.\n');
} else {
  const database = createDatabase();
  if (!database) throw new Error('DATABASE_URL is required for Vercel Production fact hydration.');
  const started = Date.now();
  try {
    const summary = await hydrateAnalysisFacts(database);
    process.stdout.write(`${JSON.stringify({ event: 'analysis_fact_hydration', ...summary, durationMs: Date.now() - started })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ event: 'analysis_fact_hydration_failed', errorKind: error instanceof Error ? error.name : 'unknown', durationMs: Date.now() - started })}\n`);
  } finally {
    await database.close();
  }
}
