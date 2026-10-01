import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildAnalytics } from '../data/analytics';
import { demoDataSource } from '../dataSources/demo/DemoDataSource';
import { removeBrowserRealDataset } from '../dataSources/real/BrowserRealDatasetRepository';
import { serverDatasetApiClient, type DatasetApiClient } from '../dataSources/server/DatasetApiClient';
import type { DatasetReadyResponse } from '../dataSources/server/contracts';
import type { NormalizedAnalyticsDataset } from '../dataSources/types';
import type { DatasetContextValue, DatasetRuntimeSource, DatasetRuntimeStatus } from './DatasetContext';
import { DatasetContext } from './DatasetContext';

interface RuntimeState {
  status: DatasetRuntimeStatus;
  source: DatasetRuntimeSource;
  dataset: NormalizedAnalyticsDataset;
  response?: DatasetReadyResponse;
  message?: string;
}

interface DatasetProviderProps {
  children: ReactNode;
  client?: DatasetApiClient;
  forceDemo?: boolean;
}

function emptyRealDataset(): NormalizedAnalyticsDataset {
  return { players: [], matches: [], sourceId: 'durable-neon-v1', isDemo: false, mode: 'REAL' };
}

function githubPagesRuntime(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io');
}

function isDatasetResponse(value: unknown): value is DatasetReadyResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DatasetReadyResponse>;
  return candidate.ok === true
    && candidate.schemaVersion === 1
    && (candidate.state === 'ready' || candidate.state === 'empty')
    && typeof candidate.snapshot?.version === 'string'
    && candidate.snapshot.projectionVersion === 'legacy-browser-projection-v1'
    && candidate.dataset?.mode === 'REAL'
    && candidate.dataset.isDemo === false
    && Array.isArray(candidate.dataset.players)
    && Array.isArray(candidate.dataset.matches);
}

export function DatasetProvider({ children, client = serverDatasetApiClient, forceDemo }: DatasetProviderProps) {
  const demo = useMemo(() => demoDataSource.snapshot(), []);
  const [state, setState] = useState<RuntimeState>({ status: 'loading', source: 'DEMO', dataset: demo });
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const load = useCallback(async (refreshing: boolean) => {
    const previous = stateRef.current;
    if (refreshing && previous.status === 'ready') setState({ ...previous, status: 'stale', message: '正在更新持久化資料…' });
    else if (!refreshing) setState({ status: 'loading', source: 'DEMO', dataset: demo });
    if (forceDemo === true || (forceDemo === undefined && githubPagesRuntime())) {
      setState({ status: 'demo', source: 'DEMO', dataset: demo, message: '此部署固定使用虛構示範資料。' });
      return;
    }
    try {
      const response = await client.load();
      if (response.state === 'disabled') {
        setState({ status: 'demo', source: 'DEMO', dataset: demo, message: '伺服器真實資料讀取目前刻意關閉；顯示虛構示範資料。' });
        return;
      }
      if (!isDatasetResponse(response)) throw new Error('Unsupported dataset response.');
      setState({ status: response.state === 'empty' ? 'empty' : 'ready', source: 'REAL_SERVER', dataset: response.dataset, response });
    } catch {
      if (refreshing && previous.source === 'REAL_SERVER' && previous.dataset.matches.length > 0) {
        setState({ ...previous, status: 'stale', message: '更新失敗；目前保留上一次成功讀取的資料。' });
      } else {
        setState({ status: 'error', source: 'REAL_SERVER', dataset: emptyRealDataset(), message: '持久化資料暫時無法讀取，未切換成 Demo。' });
      }
    }
  }, [client, demo, forceDemo]);

  useEffect(() => {
    removeBrowserRealDataset();
    void load(false);
  }, [load]);

  const analytics = useMemo(() => buildAnalytics(state.dataset), [state.dataset]);
  const value = useMemo<DatasetContextValue>(() => ({
    status: state.status,
    source: state.source,
    dataset: state.dataset,
    analytics,
    snapshot: state.response?.snapshot,
    coverage: state.response?.coverage,
    evidence: state.response?.evidence,
    message: state.message,
    refresh: () => load(true),
  }), [analytics, load, state]);

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}
