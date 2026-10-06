import type { SqlDatabase } from '../db/types.js';
import { EventMetricEngine } from '../metrics/eventMetricEngine.js';
import { freshFactPredicate, refreshAnalysisFacts } from './analysisFacts.js';

export interface FactHydrationSummary { scannedMatches: number; refreshedMatches: number; facts: number; withheldMatches: number; batches: number }

/**
 * TASK-DATA-03B.2D deterministic analysis-fact hydration (deploy-time, normal Vercel build path).
 * One keyset pass over source matches that have a LINKED participant without a fresh fact; each batch is
 * recomputed from raw durable evidence with the shared reconstruction and written in its own short
 * transaction. Idempotent: a second run finds nothing to do (matches whose facts are intentionally
 * withheld are visited once per run and skipped by the keyset). It never calls a provider.
 */
export async function hydrateAnalysisFacts(database: SqlDatabase, options: { batchSize?: number } = {}): Promise<FactHydrationSummary> {
  const batchSize = options.batchSize ?? 100;
  const engine = new EventMetricEngine();
  const summary: FactHydrationSummary = { scannedMatches: 0, refreshedMatches: 0, facts: 0, withheldMatches: 0, batches: 0 };
  let after: string | null = null;
  for (;;) {
    const pending: { id: string }[] = (await database.query<{ id: string }>(
      `SELECT sm.id FROM source_matches sm
       WHERE ($1::uuid IS NULL OR sm.id > $1::uuid)
         AND EXISTS (
           SELECT 1 FROM match_participants mp
           LEFT JOIN analysis_participant_facts f ON f.match_participant_id=mp.id AND ${freshFactPredicate('f', 'sm')}
           WHERE mp.source_match_id=sm.id AND mp.player_id IS NOT NULL AND f.match_participant_id IS NULL)
       ORDER BY sm.id LIMIT $2`,
      [after, batchSize],
    )).rows;
    if (pending.length === 0) break;
    const ids = pending.map((row) => row.id);
    const refreshed = await database.transaction((transaction) => refreshAnalysisFacts(transaction, ids, engine));
    summary.scannedMatches += ids.length;
    summary.refreshedMatches += refreshed.matches - refreshed.withheldMatches;
    summary.facts += refreshed.facts;
    summary.withheldMatches += refreshed.withheldMatches;
    summary.batches += 1;
    after = ids.at(-1)!;
  }
  return summary;
}
