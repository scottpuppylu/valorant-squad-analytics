import type {
  AccountResponse,
  ConnectionRequest,
  ErrorResponse,
  ImportResponse,
  ImportSize,
  ProviderPublicErrorCode,
  ProviderStatusResponse,
  SyncKind,
  SyncResponse,
  RecentRefreshResponse,
  RevocationResponse,
  DeletionResponse,
  DatasetResponse,
  DatasetDisabledResponse,
  DatasetHistoryQuery,
  DatasetHistoryResponse,
  DatasetAnalyticsContextResponse,
} from './contracts';
import type { AnalysisQuery, DatasetAnalysisResponse } from './analysisResult';

export class BackendApiError extends Error {
  constructor(readonly code: ProviderPublicErrorCode, message: string) {
    super(message);
    this.name = 'BackendApiError';
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let payload: T | ErrorResponse;
  try {
    payload = await response.json() as T | ErrorResponse;
  } catch {
    if (response.status === 504) {
      throw new BackendApiError('PROVIDER_TIMEOUT', '戰績儲存逾時，資料未寫入，請稍後重試。');
    }
    throw new BackendApiError('PROVIDER_ERROR', '此部署目前沒有可用的資料服務。');
  }
  if (!response.ok || (typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === false)) {
    const failure = payload as ErrorResponse;
    throw new BackendApiError(failure.error?.code ?? 'PROVIDER_ERROR', failure.error?.message ?? '資料服務暫時無法使用。');
  }
  return payload as T;
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export class ValorantBackendClient {
  providerStatus(): Promise<ProviderStatusResponse> {
    return requestJson('/api/valorant/provider/status');
  }

  dataset(signal?: AbortSignal): Promise<DatasetResponse> {
    return requestJson('/api/valorant/dataset', { signal });
  }

  /** DATA-03B.2B server-resolved feature population over all durable history (feature + context only). */
  datasetAnalysis(query: AnalysisQuery, signal?: AbortSignal): Promise<DatasetAnalysisResponse | DatasetDisabledResponse> {
    const params = new URLSearchParams({ view: 'analysis', feature: query.feature });
    for (const key of ['act', 'from', 'to', 'map', 'agent', 'role', 'mode', 'player'] as const) {
      const value = query[key];
      if (value && value !== 'all') params.set(key, value);
    }
    if (query.recent) params.set('recent', String(query.recent));
    if (query.form) params.set('form', '1');
    return requestJson(`/api/valorant/dataset?${params.toString()}`, { signal });
  }

  /** DATA-03B.2A aggregate analytics facts (population coverage, Act/rank/duration availability). */
  datasetAnalyticsContext(signal?: AbortSignal): Promise<DatasetAnalyticsContextResponse | DatasetDisabledResponse> {
    return requestJson('/api/valorant/dataset?view=analytics', { signal });
  }

  /** DATA-03B.1 bounded history page; the cursor is an opaque position, never authorization. */
  datasetHistory(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse | DatasetDisabledResponse> {
    const params = new URLSearchParams({ view: 'history' });
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    else if (query.before) params.set('before', query.before);
    return requestJson(`/api/valorant/dataset?${params.toString()}`, { signal });
  }

  resolveAccount(input: ConnectionRequest): Promise<AccountResponse> {
    return requestJson('/api/valorant/account/resolve', post(input));
  }

  importMatches(input: ConnectionRequest, playerId: string, limit: ImportSize): Promise<ImportResponse> {
    return requestJson('/api/valorant/matches/import', post({ ...input, playerId, limit }));
  }

  startSync(playerId: string, kind: SyncKind): Promise<SyncResponse> {
    return requestJson('/api/valorant/sync/start', post({ playerId, kind }));
  }

  /**
   * TASK-DATA-FASTSYNC-01: the server alone decides whether the ACCOUNT is stale (no cooldown is sent).
   * TASK-IDENTITY-01: takes a public ACCOUNT id, never a member id.
   */
  refreshRecent(accountId: string): Promise<RecentRefreshResponse> {
    return requestJson('/api/valorant/sync/start', post({ accountId, kind: 'incremental', intent: 'refresh_if_stale' }));
  }

  continueSync(runId: string): Promise<SyncResponse> {
    return requestJson('/api/valorant/sync/continue', post({ runId }));
  }

  syncStatus(runId: string): Promise<SyncResponse> {
    return requestJson(`/api/valorant/sync/status?runId=${encodeURIComponent(runId)}`);
  }

  revokeConsent(playerId: string, managementCredential: string): Promise<RevocationResponse> {
    return requestJson('/api/valorant/consent/revoke', post({ playerId, managementCredential }));
  }

  continueDeletion(jobId: string, managementCredential: string): Promise<DeletionResponse> {
    return requestJson('/api/valorant/deletion/continue', post({ jobId, managementCredential }));
  }

  deletionStatus(jobId: string, managementCredential: string): Promise<DeletionResponse> {
    return requestJson('/api/valorant/deletion/status', post({ jobId, managementCredential }));
  }
}

export const valorantBackendClient = new ValorantBackendClient();
