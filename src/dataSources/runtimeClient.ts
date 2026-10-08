import { serverDatasetApiClient, type DatasetApiClient } from './server/DatasetApiClient';
import { StaticSnapshotClient } from './static/StaticSnapshotClient';

/**
 * Build-time data delivery (TASK-INFRA-STATIC-DATA-PUBLISH-01). Public, non-secret configuration only:
 * - `VITE_DATA_MODE=static`: read a published static snapshot from `VITE_STATIC_DATA_BASE`
 *   (default `<app base>public-data/`); works on GitHub Pages and any static host, with no API.
 * - anything else: the existing same-origin `/api` client (Vercel / Node API), or Demo on `*.github.io`.
 */
export interface DataDeliveryConfig { mode: 'api' | 'static'; staticBase?: string }

export function dataDeliveryConfig(env: Record<string, string | boolean | undefined> = import.meta.env): DataDeliveryConfig {
  if (env.VITE_DATA_MODE !== 'static') return { mode: 'api' };
  const configured = typeof env.VITE_STATIC_DATA_BASE === 'string' && env.VITE_STATIC_DATA_BASE.length > 0 ? env.VITE_STATIC_DATA_BASE : undefined;
  const appBase = typeof env.BASE_URL === 'string' ? env.BASE_URL : '/';
  return { mode: 'static', staticBase: configured ?? `${appBase}public-data/` };
}

export function createDatasetClient(config: DataDeliveryConfig = dataDeliveryConfig()): DatasetApiClient {
  if (config.mode !== 'static') return serverDatasetApiClient;
  const base = typeof window === 'undefined' ? config.staticBase! : new URL(config.staticBase!, window.location.href).toString();
  // Heavy facts queries run in a module Web Worker when the browser has one (never blocks the UI).
  const workerFactory = typeof Worker === 'undefined' ? undefined
    : () => new Worker(new URL('./static/staticQueryWorker.ts', import.meta.url), { type: 'module' });
  return new StaticSnapshotClient({ baseUrl: base, ...(workerFactory ? { workerFactory } : {}) });
}
