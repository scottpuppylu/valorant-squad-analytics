import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildAnalytics, type AnalyticsPopulationFacts } from '../data/analytics';
import { demoDataSource } from '../dataSources/demo/DemoDataSource';
import { removeBrowserRealDataset } from '../dataSources/real/BrowserRealDatasetRepository';
import { serverDatasetApiClient, type DatasetApiClient } from '../dataSources/server/DatasetApiClient';
import type { DatasetReadyResponse } from '../dataSources/server/contracts';
import type { NormalizedAnalyticsDataset } from '../dataSources/types';
import type { DatasetContextValue, DatasetRuntimeSource, DatasetRuntimeStatus } from './DatasetContext';
import { DatasetContext } from './DatasetContext';
import { isDatasetAnalyticsContextResponse, isDatasetResponse } from '../dataSources/server/datasetContract';
import { analysisQueryFor, type AnalysisQuery, type DatasetAnalysisResponse } from '../dataSources/server/analysisResult';
import type { DatasetDisabledResponse, RecentRefreshOutcome } from '../dataSources/server/contracts';
import { BackendApiError } from '../dataSources/server/ValorantBackendClient';
import { defaultAnalysisFilters } from '../analytics/filters';

/** The Dashboard and default Leaderboard share this request (same JSON key). */
const defaultCurrentStrengthQuery = analysisQueryFor({ ...defaultAnalysisFilters, period: 'current' }, 'lifetimeTotals', true)!;
import type { DatasetAnalyticsContextResponse } from '../dataSources/server/contracts';

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
  return { players: [], matches: [], sourceId: 'durable-neon-v4', isDemo: false, mode: 'REAL' };
}

function githubPagesRuntime(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io');
}


