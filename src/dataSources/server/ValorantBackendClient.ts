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
  RevocationResponse,
  DeletionResponse,
} from './contracts';

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

  resolveAccount(input: ConnectionRequest): Promise<AccountResponse> {
    return requestJson('/api/valorant/account/resolve', post(input));
  }

  importMatches(input: ConnectionRequest, playerId: string, limit: ImportSize): Promise<ImportResponse> {
    return requestJson('/api/valorant/matches/import', post({ ...input, playerId, limit }));
  }

  startSync(playerId: string, kind: SyncKind): Promise<SyncResponse> {
    return requestJson('/api/valorant/sync/start', post({ playerId, kind }));
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
