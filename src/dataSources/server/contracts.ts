import type { NormalizedAnalyticsDataset } from '../types';
import type { PUBLIC_DATASET_PRIVACY_VERSION } from '../../../shared/privacyPolicy';

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
  | 'MANAGEMENT_CREDENTIAL_REQUIRED'
  | 'REVOCATION_FORBIDDEN'
  | 'DELETION_NOT_FOUND'
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
  privacyVersion: typeof PUBLIC_DATASET_PRIVACY_VERSION;
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
  managementCredential?: string;
}

export interface ImportResponse {
  ok: true;
  dataset: NormalizedAnalyticsDataset;
  importedMatches: number;
  importedAt: string;
}

export type DeletionStatus = 'pending' | 'running' | 'paused' | 'complete' | 'failed';
export type DeletionStage =
  | 'cancel_sync'
  | 'remove_rank_observations'
  | 'process_matches'
  | 'remove_provider_identity'
  | 'remove_membership'
  | 'clear_sync_metadata'
  | 'purge_player_profile_identity'
  | 'finalize_job';

export interface PublicDeletionProgress {
  jobId: string;
  status: DeletionStatus;
  stage: DeletionStage;
  requestedAt: string;
  completedAt?: string;
  progress: {
    rankRowsRemoved: number;
    exclusiveMatchesRemoved: number;
    sharedMatchesAnonymized: number;
    participantsAnonymized: number;
    providerIdentitiesRemoved: number;
    membershipsRemoved: number;
    syncCursorsRemoved: number;
    syncRunsAnonymized: number;
    attempts: number;
  };
}

export interface RevocationResponse { ok: true; deletion: PublicDeletionProgress }
export interface DeletionResponse { ok: true; deletion: PublicDeletionProgress }

export type SyncKind = 'backfill' | 'incremental' | 'deep_backfill';
export type SyncStatus = 'pending' | 'running' | 'paused' | 'complete' | 'failed' | 'cancelled';

