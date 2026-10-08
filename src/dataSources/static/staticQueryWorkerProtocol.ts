import type { AnalysisQuery } from '../server/analysisResult';
import type { StaticWeaponQuery } from './contract';
import { StaticQueryEngine } from './StaticQueryEngine';

/**
 * TASK-INFRA-STATIC-QUERY-PARITY-01 Web Worker protocol: heavy shared-core queries (e.g. all-history Synergy
 * at 10 000 matches) run off the main thread so the UI never freezes. The worker holds the engine of the
 * LATEST pinned snapshot only (an older snapshot's facts are released when a new one is requested).
 */
export type FactsRequest = { kind: 'analysis'; query: AnalysisQuery } | { kind: 'weapons'; query: StaticWeaponQuery };
export type WorkerRequest = { id: number; base: string; metaPath: string } & FactsRequest;
export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; message: string };

export function createStaticQueryHandler(fetchJson: (url: string) => Promise<unknown>) {
  let current: { key: string; engine: StaticQueryEngine } | undefined;
  return async (request: WorkerRequest): Promise<WorkerResponse> => {
    const key = `${request.base}\n${request.metaPath}`;
    if (current?.key !== key) current = { key, engine: new StaticQueryEngine((path) => fetchJson(`${request.base}${path}`), request.metaPath) };
    try {
      const value = request.kind === 'analysis' ? await current.engine.analysis(request.query) : await current.engine.weapons(request.query);
      return { id: request.id, ok: true, value };
    } catch (error) {
      return { id: request.id, ok: false, message: error instanceof Error ? error.message : 'Static query failed.' };
    }
  };
}
