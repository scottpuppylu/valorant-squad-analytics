import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildAnalytics } from '../data/analytics';
import { demoDataSource } from '../dataSources/demo/DemoDataSource';
import { removeBrowserRealDataset } from '../dataSources/real/BrowserRealDatasetRepository';
import { serverDatasetApiClient, type DatasetApiClient } from '../dataSources/server/DatasetApiClient';
import type { DatasetReadyResponse } from '../dataSources/server/contracts';
import type { NormalizedAnalyticsDataset } from '../dataSources/types';
import type { DatasetContextValue, DatasetRuntimeSource, DatasetRuntimeStatus } from './DatasetContext';
import { DatasetContext } from './DatasetContext';
import { validSynergyContract } from '../dataSources/server/synergyContract';

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
  return { players: [], matches: [], sourceId: 'durable-neon-v2', isDemo: false, mode: 'REAL' };
}

function githubPagesRuntime(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isAdvancedMetrics(value: unknown): boolean {
  if (!isRecord(value) || value.ruleVersion !== 'event-metrics-v1' || !isRecord(value.coverage) || !isRecord(value.evidence)) return false;
  if (!isFiniteOptionalNumber(value.coverage.eligibleRounds)
    || !isFiniteOptionalNumber(value.coverage.reconstructedRounds)
    || !isFiniteOptionalNumber(value.coverage.omittedRounds)) return false;
  const validStatuses = new Set(['reconstructed', 'derived', 'partial', 'unavailable']);
  const statuses = value.evidence;
  return ['trade', 'clutch', 'objectives', 'abilityCasts', 'economy', 'impactContext', 'roleValueInputs']
    .every((key) => typeof statuses[key] === 'string' && validStatuses.has(statuses[key]));
}

function isDatasetResponse(value: unknown): value is DatasetReadyResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DatasetReadyResponse>;
  return candidate.ok === true
    && candidate.schemaVersion === 3
    && (candidate.state === 'ready' || candidate.state === 'empty')
    && typeof candidate.snapshot?.version === 'string'
    && candidate.snapshot.projectionVersion === 'synergy-ready-projection-v1'
    && candidate.snapshot.generation === 'dataset-read-v3'
    && candidate.dataset?.mode === 'REAL'
    && candidate.dataset.isDemo === false
    && Array.isArray(candidate.dataset.players)
    && Array.isArray(candidate.dataset.matches)
    && candidate.dataset.matches.every((match) => isRecord(match)
      && Array.isArray(match.performances)
      && match.performances.every((performance) => isRecord(performance)
        && (performance.advancedMetrics === undefined || isAdvancedMetrics(performance.advancedMetrics)))
      && validSynergyContract(match, new Set(candidate.dataset!.players.map((p) => p.id))));
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
