import { createHash } from 'node:crypto';
import { PublicApiError } from '../errors.js';
import { STORED_INDEX_PAGE_SIZE } from '../sync/historicalDiscoveryProvider.js';
import type { ProviderAccountRef } from '../henrikDataProvider.js';
import type { RequestRecord } from './providerGateway.js';
import { REBUILD_MAX_LANES, runLanes, type RollingWindowLimiter } from './rateLimiter.js';
import { sanitizedEvent, type EventSink } from './safeLog.js';
import type { Affinity, CursorState, DiscoveredEntry, DiscoverySource, RebuildStagingStore, StagingAccount } from './stagingStore.js';

/**
 * TASK-DATA-LOCAL-REBUILD-COLLECT-01 private collector. Phases are separate and resumable:
 *   resolve  — one v2 account lookup per account (affinity + provider account id); the first validates the key;
 *   discover — per account: live v4 history (full documents, hydrated for free) then the stored-match index
 *              (STORED_INDEX_PAGE_SIZE), with the existing deep-history stop rules (short page / results.after = 0
 *              / repeated-page stall); one transaction per page (cursor + links + matches);
 *   hydrate  — one v4 detail per unique, not-yet-hydrated match (global dedupe in the staging store).
 * It never touches the application schema, consent, sync cursors or analytics.
 */
export interface RebuildProvider {
  fetchAccount(gameName: string, tag: string): Promise<unknown>;
  fetchHistoryPage(input: ProviderAccountRef, start: number, size: number): Promise<unknown>;
  fetchStoredIndexPage(input: ProviderAccountRef, page: number, size: number): Promise<unknown>;
  fetchMatchDetail(input: { affinity: Affinity }, matchId: string): Promise<unknown>;
}

export type StopReason = 'budget_reached' | 'deadline_reached' | 'provider_429' | 'credential_rejected'
  | 'repeated_provider_errors' | 'malformed_discovery' | 'account_unresolved';

export interface CollectorOptions {
  store: RebuildStagingStore;
  provider: RebuildProvider;
  limiter: RollingWindowLimiter;
  sink: EventSink;
  /** Finite request budget for THIS invocation (required; fail closed at the budget). */
  maxProviderRequests: number;
  deadlineMs?: number;
  lanes?: number;
  livePageSize?: number;
  storedPageSize?: number;
  maxDetailAttempts?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface CollectorResult { stopReason: StopReason | null; requests: number; avoidedDetailFetches: number }

const AFFINITIES = new Set<Affinity>(['ap', 'eu', 'na', 'kr', 'latam', 'br']);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 128) => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);
const timestamp = (value: unknown) => { const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN; return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; };
const modeKey = (value: unknown) => { const raw = text(value, 64); return raw ? raw.toLowerCase().replace(/\s+/gu, '') : null; };
const fingerprint = (ids: readonly string[]) => (ids.length ? createHash('sha256').update(ids.join('|')).digest('hex') : null);

export class MalformedProviderData extends Error { constructor(where: string) { super(`malformed provider data (${where}).`); this.name = 'MalformedProviderData'; } }

/** v4 history item / v4 detail `data` document → staging entry (full document kept as the payload). */
export function liveEntry(document: unknown): DiscoveredEntry {
  const metadata = record(document) && record(document.metadata) ? document.metadata : undefined;
  const id = metadata ? text(metadata.match_id) : null;
  if (!metadata || !id) throw new MalformedProviderData('v4 match metadata');
  const queue = record(metadata.queue) ? metadata.queue : {};
  return {
    providerMatchId: id, startedAt: timestamp(metadata.started_at), mode: modeKey(queue.id) ?? modeKey(queue.name),
    mapName: record(metadata.map) ? text(metadata.map.name, 64) : null, seasonShort: record(metadata.season) ? text(metadata.season.short, 32) : null,
    payload: document,
  };
}

