import type { MatchImportInput, ValorantAffinity } from '../contracts.js';
import { PublicApiError } from '../errors.js';
import type { HistoricalMatchProvider } from '../henrikDataProvider.js';
import { lookupHmac, sourceMatchHmac } from '../identityProtection.js';
import type { DurableEvidenceService } from '../persistence/durableEvidenceService.js';
import { PostgresSyncStore } from './postgresSyncStore.js';
import type {
  PublicSyncStatus,
  SyncCursorRecord,
  SyncErrorCategory,
  SyncKind,
  SyncRunRecord,
  SyncStatus,
  SyncTerminationReason,
} from './types.js';

const DEFAULT_PAGE_SIZE = 3;
const DEFAULT_HISTORY_HORIZON = 300;
const DEFAULT_USEFUL_WORK_BUDGET_MS = 25_000;
const LEASE_DURATION_MS = 45_000;

interface HistoricalSyncOptions {
  pageSize?: number;
  historyHorizon?: number;
  usefulWorkBudgetMs?: number;
  now?: () => Date;
  monotonicNow?: () => number;
}

type SyncPageWriter = Pick<DurableEvidenceService, 'persistSyncPage'>;

type PayloadRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PayloadRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function providerMatchIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '資料服務回應格式不完整。');
  }
  return payload.data.map((entry) => {
    const metadata = isRecord(entry) && isRecord(entry.metadata) ? entry.metadata : undefined;
    if (!metadata || typeof metadata.match_id !== 'string' || metadata.match_id.length === 0) {
      throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '資料服務回應缺少比賽識別資料。');
    }
    return metadata.match_id;
  });
}

