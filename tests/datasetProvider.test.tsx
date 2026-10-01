// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatasetProvider } from '../src/contexts/DatasetProvider';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import { realDatasetStorageKey } from '../src/dataSources/real/BrowserRealDatasetRepository';
import type { DatasetApiClient } from '../src/dataSources/server/DatasetApiClient';
import type { DatasetReadyResponse, DatasetResponse } from '../src/dataSources/server/contracts';
import { useDataset } from '../src/hooks/useDataset';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function realResponse(state: 'ready' | 'empty' = 'ready'): DatasetReadyResponse {
  const demo = demoDataSource.snapshot();
  const dataset = state === 'empty'
    ? { players: [], matches: [], sourceId: 'durable-neon-v1', isDemo: false as const, mode: 'REAL' as const }
    : { players: demo.players.slice(0, 1), matches: demo.matches.slice(0, 1), sourceId: 'durable-neon-v1', isDemo: false as const, mode: 'REAL' as const };
  return {
    ok: true,
    schemaVersion: 1,
    state,
    snapshot: { version: `snapshot-${state}`, generation: 'dataset-read-v1', source: 'durable-neon', projectionVersion: 'legacy-browser-projection-v1' },
    coverage: { completeForProviderWindow: false, boundedMatchLimit: 300, lifetimeComplete: false },
    evidence: { acs: 'derived', adr: 'derived', headshotPercentage: 'derived', kast: 'reconstructed', firstKills: 'reconstructed', firstDeaths: 'reconstructed' },
    dataset,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function Probe({ onState }: { onState?: (value: ReturnType<typeof useDataset>) => void }) {
  const runtime = useDataset();
  useEffect(() => onState?.(runtime), [onState, runtime]);
  return <div>
    <output data-testid="runtime">{runtime.status}|{runtime.source}|{runtime.dataset.matches.length}|{runtime.message ?? ''}</output>
    <button type="button" onClick={() => void runtime.refresh()}>refresh</button>
  </div>;
}

describe('DatasetProvider runtime states', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('transitions from loading to REAL ready', async () => {
    const pending = deferred<DatasetResponse>();
    const client: DatasetApiClient = { load: () => pending.promise };
    await act(async () => { root.render(<DatasetProvider client={client} forceDemo={false}><Probe /></DatasetProvider>); });
    expect(container.textContent).toContain('loading|DEMO');
    await act(async () => { pending.resolve(realResponse()); await pending.promise; });
    expect(container.textContent).toContain('ready|REAL_SERVER|1');
  });

  it('represents a successful empty REAL dataset without Demo fallback', async () => {
    const client: DatasetApiClient = { load: async () => realResponse('empty') };
    await act(async () => { root.render(<DatasetProvider client={client} forceDemo={false}><Probe /></DatasetProvider>); });
    expect(container.textContent).toContain('empty|REAL_SERVER|0');
  });

  it('uses deliberate Demo for Pages and for a disabled server gate', async () => {
    const shouldNotLoad: DatasetApiClient = { load: async () => { throw new Error('must not fetch'); } };
    await act(async () => { root.render(<DatasetProvider client={shouldNotLoad} forceDemo><Probe /></DatasetProvider>); });
    expect(container.textContent).toContain('demo|DEMO|32');
    await act(async () => root.unmount());
    root = createRoot(container);
    const disabled: DatasetApiClient = { load: async () => ({ ok: true, schemaVersion: 1, state: 'disabled', source: 'REAL_SERVER' }) };
    await act(async () => { root.render(<DatasetProvider client={disabled} forceDemo={false}><Probe /></DatasetProvider>); });
    expect(container.textContent).toContain('demo|DEMO|32');
    expect(container.textContent).toContain('刻意關閉');
  });

  it('keeps the last successful REAL dataset stale when refresh fails', async () => {
    const refresh = deferred<DatasetResponse>();
    let calls = 0;
    const client: DatasetApiClient = { load: () => (++calls === 1 ? Promise.resolve(realResponse()) : refresh.promise) };
    await act(async () => { root.render(<DatasetProvider client={client} forceDemo={false}><Probe /></DatasetProvider>); });
    expect(container.textContent).toContain('ready|REAL_SERVER|1');
    await act(async () => { container.querySelector('button')!.click(); });
    expect(container.textContent).toContain('stale|REAL_SERVER|1');
    await act(async () => { refresh.reject(new Error('offline')); try { await refresh.promise; } catch { /* expected */ } });
    expect(container.textContent).toContain('stale|REAL_SERVER|1');
    expect(container.textContent).toContain('保留上一次');
  });

  it('reports initial errors and malformed or version-mismatched responses without Demo fallback', async () => {
    const failing: DatasetApiClient = { load: async () => { throw new Error('offline'); } };
    await act(async () => { root.render(<DatasetProvider client={failing} forceDemo={false}><Probe /></DatasetProvider>); });
    expect(container.textContent).toContain('error|REAL_SERVER|0');
    await act(async () => root.unmount());
    root = createRoot(container);
    const malformed: DatasetApiClient = { load: async () => ({ ...realResponse(), schemaVersion: 2 }) as unknown as DatasetResponse };
    await act(async () => { root.render(<DatasetProvider client={malformed} forceDemo={false}><Probe /></DatasetProvider>); });
    expect(container.textContent).toContain('error|REAL_SERVER|0');
  });

  it('deletes the retired browser REAL envelope on startup', async () => {
    localStorage.setItem(realDatasetStorageKey, '{"legacy":true}');
    const client: DatasetApiClient = { load: async () => ({ ok: true, schemaVersion: 1, state: 'disabled', source: 'REAL_SERVER' }) };
    await act(async () => { root.render(<DatasetProvider client={client} forceDemo={false}><Probe /></DatasetProvider>); });
    expect(localStorage.getItem(realDatasetStorageKey)).toBeNull();
  });
});
