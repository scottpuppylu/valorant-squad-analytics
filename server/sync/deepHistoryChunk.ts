import type { MatchImportInput } from '../contracts.js';
import { PublicApiError } from '../errors.js';
import { lookupHmac, sourceMatchHmac } from '../identityProtection.js';
import type { DurableEvidenceService } from '../persistence/durableEvidenceService.js';
import type { HistoricalDiscoveryProvider } from './historicalDiscoveryProvider.js';
import type { PostgresSyncStore } from './postgresSyncStore.js';
import type { DeepCursorState, SyncChunkMetrics, SyncCursorRecord, SyncRunRecord, SyncTerminationReason } from './types.js';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const malformed = () => new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '歷史資料格式不完整，進度尚未前進。');

export interface DeepChunkResult {
  deep: DeepCursorState;
  nextStart: number;
  fingerprintHmac?: string;
  boundaryHmac?: string;
  coverageFrom?: string;
  coverageTo?: string;
  terminationReason?: SyncTerminationReason;
  runStatus: 'paused' | 'failed' | 'complete';
  metrics: SyncChunkMetrics;
}

/** One bounded invocation. No raw discovery ID survives its cursor commit. */
export async function executeDeepHistoryChunk(options: {
  store: PostgresSyncStore;
  durable: Pick<DurableEvidenceService, 'persistSyncPage'>;
  provider: HistoricalDiscoveryProvider;
  run: SyncRunRecord;
  cursor: SyncCursorRecord;
  input: MatchImportInput;
  hmacKey: string;
  pageSize: number;
  now: () => Date;
  monotonicNow: () => number;
  invocationStarted: number;
  budgetMs: number;
  metrics: SyncChunkMetrics;
}): Promise<DeepChunkResult> {
  const { store, durable, provider, run, cursor, input, hmacKey, pageSize, now, monotonicNow } = options;
  const deep: DeepCursorState = { ...(cursor.deep ?? {
    historyPhase: 'live_v4', storedPage: 1, storedItemIndex: 0,
    liveHistoryExhausted: false, storedHistoryExhausted: false,
  }) };
  const metrics = options.metrics;
  const result: DeepChunkResult = { deep, metrics, nextStart: cursor.nextStart, runStatus: 'paused' };
  async function request(work: () => Promise<unknown>, detail = false): Promise<unknown> {
    if (monotonicNow() - options.invocationStarted >= options.budgetMs) {
      throw new PublicApiError(504, 'PROVIDER_TIMEOUT', '已達同步時間預算，保留原進度。');
    }
    if (!await store.hasActiveConsent(run.subject.playerId)) {
      throw new PublicApiError(409, 'CONSENT_REVOKED', '同意已撤回，未呼叫資料來源。');
    }
    if (monotonicNow() - options.invocationStarted >= options.budgetMs) {
      throw new PublicApiError(504, 'PROVIDER_TIMEOUT', '已達同步時間預算，未呼叫資料來源。');
    }
    metrics.sqlQueryCount += 1;
    metrics.providerRequests! += 1;
    if (detail) metrics.detailRequests! += 1;
    const started = monotonicNow();
    try { return await work(); } finally { metrics.providerFetchMs += Math.round(monotonicNow() - started); }
  }
  function ids(payload: unknown, stored: boolean): string[] {
    if (!record(payload) || !Array.isArray(payload.data) || payload.data.length > pageSize) throw malformed();
    return payload.data.map((entry) => {
      const meta = record(entry) ? entry[stored ? 'meta' : 'metadata'] : undefined;
      const id = record(meta) ? meta[stored ? 'id' : 'match_id'] : undefined;
      if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw malformed();
      return id;
    });
  }
  const hmacsFor = (rawIds: string[]) => rawIds.map((id) => sourceMatchHmac('HenrikDev', id, hmacKey));
  const fingerprint = (hmacs: string[]) => hmacs.length ? lookupHmac('sync-page-fingerprint:v1', hmacs.join('|'), hmacKey) : undefined;
  async function persist(payload: unknown, expected: string[]): Promise<void> {
    if (monotonicNow() - options.invocationStarted >= options.budgetMs) {
      throw new PublicApiError(504, 'PROVIDER_TIMEOUT', '已達同步時間預算，保留原進度。');
    }
    let written;
    try { written = await durable.persistSyncPage(input, payload, run.subject.playerId, now().toISOString()); }
    catch (error) {
      if (error instanceof PublicApiError && error.code === 'CONSENT_REVOKED') throw error;
      throw new PublicApiError(503, 'DATABASE_ERROR', '歷史資料尚未完整提交，保留原進度。');
    }
    if (written.matchWrites !== expected.length || written.matchLookupHmacs.some((value, index) => value !== expected[index])) throw malformed();
    metrics.persistedMatches += written.matchWrites;
    metrics.normalizationMs += written.performance.normalizationMs;
    metrics.databaseMs += written.performance.dbTransactionMs;
    metrics.sqlQueryCount += written.performance.sqlQueryCount;
    const times = written.startedAtValues.map(Date.parse).filter(Number.isFinite);
    if (times.length) {
      result.coverageFrom = new Date(Math.min(...times)).toISOString();
      result.coverageTo = new Date(Math.max(...times)).toISOString();
    }
  }
  function stall(): DeepChunkResult {
    result.terminationReason = 'provider_repeated_page';
    result.runStatus = 'failed';
    return result;
  }
  if (deep.historyPhase === 'live_v4') {
    const payload = await request(() => provider.fetchHistoryPage(input, cursor.nextStart, pageSize));
    const rawIds = ids(payload, false);
    const hmacs = hmacsFor(rawIds);
    result.fingerprintHmac = fingerprint(hmacs);
    if (result.fingerprintHmac && result.fingerprintHmac === cursor.lastPageFingerprintHmac) return stall();
    const existing = await store.existingMatchHmacs(hmacs);
    metrics.sqlQueryCount += 1;
    if (rawIds.length) await persist(payload, hmacs);
    metrics.returnedMatches = rawIds.length;
    metrics.overlapMatches = existing.size;
    result.nextStart += rawIds.length;
    result.boundaryHmac = hmacs.at(-1);
    if (rawIds.length < pageSize) {
      deep.liveHistoryExhausted = true;
      deep.historyPhase = 'stored_index';
    }
    // Full overlap never terminates; no artificial total-history horizon.
    return result;
  }
  if (deep.historyPhase !== 'stored_index') throw malformed();
  const payload = await request(() => provider.fetchStoredIndexPage(input, deep.storedPage, pageSize));
  const rawIds = ids(payload, true);
  const hmacs = hmacsFor(rawIds);
  result.fingerprintHmac = fingerprint(hmacs);
  let after: number | undefined;
  if (record(payload) && payload.results !== undefined) {
    if (!record(payload.results)) throw malformed();
    const counters = payload.results;
    for (const key of ['total', 'returned', 'before', 'after']) {
      if (!Number.isSafeInteger(counters[key]) || Number(counters[key]) < 0) throw malformed();
    }
    if (counters.returned !== rawIds.length || Number(counters.before) + rawIds.length + Number(counters.after) !== counters.total) throw malformed();
    deep.storedTotal = Number(counters.total);
    after = Number(counters.after);
    if (!rawIds.length && after > 0) return stall();
  }
  if (result.fingerprintHmac && deep.discoveryPage !== undefined && deep.discoveryPage !== deep.storedPage
    && result.fingerprintHmac === cursor.lastPageFingerprintHmac) return stall();
  // The materialized index is mutable: restart a changed in-progress page safely.
  if (deep.storedItemIndex > 0 && result.fingerprintHmac !== cursor.lastPageFingerprintHmac) deep.storedItemIndex = 0;
  if (deep.storedItemIndex > rawIds.length) deep.storedItemIndex = 0;
  deep.discoveryPage = deep.storedPage;
  const existing = await store.existingMatchHmacs(hmacs);
  metrics.sqlQueryCount += 1;
  let detailUsed = false;
  for (let index = deep.storedItemIndex; index < rawIds.length; index += 1) {
    if (monotonicNow() - options.invocationStarted >= options.budgetMs) break;
    if (!existing.has(hmacs[index]!)) {
      if (detailUsed) break;
      detailUsed = true;
      let detail: unknown;
      try { detail = await request(() => provider.fetchMatchDetail(input, rawIds[index]!), true); }
      catch (error) {
        if (!(error instanceof PublicApiError) || error.status !== 404) throw error;
        metrics.detailUnavailableCount! += 1;
      }
      if (detail !== undefined) {
        if (!record(detail) || !record(detail.data) || !record(detail.data.metadata)
          || detail.data.metadata.match_id !== rawIds[index]) throw malformed();
        await persist({ status: 200, data: [detail.data] }, [hmacs[index]!]);
      }
    } else metrics.overlapMatches += 1;
    deep.storedItemIndex = index + 1;
    metrics.returnedMatches += 1;
    metrics.storedMatchesSeen! += 1;
  }
  if (deep.storedItemIndex === rawIds.length) {
    if (after === 0 || (after === undefined && rawIds.length < pageSize)) {
      deep.historyPhase = 'complete';
      deep.storedHistoryExhausted = true;
      result.terminationReason = 'source_exhausted';
      result.runStatus = 'complete';
    } else {
      deep.storedPage += 1;
      deep.storedItemIndex = 0;
    }
  }
  return result;
}