export function DatasetProvider({ children, client = serverDatasetApiClient, forceDemo }: DatasetProviderProps) {
  const demo = useMemo(() => demoDataSource.snapshot(), []);
  const [state, setState] = useState<RuntimeState>({ status: 'loading', source: 'DEMO', dataset: demo });
  const stateRef = useRef(state);
  // view=analytics facts, scoped to the snapshot version they were fetched for.
  const [context, setContext] = useState<{ version: string; response: DatasetAnalyticsContextResponse } | undefined>();

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // DATA-03B.2B per-tab, in-memory request cache. Cleared on every (re)load, so it never outlives the
  // snapshot it accompanies (same retention semantics as the snapshot; nothing is persisted).
  const analysisLoader = useMemo(() => {
    const loadAnalysis = client.loadAnalysis?.bind(client);
    if (!loadAnalysis) return undefined;
    const cache = new Map<string, Promise<DatasetAnalysisResponse | DatasetDisabledResponse>>();
    // Consumers handle their own abort; the shared request is never aborted by one unmount.
    const cached = (query: AnalysisQuery) => {
      const key = JSON.stringify(query);
      let pending = cache.get(key);
      if (!pending) {
        pending = loadAnalysis(query);
        cache.set(key, pending);
        pending.catch(() => cache.delete(key));
      }
      return pending;
    };
    return Object.assign(cached, { clear: () => cache.clear() });
  }, [client]);

  const load = useCallback(async (refreshing: boolean) => {
    const previous = stateRef.current;
    if (refreshing && previous.status === 'ready') setState({ ...previous, status: 'stale', message: '正在更新持久化資料…' });
    else if (!refreshing) setState({ status: 'loading', source: 'DEMO', dataset: demo });
    if (forceDemo === true || (forceDemo === undefined && githubPagesRuntime())) {
      setState({ status: 'demo', source: 'DEMO', dataset: demo, message: '此部署固定使用虛構示範資料。' });
      return;
    }
    try {
      analysisLoader?.clear();
      // Prefetch the default 目前實力 population in parallel with the bootstrap snapshot.
      if (analysisLoader) void analysisLoader(defaultCurrentStrengthQuery).catch(() => undefined);
      const response = await client.load();
      if (response.schemaVersion !== 6) throw new Error('Unsupported dataset schema.');
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
  }, [analysisLoader, client, demo, forceDemo]);

  useEffect(() => {
    removeBrowserRealDataset();
    void load(false);
  }, [load]);

  // TASK-DATA-FASTSYNC-01 per-tab, in-memory dedupe of the automatic attempt (UX only; the
  // server freshness gate is authoritative). Never persisted.
  const [automatic] = useState(() => new Map<string, Promise<RecentRefreshOutcome>>());
  const recentRefresh = useCallback(async (accountId: string, mode: 'auto' | 'manual'): Promise<RecentRefreshOutcome> => {
    const request = async (): Promise<RecentRefreshOutcome> => {
      try {
        if (!client.refreshRecent) throw new Error('Recent refresh is unavailable.');
        const { refresh } = await client.refreshRecent(accountId);
        // Only durable new matches justify a reload (snapshot + analysis cache). No optimistic data.
        if (refresh.status === 'refreshed' && (refresh.newMatches ?? 0) > 0) await load(true);
        return refresh;
      } catch (error) {
        const limited = error instanceof BackendApiError && error.code === 'RATE_LIMITED';
        return { policyVersion: 'recent-refresh-v1', status: limited ? 'backoff' : 'unavailable', providerRequested: false };
      }
    };
    if (mode === 'manual') return request();
    let pending = automatic.get(accountId);
    if (!pending) {
      pending = request();
      automatic.set(accountId, pending);
    }
    return pending;
  }, [automatic, client, load]);
  const canRefreshRecent = typeof client.refreshRecent === 'function';

  const snapshotVersion = state.source === 'REAL_SERVER' ? state.response?.snapshot.version : undefined;
  useEffect(() => {
    if (!snapshotVersion || !client.loadAnalyticsContext) return undefined;
    const abort = new AbortController();
    client.loadAnalyticsContext(abort.signal).then((response) => {
      if (!abort.signal.aborted && isDatasetAnalyticsContextResponse(response)) setContext({ version: snapshotVersion, response });
    }).catch(() => undefined);
    return () => abort.abort();
  }, [client, snapshotVersion]);
  const activeContext = context && context.version === snapshotVersion ? context.response : undefined;
  const facts = useMemo<AnalyticsPopulationFacts | undefined>(() => activeContext ? {
    snapshotCoversTrackedHistory: activeContext.population.snapshotCoversTrackedHistory,
    seasonKeys: activeContext.evidence.season.acts.map((act) => act.key),
    seasonStatus: activeContext.evidence.season.status,
    rankStatus: activeContext.evidence.rank.status,
  } : undefined, [activeContext]);
  const analytics = useMemo(() => buildAnalytics(state.dataset, state.source === 'REAL_SERVER' ? facts : undefined), [facts, state.dataset, state.source]);
  const historyLoader = useMemo(() => client.loadHistory?.bind(client), [client]);
  const value = useMemo<DatasetContextValue>(() => ({
    status: state.status,
    source: state.source,
    dataset: state.dataset,
    analytics,
    snapshot: state.response?.snapshot,
    coverage: state.response?.coverage,
    evidence: state.response?.evidence,
    message: state.message,
    ...(state.source === 'REAL_SERVER' && historyLoader ? { loadHistory: historyLoader } : {}),
    ...(state.source === 'REAL_SERVER' && activeContext ? { analyticsContext: activeContext } : {}),
    ...(state.source === 'REAL_SERVER' && analysisLoader ? { loadAnalysis: analysisLoader } : {}),
    ...(state.source === 'REAL_SERVER' && canRefreshRecent ? { refreshRecent: recentRefresh } : {}),
    refresh: () => load(true),
  }), [activeContext, analysisLoader, analytics, historyLoader, canRefreshRecent, load, recentRefresh, state]);

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}