/** stored-match index row → staging entry (row kept; no full document). */
export function storedEntry(row: unknown): DiscoveredEntry {
  const meta = record(row) && record(row.meta) ? row.meta : undefined;
  const id = meta ? text(meta.id) : null;
  if (!meta || !id) throw new MalformedProviderData('stored index meta');
  return {
    providerMatchId: id, startedAt: timestamp(meta.started_at), mode: modeKey(meta.mode),
    mapName: record(meta.map) ? text(meta.map.name, 64) : null, seasonShort: record(meta.season) ? text(meta.season.short, 32) : null,
    storedRow: row,
  };
}

export class RebuildCollector {
  private readonly lanes: number;
  private readonly livePageSize: number;
  private readonly storedPageSize: number;
  private readonly maxDetailAttempts: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly started: number;
  private readonly startedRequests: number;
  private stopReason: StopReason | null = null;
  private consecutiveTransient = 0;
  private avoided = 0;
  private lastRequest: RequestRecord | undefined;
  private phase = 'idle';

  constructor(private readonly options: CollectorOptions) {
    this.lanes = options.lanes ?? REBUILD_MAX_LANES;
    if (!Number.isSafeInteger(options.maxProviderRequests) || options.maxProviderRequests < 1) throw new Error('a finite positive --max-provider-requests is required.');
    // The accepted deep-history live_v4 page size: Henrik charges live history by page size (observed: one
    // size-10 page ≈ 11 of a 30-unit/min budget), so a larger page would exceed the provider budget at 6 RPM.
    this.livePageSize = options.livePageSize ?? 3;
    this.storedPageSize = options.storedPageSize ?? STORED_INDEX_PAGE_SIZE;
    this.maxDetailAttempts = options.maxDetailAttempts ?? 3;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.started = this.now();
    this.startedRequests = options.limiter.totalStarted();
  }

  /** Called by the gateway's accounting hook so error classification can see the HTTP status class. */
  observe(request: RequestRecord): void { this.lastRequest = request; }

  requests(): number { return this.options.limiter.totalStarted() - this.startedRequests; }
  result(): CollectorResult { return { stopReason: this.stopReason, requests: this.requests(), avoidedDetailFetches: this.avoided }; }
  private stop(reason: StopReason): void { this.stopReason ??= reason; }
  private stopped(): boolean { return this.stopReason !== null; }

  private async emit(event: string, extra: Record<string, number | string | boolean | null> = {}): Promise<void> {
    const counts = await this.options.store.counts();
    this.options.sink(sanitizedEvent(event, {
      phase: this.phase, elapsed_s: Math.round((this.now() - this.started) / 1000), requests: this.requests(),
      current_window: this.options.limiter.currentInWindow(), max_window: this.options.limiter.maxObservedInWindow(),
      avoided_detail_fetches: this.avoided, ...counts, ...extra,
    }));
  }

