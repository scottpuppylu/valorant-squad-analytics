import type { NormalizedAnalyticsDataset } from '../types';

export type ProviderPublicErrorCode =
  | 'BAD_REQUEST'
  | 'CONSENT_REQUIRED'
  | 'METHOD_NOT_ALLOWED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'ACCOUNT_NOT_FOUND'
  | 'NO_MATCHES'
  | 'RATE_LIMITED'
  | 'IMPORT_IN_PROGRESS'
  | 'LOCK_BUSY'
  | 'CONSENT_REVOKED'
  | 'SYNC_NOT_FOUND'
  | 'SYNC_BACKOFF'
  | 'DATABASE_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'MALFORMED_PROVIDER_RESPONSE';

export type Affinity = 'ap' | 'eu' | 'na' | 'kr' | 'latam' | 'br';
export type ImportSize = 1 | 10 | 20 | 30;

export interface ConnectionRequest {
  gameName: string;
  tag: string;
  affinity: Affinity;
  consent: boolean;
}

export interface PublicAccount {
  playerId?: string;
  gameName: string;
  tag: string;
  affinity: Affinity;
  accountLevel?: number;
}

export interface ProviderStatusResponse {
  ok: true;
  provider: { usable: boolean; mode: 'configured' | 'unconfigured' };
}

export interface AccountResponse {
  ok: true;
  account: PublicAccount;
}

export interface ImportResponse {
  ok: true;
  dataset: NormalizedAnalyticsDataset;
  importedMatches: number;
  importedAt: string;
}

export type SyncKind = 'backfill' | 'incremental';
export type SyncStatus = 'pending' | 'running' | 'paused' | 'complete' | 'failed' | 'cancelled';

export interface PublicSyncProgress {
  runId: string;
  kind: SyncKind;
  status: SyncStatus;
  progress: {
    pages: number;
    matchesSeen: number;
    matchesPersisted: number;
    overlapsUpdated: number;
    retries: number;
  };
  coverage: {
    from?: string;
    to?: string;
    lastSyncedAt?: string;
    completeForProviderWindow: boolean;
    incompleteReason?: string;
  };
  terminationReason?: string;
  lastErrorCategory?: string;
  nextAttemptAt?: string;
  performance: {
    providerFetchMs: number;
    normalizationMs: number;
    databaseMs: number;
    totalMs: number;
    sqlQueryCount: number;
    providerRequests: number;
  };
}

export interface SyncResponse {
  ok: true;
  sync: PublicSyncProgress;
}

export interface ErrorResponse {
  ok: false;
  error: { code: ProviderPublicErrorCode; message: string };
}
