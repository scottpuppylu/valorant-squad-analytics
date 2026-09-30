export type SyncKind = 'backfill' | 'incremental';
export type SyncStatus = 'pending' | 'running' | 'paused' | 'complete' | 'failed' | 'cancelled';
export type SyncErrorCategory =
  | 'RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_5XX'
  | 'MALFORMED_RESPONSE'
  | 'DATABASE_ERROR'
  | 'CONSENT_REVOKED'
  | 'LOCK_BUSY'
  | 'UNKNOWN';
export type SyncTerminationReason =
  | 'empty_page'
  | 'short_page'
  | 'known_boundary'
  | 'repeated_page'
  | 'no_older_unique_matches'
  | 'configured_horizon';

export interface SyncSubject {
  playerId: string;
  publicPlayerId: string;
  squadId: string;
  gameName: string;
  tag: string;
  affinity: string;
}

export interface SyncCursorRecord {
  id: string;
  playerId: string;
  kind: SyncKind;
  nextStart: number;
  coverageFrom?: string;
  coverageTo?: string;
  lastBoundaryHmac?: string;
  lastPageFingerprintHmac?: string;
  lastSuccessfulPage?: number;
  retryCount: number;
  nextAttemptAt?: string;
  completeForProviderWindow: boolean;
  incompleteReason?: string;
}

export interface SyncRunRecord {
  id: string;
  publicId: string;
  subject: SyncSubject;
  kind: SyncKind;
  status: SyncStatus;
  cursorStart: number;
  nextAttemptAt?: string;
}

export interface SyncChunkMetrics {
  providerFetchMs: number;
  normalizationMs: number;
  databaseMs: number;
  totalMs: number;
  sqlQueryCount: number;
  returnedMatches: number;
  persistedMatches: number;
  overlapMatches: number;
}

export interface PublicSyncStatus {
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
  terminationReason?: SyncTerminationReason;
  lastErrorCategory?: SyncErrorCategory;
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