export interface PublicSyncProgress {
  history?: {
    ruleVersion: 'deep-history-v1';
    historyPhase: 'live_v4' | 'stored_index' | 'complete';
    storedPage: number;
    storedItemIndex: number;
    storedTotal?: number;
    liveHistoryExhausted: boolean;
    storedHistoryExhausted: boolean;
    sourceExhausted: boolean;
    lifetimeComplete: false;
  };
  runId: string;
  kind: SyncKind;
  status: SyncStatus;
  progress: {
    pages: number;
    matchesSeen: number;
    matchesPersisted: number;
    overlapsUpdated: number;
    retries: number;
    storedMatchesSeen?: number;
    detailRequests?: number;
    detailUnavailableCount?: number;
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

/** TASK-DATA-FASTSYNC-01 recent-refresh-v1 outcome (server-authoritative; no identifiers). */
export interface RecentRefreshOutcome {
  policyVersion: 'recent-refresh-v1';
  status: 'refreshed' | 'fresh' | 'busy' | 'backoff' | 'unavailable';
  providerRequested: boolean;
  lastSuccessAt?: string;
  nextEligibleAt?: string;
  newMatches?: number;
  morePending?: boolean;
  errorCategory?: string;
}

export interface RecentRefreshResponse {
  ok: true;
  refresh: RecentRefreshOutcome;
  sync?: PublicSyncProgress;
}

export interface ErrorResponse {
  ok: false;
  error: { code: ProviderPublicErrorCode; message: string };
}

export interface DatasetSnapshotContract {
  version: string;
  generation: 'dataset-read-v4';
  source: 'durable-neon';
  projectionVersion: 'evidence-decoupled-projection-v1';
  /** TASK-IDENTITY-01/01B: public players are members (community name + optional nickname) with sanitized accounts. */
  identityVersion: 'member-identity-v2';
}

export interface DatasetCoverageContract {
  from?: string;
  to?: string;
  lastSyncedAt?: string;
  completeForProviderWindow: boolean;
  /** Transport snapshot size only; never total tracked history, analysis completeness or maximum browsable history. */
  boundedMatchLimit: number;
  lifetimeComplete: false;
}

export interface DatasetEvidenceContract {
  acs: 'derived';
  adr: 'derived';
  headshotPercentage: 'derived' | 'partial';
  kast: 'reconstructed' | 'partial';
  firstKills: 'reconstructed' | 'partial';
  firstDeaths: 'reconstructed' | 'partial';
}

export interface DatasetReadyResponse {
  ok: true;
  schemaVersion: 6;
  state: 'ready' | 'empty';
  snapshot: DatasetSnapshotContract;
  coverage: DatasetCoverageContract;
  evidence: DatasetEvidenceContract;
  dataset: NormalizedAnalyticsDataset;
}

export interface DatasetDisabledResponse {
  ok: true;
  schemaVersion: 6;
  state: 'disabled';
  source: 'REAL_SERVER';
}

export type DatasetResponse = DatasetReadyResponse | DatasetDisabledResponse;

/** TASK-DATA-03B.1 `GET /api/valorant/dataset?view=history` bounded keyset page. */
export interface DatasetHistoryPageContract {
  limit: number;
  traversedMatchCount: number;
  withheldMatchCount: number;
  from?: string;
  to?: string;
  hasMore: boolean;
  nextCursor: string | null;
}

/** Eligible durable matches tracked in Neon; never a Riot lifetime total. */
export interface DatasetTrackedHistoryContract {
  trackedMatchCount: number;
  earliestTrackedAt?: string;
  latestTrackedAt?: string;
  lastSyncedAt?: string;
  lifetimeComplete: false;
}

export interface DatasetHistoryResponse {
  ok: true;
  schemaVersion: 6;
  view: 'history';
  historyVersion: 'dataset-history-v1';
  projectionVersion: 'evidence-decoupled-projection-v1';
  identityVersion: 'member-identity-v2';
  state: 'ready' | 'empty';
  page: DatasetHistoryPageContract;
  tracked: DatasetTrackedHistoryContract;
  evidence: DatasetEvidenceContract;
  dataset: NormalizedAnalyticsDataset;
}

export interface DatasetHistoryQuery {
  cursor?: string;
  before?: string;
  limit?: number;
}

type ScopeEvidenceStatus = 'available' | 'partial' | 'unavailable';

/** TASK-DATA-03B.2A `GET /api/valorant/dataset?view=analytics` aggregate facts (no identities). */
export interface DatasetAnalyticsContextResponse {
  ok: true;
  schemaVersion: 6;
  view: 'analytics';
  analyticsVersion: 'analytics-context-v1';
  scopeRuleVersion: 'analysis-scope-v1';
  featurePolicyVersion: 'feature-scope-policy-v2';
  adaptiveWindowVersion: 'adaptive-window-v1';
  /** snapshotWindow is the TRANSPORT bootstrap size only (never an analytics/history boundary). */
  population: { trackedMatchCount: number; snapshotWindow: number; snapshotCoversTrackedHistory: boolean; lifetimeComplete: false };
  /** TASK-DATA-03B.2C all-tracked facets (filter options, team outcome); identifier-free. */
  facets?: {
    maps: { map: string; matches: number }[];
    agents: string[];
    gameModes: string[];
    teamOutcome: { matches: number; wins: number };
  };
  evidence: {
    season: { status: ScopeEvidenceStatus; matchesWithSeasonId: number; matchesWithSeasonShort: number; matchesWithAct: number; matchesWithoutAct: number;
      seasonIdWithoutPublicAct: number; unrecognizedSeasonCodes: number; currentActKnown: false; latestRecordedAct?: string;
      acts: { key: string; label: string; matches: number }[] };
    duration: { status: ScopeEvidenceStatus; matchesWithDuration: number; matchesWithoutDuration: number };
    queues: { gameMode: string; matches: number }[];
    rank: { status: ScopeEvidenceStatus; observations: number; reason: 'not_ingested' | 'not_tied_to_matches' };
  };
  policies: { feature: string; horizon: string; queues: 'all' | string[]; implementation: string }[];
}