function classifyFailure(error: unknown, databaseStage: boolean): SyncErrorCategory {
  if (databaseStage) return 'DATABASE_ERROR';
  if (!(error instanceof PublicApiError)) return 'UNKNOWN';
  if (error.code === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (error.code === 'PROVIDER_TIMEOUT') return 'PROVIDER_TIMEOUT';
  if (error.code === 'MALFORMED_PROVIDER_RESPONSE') return 'MALFORMED_RESPONSE';
  if (error.code === 'PROVIDER_ERROR') return 'PROVIDER_5XX';
  return 'UNKNOWN';
}

function retryStatus(category: SyncErrorCategory): SyncStatus {
  return ['RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_5XX'].includes(category) ? 'paused' : 'failed';
}

function publicFailure(category: SyncErrorCategory): PublicApiError {
  if (category === 'RATE_LIMITED') return new PublicApiError(429, 'RATE_LIMITED', '資料來源目前限制請求，已保留進度並排定稍後重試。');
  if (category === 'PROVIDER_TIMEOUT') return new PublicApiError(504, 'PROVIDER_TIMEOUT', '資料來源回應逾時，已保留同步進度。');
  if (category === 'DATABASE_ERROR') return new PublicApiError(503, 'DATABASE_ERROR', '同步資料暫時無法寫入，游標尚未前進。');
  return new PublicApiError(502, 'PROVIDER_ERROR', '歷史同步暫時失敗，游標尚未前進。');
}

function coverage(values: string[]): { from?: string; to?: string } {
  const timestamps = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  if (timestamps.length === 0) return {};
  return {
    from: new Date(Math.min(...timestamps)).toISOString(),
    to: new Date(Math.max(...timestamps)).toISOString(),
  };
}

export class HistoricalSyncService {
  private readonly pageSize: number;
  private readonly historyHorizon: number;
  private readonly usefulWorkBudgetMs: number;
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;

  constructor(
    private readonly store: PostgresSyncStore,
    private readonly durable: SyncPageWriter,
    private readonly provider: HistoricalMatchProvider,
    private readonly hmacKey: string,
    options: HistoricalSyncOptions = {},
  ) {
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.historyHorizon = options.historyHorizon ?? DEFAULT_HISTORY_HORIZON;
    this.usefulWorkBudgetMs = options.usefulWorkBudgetMs ?? DEFAULT_USEFUL_WORK_BUDGET_MS;
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  async start(publicPlayerId: string, kind: SyncKind): Promise<PublicSyncStatus> {
    const subject = await this.store.findSubject(publicPlayerId);
    if (!subject) throw new PublicApiError(404, 'SYNC_NOT_FOUND', '找不到可同步的玩家連接。');
    if (!await this.store.hasActiveConsent(subject.playerId)) {
      throw new PublicApiError(409, 'CONSENT_REVOKED', '玩家同意目前不是有效狀態，未呼叫資料來源。');
    }
    const existingRun = await this.store.findLatestRun(subject, kind);
    if (existingRun) {
      if (existingRun.status === 'complete' && kind === 'backfill') return this.requireStatus(existingRun.publicId);
      if (existingRun.status !== 'complete' && existingRun.status !== 'cancelled') return this.continue(existingRun.publicId);
    }
    const at = this.now();
    const lease = await this.store.acquireCursorLease(
      subject,
      kind,
      at.toISOString(),
      new Date(at.getTime() + LEASE_DURATION_MS).toISOString(),
      kind === 'incremental',
    );
    if (!lease) throw new PublicApiError(409, 'LOCK_BUSY', '此玩家已有同步工作正在執行。');
    const run = await this.store.createRun(subject, kind, lease.cursor.nextStart, at.toISOString());
    return this.executeChunk(run, lease.cursor, lease.leaseToken, 9);
  }

  async continue(publicRunId: string): Promise<PublicSyncStatus> {
    const run = await this.store.findRun(publicRunId);
    if (!run) throw new PublicApiError(404, 'SYNC_NOT_FOUND', '找不到這次同步工作。');
    if (run.status === 'complete' || run.status === 'cancelled') return this.requireStatus(publicRunId);
    if (!await this.store.hasActiveConsent(run.subject.playerId)) {
      await this.store.cancelRunForConsent(run.id, run.subject.playerId, run.kind, this.now().toISOString());
      throw new PublicApiError(409, 'CONSENT_REVOKED', '玩家已撤回或缺少有效同意，未呼叫資料來源。');
    }
    if (run.nextAttemptAt && Date.parse(run.nextAttemptAt) > this.now().getTime()) {
      throw new PublicApiError(429, 'SYNC_BACKOFF', '同步正在退避等待，請在可重試時間後再繼續。');
    }
    const at = this.now();
    const lease = await this.store.acquireCursorLease(
      run.subject,
      run.kind,
      at.toISOString(),
      new Date(at.getTime() + LEASE_DURATION_MS).toISOString(),
    );
    if (!lease) throw new PublicApiError(409, 'LOCK_BUSY', '此玩家已有同步工作正在執行。');
    await this.store.markRunRunning(run.id);
    return this.executeChunk(run, lease.cursor, lease.leaseToken, 8);
  }

  async status(publicRunId: string): Promise<PublicSyncStatus> {
    return this.requireStatus(publicRunId);
  }

  private async requireStatus(publicRunId: string): Promise<PublicSyncStatus> {
    const status = await this.store.status(publicRunId);
    if (!status) throw new PublicApiError(404, 'SYNC_NOT_FOUND', '找不到這次同步工作。');
    return status;
  }

  private async executeChunk(
    run: SyncRunRecord,
    cursor: SyncCursorRecord,
    leaseToken: string,
    initialSqlQueryCount: number,
  ): Promise<PublicSyncStatus> {
    const invocationStarted = this.monotonicNow();
    let databaseStage = false;
    let released = false;
    let cursorCommitted = false;
    try {
      if (!await this.store.hasActiveConsent(run.subject.playerId)) {
        await this.store.recordFailure({
          cursorId: cursor.id, leaseToken, runId: run.id, category: 'CONSENT_REVOKED',
          status: 'cancelled', at: this.now().toISOString(),
        });
        released = true;
        throw new PublicApiError(409, 'CONSENT_REVOKED', '玩家已撤回或缺少有效同意，未呼叫資料來源。');
      }

      const input: MatchImportInput = {
        gameName: run.subject.gameName,
        tag: run.subject.tag,
        affinity: run.subject.affinity as ValorantAffinity,
        consent: true,
        limit: 3,
      };
      const providerStarted = this.monotonicNow();
      const payload = await this.provider.fetchHistoryPage(input, cursor.nextStart, this.pageSize);
      const providerFetchMs = Math.round(this.monotonicNow() - providerStarted);
      if (this.monotonicNow() - invocationStarted >= this.usefulWorkBudgetMs) {
        throw new PublicApiError(504, 'PROVIDER_TIMEOUT', '同步工作已達安全時間預算，游標尚未前進。');
      }

      const rawIds = providerMatchIds(payload);
      const matchHmacs = rawIds.map((id) => sourceMatchHmac('HenrikDev', id, this.hmacKey));
      const fingerprintHmac = matchHmacs.length > 0
        ? lookupHmac('sync-page-fingerprint:v1', matchHmacs.join('|'), this.hmacKey)
        : undefined;
      const repeatedPage = fingerprintHmac !== undefined && fingerprintHmac === cursor.lastPageFingerprintHmac;
      const existing = await this.store.existingMatchHmacs(matchHmacs);
      let persistedMatches = 0;
      let normalizationMs = 0;
      let databaseMs = 0;
      let sqlQueryCount = initialSqlQueryCount + 1;
      if (rawIds.length > 0) sqlQueryCount += 1;
      let pageCoverage: { from?: string; to?: string } = {};

      databaseStage = true;
      if (!repeatedPage && rawIds.length > 0) {
        const write = await this.durable.persistSyncPage(input, payload, run.subject.playerId, this.now().toISOString());
        databaseStage = false;
        if (write.matchWrites !== rawIds.length || write.matchLookupHmacs.some((hmac, index) => hmac !== matchHmacs[index])) {
          throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '資料服務回應包含無法正規化的比賽。');
        }
        persistedMatches = write.matchWrites;
        normalizationMs = write.performance.normalizationMs;
        databaseMs = write.performance.dbTransactionMs;
        sqlQueryCount += write.performance.sqlQueryCount;
        pageCoverage = coverage(write.startedAtValues);
      }
      databaseStage = false;

      const nextStart = repeatedPage ? cursor.nextStart : cursor.nextStart + rawIds.length;
      let terminationReason: SyncTerminationReason | undefined;
      let completeForProviderWindow = false;
      let incompleteReason: string | undefined;
      if (rawIds.length === 0) {
        terminationReason = 'empty_page';
        completeForProviderWindow = true;
      } else if (repeatedPage) {
        terminationReason = 'repeated_page';
        incompleteReason = 'provider_repeated_page';
      } else if (rawIds.length < this.pageSize) {
        terminationReason = 'short_page';
        completeForProviderWindow = true;
      } else if (run.kind === 'incremental' && existing.size > 0) {
        terminationReason = 'known_boundary';
        completeForProviderWindow = true;
      } else if (run.kind === 'backfill' && existing.size === rawIds.length) {
        terminationReason = 'no_older_unique_matches';
        incompleteReason = 'provider_returned_no_older_unique_matches';
      } else if (nextStart >= this.historyHorizon) {
        terminationReason = 'configured_horizon';
        incompleteReason = 'configured_history_horizon';
      }

      const totalMs = Math.round(this.monotonicNow() - invocationStarted);
      sqlQueryCount += 5;
      databaseStage = true;
      await this.store.recordSuccess({
        cursorId: cursor.id,
        leaseToken,
        runId: run.id,
        nextStart,
        pageNumber: Math.floor(cursor.nextStart / this.pageSize),
        boundaryHmac: matchHmacs.at(-1),
        fingerprintHmac,
        coverageFrom: pageCoverage.from,
        coverageTo: pageCoverage.to,
        at: this.now().toISOString(),
        terminationReason,
        completeForProviderWindow,
        incompleteReason,
        metrics: {
          providerFetchMs,
          normalizationMs,
          databaseMs,
          totalMs,
          sqlQueryCount,
          returnedMatches: rawIds.length,
          persistedMatches,
          overlapMatches: existing.size,
        },
      });
      databaseStage = false;
      released = true;
      cursorCommitted = true;
      process.stdout.write(`${JSON.stringify({
        event: 'historical_sync_chunk',
        runId: run.publicId,
        kind: run.kind,
        status: terminationReason ? 'complete' : 'paused',
        durationMs: totalMs,
        matchCount: persistedMatches,
        overlapCount: existing.size,
        pageCount: 1,
        retryCount: cursor.retryCount,
        terminationReason,
        providerFetchMs,
        normalizationMs,
        databaseMs,
        sqlQueryCount,
      })}\n`);
      return this.requireStatus(run.publicId);
    } catch (error) {
      if (error instanceof PublicApiError && error.code === 'CONSENT_REVOKED') throw error;
      if (cursorCommitted) throw new PublicApiError(503, 'DATABASE_ERROR', '同步已安全提交，但狀態暫時無法讀取。');
      const category = classifyFailure(error, databaseStage);
      const status = retryStatus(category);
      const retryable = status === 'paused';
      const retrySeconds = Math.min(60 * 2 ** cursor.retryCount, 900);
      const failedAt = this.now();
      try {
        await this.store.recordFailure({
          cursorId: cursor.id,
          leaseToken,
          runId: run.id,
          category,
          status,
          at: failedAt.toISOString(),
          nextAttemptAt: retryable ? new Date(failedAt.getTime() + retrySeconds * 1_000).toISOString() : undefined,
        });
        released = true;
      } catch {
        databaseStage = true;
      }
      throw publicFailure(databaseStage ? 'DATABASE_ERROR' : category);
    } finally {
      if (!released) {
        await this.store.releaseLease(cursor.id, leaseToken, this.now().toISOString()).catch(() => undefined);
      }
    }
  }
}
