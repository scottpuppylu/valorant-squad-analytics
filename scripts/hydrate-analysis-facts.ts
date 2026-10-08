import { hydrateAnalysisFacts } from '../server/dataset/analysisFactHydration.js';
import { createDatabase } from '../server/db/runtime.js';

/**
 * TASK-INFRA-DATABASE-PORTABILITY-01: provider-neutral analysis-match-facts-v1 hydration for any PostgreSQL
 * (VPS deploys run it right after `db:migrate`). Deterministic and idempotent; derives facts from durable
 * evidence only (no provider call, no evidence change). Aggregate counts only. Exit code 1 on failure.
 */
const database = createDatabase();
if (!database) throw new Error('DATABASE_URL is required for analysis fact hydration.');
const started = Date.now();
try {
  const summary = await hydrateAnalysisFacts(database);
  process.stdout.write(`${JSON.stringify({ event: 'analysis_fact_hydration', ...summary, durationMs: Date.now() - started })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ event: 'analysis_fact_hydration_failed', errorKind: error instanceof Error ? error.name : 'unknown', durationMs: Date.now() - started })}\n`);
  process.exitCode = 1;
} finally {
  await database.close();
}
