import type { SyncStatus } from './types.js';

/**
 * TASK-DATA-FASTSYNC-01 recent-refresh-v1: server-authoritative decision for an opportunistic
 * "refresh if stale" request. Pure and deterministic from durable state + the current time.
 * Clients never supply the cooldown; see docs/FAST_RECENT_SYNC.md.
 */
export const RECENT_REFRESH_POLICY_VERSION = 'recent-refresh-v1' as const;
/** A completed incremental sync is fresh for this long (age >= threshold is stale). */
export const AUTO_REFRESH_STALE_AFTER_MS = 30 * 60_000;

export interface RecentRefreshState {
  /** Active current-policy consent, active membership, not anonymized, no open deletion, Henrik identity. */
  eligible: boolean;
  cursor?: {
    /** Optimistic-concurrency token: the cursor's updated_at in microseconds. */
    version: string;
    lastSuccessAt?: string;
    lastErrorAt?: string;
    nextAttemptAt?: string;
    leaseExpiresAt?: string;
  };
  latestRun?: { publicId: string; status: SyncStatus };
}

export type RecentRefreshDecision =
  | { decision: 'INELIGIBLE' }
  | { decision: 'BUSY'; nextEligibleAt?: string }
  | { decision: 'BACKOFF'; nextEligibleAt: string }
  | { decision: 'FRESH'; lastSuccessAt: string; nextEligibleAt: string }
  /** No usable recent sync: start a new bounded incremental run (or resume a stale failed one). */
  | { decision: 'STALE'; action: 'new_run' | 'resume_failed'; runId?: string; expectedVersion: string | null }
  /** An existing paused/interrupted incremental run legitimately has more recent pages. */
  | { decision: 'CONTINUE_PENDING'; runId: string; expectedVersion: string | null };

const later = (at: string | undefined, now: number) => at !== undefined && Date.parse(at) > now;

export function decideRecentRefresh(state: RecentRefreshState, now: Date): RecentRefreshDecision {
  const at = now.getTime();
  if (!state.eligible) return { decision: 'INELIGIBLE' };
  const cursor = state.cursor;
  const expectedVersion = cursor?.version ?? null;
  if (later(cursor?.leaseExpiresAt, at)) return { decision: 'BUSY', nextEligibleAt: cursor!.leaseExpiresAt };
  // Existing provider backoff is authoritative for every kind of attempt.
  if (later(cursor?.nextAttemptAt, at)) return { decision: 'BACKOFF', nextEligibleAt: cursor!.nextAttemptAt! };
  const run = state.latestRun;
  if (run && (run.status === 'paused' || run.status === 'pending' || run.status === 'running')) {
    // 'running' here means its lease already expired (interrupted invocation).
    return { decision: 'CONTINUE_PENDING', runId: run.publicId, expectedVersion };
  }
  const failed = run?.status === 'failed';
  const activity = [cursor?.lastSuccessAt, failed ? cursor?.lastErrorAt : undefined]
    .filter((value): value is string => value !== undefined)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  const last = activity.length > 0 ? Math.max(...activity) : undefined;
  if (last !== undefined && at - last < AUTO_REFRESH_STALE_AFTER_MS) {
    const nextEligibleAt = new Date(last + AUTO_REFRESH_STALE_AFTER_MS).toISOString();
    // A recent non-retryable failure is a cooldown, never an immediate retry.
    if (failed) return { decision: 'BACKOFF', nextEligibleAt };
    return { decision: 'FRESH', lastSuccessAt: cursor!.lastSuccessAt!, nextEligibleAt };
  }
  if (failed) return { decision: 'STALE', action: 'resume_failed', runId: run!.publicId, expectedVersion };
  return { decision: 'STALE', action: 'new_run', expectedVersion };
}

export type RecentRefreshStatus = 'refreshed' | 'fresh' | 'busy' | 'backoff' | 'unavailable';

/** Browser-safe outcome. No player, provider, match, HMAC, database or lease identifiers. */
export interface RecentRefreshOutcome {
  policyVersion: typeof RECENT_REFRESH_POLICY_VERSION;
  status: RecentRefreshStatus;
  providerRequested: boolean;
  lastSuccessAt?: string;
  nextEligibleAt?: string;
  newMatches?: number;
  /** True when the bounded chunk left more recent pages for a later, separate action. */
  morePending?: boolean;
  errorCategory?: 'RATE_LIMITED' | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR' | 'MALFORMED_PROVIDER_RESPONSE' | 'DATABASE_ERROR';
}