  /** Budget / deadline gate before EVERY provider call; then the call itself (limiter inside the gateway). */
  private async call<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (this.stopped()) return undefined;
    if (this.requests() >= this.options.maxProviderRequests) { this.stop('budget_reached'); return undefined; }
    if (this.options.deadlineMs !== undefined && this.now() - this.started >= this.options.deadlineMs) { this.stop('deadline_reached'); return undefined; }
    const value = await work();
    this.consecutiveTransient = 0;
    if (this.requests() % 10 === 0) await this.emit('collector_progress');
    return value;
  }

  /**
   * Shared provider-error policy. Returns 'retry' after a bounded backoff for transient failures,
   * 'not_found' for a 404, 'item_failed' for a deterministic per-item 4xx; stops the run otherwise.
   */
  private async classify(error: unknown): Promise<'retry' | 'not_found' | 'item_failed' | 'stop'> {
    if (error instanceof MalformedProviderData) return 'item_failed';
    if (!(error instanceof PublicApiError)) throw error;
    if (error.code === 'RATE_LIMITED') { this.stop('provider_429'); return 'stop'; }
    if (error.code === 'ACCOUNT_NOT_FOUND') return 'not_found';
    if (error.code === 'MALFORMED_PROVIDER_RESPONSE') return 'item_failed';
    const status = this.lastRequest?.httpStatus ?? null;
    if (status === 401 || status === 403) { this.stop('credential_rejected'); return 'stop'; }
    if (status !== null && status >= 400 && status < 500) return 'item_failed';
    this.consecutiveTransient += 1;
    if (this.consecutiveTransient > 3) { this.stop('repeated_provider_errors'); return 'stop'; }
    await this.emit('collector_backoff', { attempt: this.consecutiveTransient });
    await this.sleep(60_000 * 2 ** (this.consecutiveTransient - 1));
    return 'retry';
  }

  /** Phase 0: account lookups. `firstOnly` = the single credential-validation lookup. */
  async resolve(firstOnly = false): Promise<{ resolved: number; unresolved: number }> {
    this.phase = 'resolve';
    const accounts = await this.options.store.accounts();
    for (const account of accounts.filter((candidate) => !candidate.providerPuuid)) {
      for (;;) {
        try {
          const payload = await this.call(() => this.options.provider.fetchAccount(account.gameName, account.tag));
          if (payload === undefined) break;
          const data = record(payload) && record(payload.data) ? payload.data : undefined;
          const region = data && typeof data.region === 'string' ? data.region.toLowerCase() as Affinity : undefined;
          const puuid = data ? text(data.puuid) : null;
          const sameId = data && typeof data.name === 'string' && typeof data.tag === 'string'
            && data.name.toLowerCase() === account.gameName.toLowerCase() && data.tag.toLowerCase() === account.tag.toLowerCase();
          if (!region || !AFFINITIES.has(region) || !puuid || !sameId) { this.stop('account_unresolved'); break; }
          await this.options.store.resolveAccount(account.accountPublicId, region, puuid);
          break;
        } catch (error) {
          const decision = await this.classify(error);
          if (decision === 'retry') continue;
          if (decision !== 'stop') this.stop('account_unresolved');
          break;
        }
      }
      if (firstOnly || this.stopped()) break;
    }
    await this.emit('collector_phase_end');
    const after = await this.options.store.accounts();
    return { resolved: after.filter((account) => account.providerPuuid).length, unresolved: after.filter((account) => !account.providerPuuid).length };
  }

  /** Phase A: discovery for every resolved account (≤ 2 lanes, shared limiter). */
  async discover(): Promise<void> {
    this.phase = 'discover';
    const accounts = (await this.options.store.accounts()).filter((account) => account.affinity && account.providerPuuid);
    await runLanes(accounts, this.lanes, (account) => this.discoverAccount(account), () => this.stopped());
    await this.emit('collector_phase_end');
  }

  private async discoverAccount(account: StagingAccount): Promise<void> {
    const ref: ProviderAccountRef = { gameName: account.gameName, tag: account.tag, affinity: account.affinity! };
    for (const source of ['live_v4', 'stored_index'] as const) {
      let cursor = await this.options.store.cursor(account.accountPublicId, source);
      while (!cursor.exhausted && !this.stopped()) {
        let payload: unknown;
        try {
          payload = await this.call(() => source === 'live_v4'
            ? this.options.provider.fetchHistoryPage(ref, cursor.nextPosition, this.livePageSize)
            : this.options.provider.fetchStoredIndexPage(ref, cursor.nextPosition, this.storedPageSize));
          if (payload === undefined) return;
        } catch (error) {
          const decision = await this.classify(error);
          if (decision === 'retry') continue;
          if (decision === 'not_found') {
            cursor = { ...cursor, exhausted: true, termination: 'provider_404' };
            await this.options.store.writeCursorOnly(account.accountPublicId, source, cursor);
            break;
          }
          if (decision === 'item_failed') this.stop('malformed_discovery');
          return;
        }
        try { cursor = await this.applyPage(account, source, cursor, payload); }
        catch (error) {
          if (error instanceof MalformedProviderData) { this.stop('malformed_discovery'); return; }
          throw error;
        }
      }
    }
  }

  /** Applies one page under the deep-history stop rules; commits entries + cursor atomically. */
  private async applyPage(account: StagingAccount, source: DiscoverySource, cursor: CursorState, payload: unknown): Promise<CursorState> {
    const size = source === 'live_v4' ? this.livePageSize : this.storedPageSize;
    if (!record(payload) || !Array.isArray(payload.data) || payload.data.length > size) throw new MalformedProviderData(`${source} page`);
    const entries = payload.data.map(source === 'live_v4' ? liveEntry : storedEntry);
    const ids = entries.map((entry) => entry.providerMatchId);
    let after: number | undefined;
    let total = cursor.providerTotal;
    if (source === 'stored_index' && payload.results !== undefined) {
      const counters = record(payload.results) ? payload.results : undefined;
      const values = counters ? ['total', 'returned', 'before', 'after'].map((key) => counters[key]) : [];
      if (!counters || values.some((value) => !Number.isSafeInteger(value) || Number(value) < 0)
        || counters.returned !== ids.length || Number(counters.before) + ids.length + Number(counters.after) !== counters.total) {
        throw new MalformedProviderData('stored index counters');
      }
      after = Number(counters.after);
      total = Number(counters.total);
    }
    const print = fingerprint(ids);
    const stalled = (ids.length === 0 && after !== undefined && after > 0) || (print !== null && print === cursor.lastFingerprint);
    if (stalled) {
      // deep-history rule: a repeated / empty-but-not-final page is retried after a pause, then the source stalls.
      const repeatCount = cursor.repeatCount + 1;
      const next: CursorState = repeatCount >= 2
        ? { ...cursor, repeatCount, exhausted: true, termination: `${source}_pagination_stalled` }
        : { ...cursor, repeatCount };
      await this.options.store.writeCursorOnly(account.accountPublicId, source, next);
      if (!next.exhausted) await this.sleep(300_000);
      return next;
    }
    const next: CursorState = {
      ...cursor, lastFingerprint: print, repeatCount: 0, providerTotal: total, pagesRead: cursor.pagesRead + 1,
      entriesSeen: cursor.entriesSeen + ids.length,
      nextPosition: source === 'live_v4' ? cursor.nextPosition + ids.length : cursor.nextPosition + 1,
    };
    if (source === 'live_v4' ? ids.length < size : (after === 0 || (after === undefined && ids.length < size))) {
      next.exhausted = true;
      next.termination = source === 'live_v4' ? 'short_page' : 'source_exhausted';
    }
    await this.options.store.commitDiscoveryPage({ account, source, entries, cursor: next, at: new Date().toISOString() });
    return next;
  }

  /** Phase B: one detail per unique pending match, Competitive / newest first (≤ 2 lanes). */
  async hydrate(): Promise<void> {
    this.phase = 'hydrate';
    while (!this.stopped()) {
      const batch = await this.options.store.pendingMatches(20, this.maxDetailAttempts);
      if (batch.length === 0) break;
      await runLanes(batch, this.lanes, (match) => this.hydrateOne(match.providerMatchId, match.affinity), () => this.stopped());
    }
    await this.emit('collector_phase_end');
  }

  private async hydrateOne(providerMatchId: string, affinity: Affinity): Promise<void> {
    if (await this.options.store.isHydrated(providerMatchId)) { this.avoided += 1; return; }
    for (;;) {
      try {
        const detail = await this.call(() => this.options.provider.fetchMatchDetail({ affinity }, providerMatchId));
        if (detail === undefined) return;
        const document = record(detail) ? detail.data : undefined;
        const entry = liveEntry(document);
        if (entry.providerMatchId !== providerMatchId) throw new MalformedProviderData('detail id mismatch');
        await this.options.store.commitDetail(providerMatchId, document, new Date().toISOString(), { startedAt: entry.startedAt, mode: entry.mode });
        return;
      } catch (error) {
        const decision = await this.classify(error);
        if (decision === 'retry') continue;
        if (decision === 'not_found') await this.options.store.markHydrationOutcome(providerMatchId, 'unavailable', 'provider_404');
        else if (decision === 'item_failed') await this.options.store.markHydrationOutcome(providerMatchId, 'failed', 'malformed_or_4xx');
        return;
      }
    }
  }
}
