import type { PublicSyncStatus } from './types.js';
import { PublicApiError } from '../errors.js';

export type ScheduledJob = 'recent' | 'history';
export interface ScheduledCandidate { publicPlayerId: string }
export interface ScheduledStore {
  duePlayers(job: ScheduledJob, at: string): Promise<ScheduledCandidate[]>;
  withScheduledLock<T>(work: () => Promise<T>): Promise<T | undefined>;
}
export interface ScheduledSyncRunner {
  start(id: string, kind: 'incremental' | 'deep_backfill', trigger: 'scheduled'): Promise<PublicSyncStatus>;
}

/** No browser orchestration, identifiers or credentials in cron output. */
export class ScheduledSyncService {
  constructor(private readonly store: ScheduledStore, private readonly runner: ScheduledSyncRunner,
    private readonly clock = () => performance.now(), private readonly now = () => new Date(),
    private readonly wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {}

  async run(job: ScheduledJob) {
    const started = this.clock();
    const result = await this.store.withScheduledLock(async () => {
      const due = await this.store.duePlayers(job, this.now().toISOString());
      let processed = 0;
      let paused = 0;
      let providerRequests = 0;
      for (const player of due) {
        // Reserve a full 25-second chunk, including when the prior work was slow.
        if (processed >= 4 || this.clock() - started > 15_000) break;
        if (processed > 0) {
          if (this.clock() - started + 7_000 > 15_000) break;
          await this.wait(7_000);
        }
        try {
          const status = await this.runner.start(player.publicPlayerId,
            job === 'recent' ? 'incremental' : 'deep_backfill', 'scheduled');
          // Counters in status are cumulative; do not label them invocation totals.
          providerRequests = Math.max(providerRequests, status.performance.providerRequests);
          if (status.status === 'paused') paused += 1;
          if (status.status === 'failed') throw new PublicApiError(503, 'SCHEDULED_SYNC_STOPPED', '排程已安全停止，等待檢查。');
        } catch (error) {
          if (!(error instanceof PublicApiError)
            || !['LOCK_BUSY','CONSENT_REVOKED','SYNC_NOT_FOUND','SYNC_BACKOFF','RATE_LIMITED',
              'PROVIDER_TIMEOUT','PROVIDER_ERROR'].includes(error.code)) throw error;
          paused += 1;
        }
        processed += 1;
      }
      return { job, eligible: due.length, processed, paused, partial: processed < due.length,
        lifetimeComplete: false as const, observedRunProviderRequests: providerRequests };
    });
    return result ?? { job, processed: 0, partial: true, busy: true, lifetimeComplete: false as const };
  }
}
