import type {
  AccountResponse,
  ConnectionRequest,
  ErrorResponse,
  ImportResponse,
  ImportSize,
  ProviderAuditResponse,
  ProviderPublicErrorCode,
  ProviderStatusResponse,
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

  importMatches(input: ConnectionRequest, limit: ImportSize): Promise<ImportResponse> {
    return requestJson('/api/valorant/matches/import', post({ ...input, limit }));
  }

  auditEvidence(input: ConnectionRequest): Promise<ProviderAuditResponse> {
    return requestJson('/api/valorant/provider/audit', post({ ...input, limit: 3 }));
  }
}

export const valorantBackendClient = new ValorantBackendClient();
