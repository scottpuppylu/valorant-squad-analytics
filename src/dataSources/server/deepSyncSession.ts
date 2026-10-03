import type { PublicSyncProgress } from './contracts';

export const DEEP_SYNC_STORAGE_KEY = 'goblin-survey:deep-sync:v1';
const publicUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function saveDeepSyncSession(playerId: string, runId: string): void {
  try { localStorage.setItem(DEEP_SYNC_STORAGE_KEY, JSON.stringify({ version: 1, playerId, runId })); } catch { /* Server progress is still durable. */ }
}
export function clearDeepSyncSession(): void {
  try { localStorage.removeItem(DEEP_SYNC_STORAGE_KEY); } catch { /* No persistence available. */ }
}
export function loadDeepSyncSession(): { playerId: string; runId: string } | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(DEEP_SYNC_STORAGE_KEY) ?? 'null');
    if (value?.version === 1 && typeof value.playerId === 'string' && typeof value.runId === 'string'
      && publicUuid.test(value.playerId) && publicUuid.test(value.runId)) return { playerId: value.playerId, runId: value.runId };
    clearDeepSyncSession();
  } catch { clearDeepSyncSession(); }
  return undefined;
}

/** Fixed spacing stays below the public continue route's ten requests/minute. */
export function deepContinuationDelay(progress: PublicSyncProgress, now = Date.now()): number | undefined {
  if (progress.kind !== 'deep_backfill' || progress.status !== 'paused'
    || progress.terminationReason === 'provider_repeated_page') return undefined;
  const next = progress.nextAttemptAt ? Date.parse(progress.nextAttemptAt) : now;
  if (!Number.isFinite(next)) return undefined;
  return Math.max(7_000, next - now);
}
