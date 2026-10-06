/**
 * bulk-history-v1 (TASK-DATA-BULK-01): deterministic, resumable orchestration of the EXISTING
 * account-scoped deep_backfill engine through its public routes (sync/start, sync/continue,
 * sync/status). Pure module: no Node APIs, no network, no secrets — transport and clock are injected.
 *
 * The server cursor is the only authority. This controller never computes nextStart/storedPage/
 * storedItemIndex; it only decides WHICH account to invoke next and WHEN:
 *  - at most `lanes` accounts in flight, and never two requests for one account;
 *  - round-robin over eligible accounts (backoff/busy accounts are skipped, not waited on);
 *  - a GLOBAL provider-request budget (rolling 60 s window + launch spacing), reserving 2 provider
 *    requests for stored_index/unknown-phase chunks and 1 for live_v4 chunks;
 *  - per-route HTTP ceilings below the application's own per-IP limits;
 *  - hard session limits (provider requests, HTTP requests, minutes).
 * Never used by src/ or api/.
 */
export const BULK_HISTORY_VERSION = 'bulk-history-v1' as const;

export type RunStatus = 'pending' | 'running' | 'paused' | 'complete' | 'failed' | 'cancelled';
export interface PublicSyncLike {
  runId: string;
  kind: string;
  status: RunStatus;
  history?: { historyPhase: 'live_v4' | 'stored_index' | 'complete'; storedTotal?: number; storedPage?: number; sourceExhausted: boolean; lifetimeComplete: false };
  progress: { pages: number; matchesSeen: number; matchesPersisted: number; overlapsUpdated: number; retries: number; storedMatchesSeen?: number; detailRequests?: number };
  coverage: { from?: string; to?: string; lastSyncedAt?: string; completeForProviderWindow: boolean; incompleteReason?: string };
  terminationReason?: string;
  lastErrorCategory?: string;
  nextAttemptAt?: string;
  performance: { providerFetchMs: number; normalizationMs: number; databaseMs: number; totalMs: number; sqlQueryCount: number; providerRequests: number };
}
export type SyncCallResult = { ok: true; sync: PublicSyncLike } | { ok: false; httpStatus: number; code: string };
export type Route = 'start' | 'continue' | 'status';

export interface BulkTransport {
  start(accountId: string): Promise<SyncCallResult>;
  continue(runId: string): Promise<SyncCallResult>;
  status(runId: string): Promise<SyncCallResult>;
}
export interface Waiter { promise: Promise<void>; cancel(): void }
export interface BulkClock { now(): number; wait(ms: number): Waiter }

export interface BulkAccount { accountId: string; memberId: string; memberName: string; riotId: string; isPrimary: boolean; label?: string }

export interface BulkConfig {
  lanes: number;
  providerRpm: number;
  maxProviderRequests: number;
  maxHttpRequests?: number;
  maxMinutes?: number;
  /** Ceilings kept strictly below the routes' own per-IP limits (start 6, continue 10, status 30 per minute). */
  routeLimitsPerMinute: Record<Route, number>;
  lockBusyRetryMs: number;
  /** Local wait after SYNC_BACKOFF when the run id (and so its nextAttemptAt) is not yet known. */
  unknownBackoffRetryMs: number;
  rateLimitCooldownMs: number;
  stopOnRateLimit: boolean;
  /** A chunk whose server-measured total exceeds this stops the session (useful-work boundary). */
  maxChunkMs: number;
  maxConsecutiveProviderErrors: number;
}

export const defaultBulkConfig: Omit<BulkConfig, 'maxProviderRequests'> = {
  lanes: 1,
  providerRpm: 8,
  routeLimitsPerMinute: { start: 5, continue: 9, status: 20 },
  lockBusyRetryMs: 60_000,
  unknownBackoffRetryMs: 300_000,
  rateLimitCooldownMs: 120_000,
  stopOnRateLimit: false,
  maxChunkMs: 25_000,
  maxConsecutiveProviderErrors: 2,
};

export type AccountState = 'ready' | 'busy' | 'backoff' | 'complete' | 'failed' | 'revoked';
interface Counters { pages: number; seen: number; persisted: number; overlaps: number; providerRequests: number; providerFetchMs: number; databaseMs: number; totalMs: number }

export interface AccountTelemetry extends BulkAccount {
  state: AccountState;
  runId?: string;
  phase?: string;
  eligibleAt: number;
  needsStatus: boolean;
  nextAttemptAt?: string;
  lastErrorCategory?: string;
  terminationReason?: string;
  sourceExhausted: boolean;
  storedTotal?: number;
  coverageFrom?: string;
  coverageTo?: string;
  /** Last cumulative server counters of the current run (undefined until observed). */
  baseline?: Counters;
  session: Counters & { chunks: number; httpRequests: number; unmeasuredProviderRequests: number; maxChunkMs: number };
}

export interface BulkEvent {
  type: 'launch' | 'result' | 'error' | 'stop';
  at: number;
  accountId?: string;
  route?: Route;
  cost?: number;
  code?: string;
  reason?: string;
}

export interface PersistedAccountState { runId?: string; state?: AccountState; phase?: string; observedAt?: string }
export interface PersistedBulkState { version: typeof BULK_HISTORY_VERSION; baseUrl: string; savedAt: string; accounts: Record<string, PersistedAccountState> }

export interface BulkSummary {
  version: typeof BULK_HISTORY_VERSION;
  stopReason: string;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  lanes: number;
  providerRpm: number;
  providerRequests: number;
  measuredProviderRequests: number;
  unmeasuredProviderRequests: number;
  httpRequests: Record<Route, number>;
  chunks: number;
  matchesSeen: number;
  persistedObservations: number;
  overlaps: number;
  providerFetchMs: number;
  databaseMs: number;
  serverTotalMs: number;
  maxChunkMs: number;
  counts: Record<AccountState, number>;
  sourceExhausted: number;
  errors: Record<string, number>;
  accounts: AccountTelemetry[];
  lifetimeComplete: false;
}

const zero = (): Counters => ({ pages: 0, seen: 0, persisted: 0, overlaps: 0, providerRequests: 0, providerFetchMs: 0, databaseMs: 0, totalMs: 0 });
const countersOf = (sync: PublicSyncLike): Counters => ({
  pages: sync.progress.pages, seen: sync.progress.matchesSeen, persisted: sync.progress.matchesPersisted, overlaps: sync.progress.overlapsUpdated,
  providerRequests: sync.performance.providerRequests, providerFetchMs: sync.performance.providerFetchMs, databaseMs: sync.performance.databaseMs, totalMs: sync.performance.totalMs,
});
/** Errors raised by the server before any provider work (cost 0). Everything else is charged conservatively. */
const zeroCostErrors = new Set(['LOCK_BUSY', 'SYNC_BACKOFF', 'SYNC_NOT_FOUND', 'BAD_REQUEST']);

export class BulkController {
  readonly accounts: AccountTelemetry[];
  private readonly config: BulkConfig;
  private pointer = 0;
  private readonly inFlight = new Map<string, Promise<void>>();
  /** Provider reservations/usage in time order (rolling-window budget). */
  private readonly ledger: { at: number; cost: number }[] = [];
  private readonly routeCalls: Record<Route, number[]> = { start: [], continue: [], status: [] };
  private readonly routeTotals: Record<Route, number> = { start: 0, continue: 0, status: 0 };
  private nextLaunchAt = 0;
  private cooldownUntil = 0;
  private reservedInFlight = 0;
  private providerCharged = 0;
  private measuredProvider = 0;
  private unmeasuredProvider = 0;
  private httpCount = 0;
  private consecutiveProviderErrors = 0;
  private stopReason?: string;
  private startedAt = 0;
  private readonly errors: Record<string, number> = {};
  private interrupt?: () => void;

  constructor(accounts: BulkAccount[], private readonly transport: BulkTransport, private readonly clock: BulkClock,
    config: Partial<BulkConfig> & { maxProviderRequests: number }, restored?: PersistedBulkState, private readonly onEvent: (event: BulkEvent) => void = () => undefined) {
    this.config = { ...defaultBulkConfig, ...config, routeLimitsPerMinute: { ...defaultBulkConfig.routeLimitsPerMinute, ...config.routeLimitsPerMinute } };
    if (!(this.config.lanes >= 1 && this.config.lanes <= 2)) throw new Error('lanes must be 1 or 2.');
    if (!(this.config.providerRpm > 0 && this.config.providerRpm <= 8)) throw new Error('provider-rpm must be in (0, 8].');
    if (!(Number.isFinite(this.config.maxProviderRequests) && this.config.maxProviderRequests >= 0)) throw new Error('A finite max provider request budget is required.');
    const seen = new Set<string>();
    this.accounts = accounts.filter((account) => (seen.has(account.accountId) ? false : (seen.add(account.accountId), true))).map((account) => {
      const saved = restored?.accounts[account.accountId];
      // Local state is only an optimization: a saved run id is re-verified with a status read.
      return { ...account, state: 'ready' as const, eligibleAt: 0, needsStatus: Boolean(saved?.runId), sourceExhausted: false,
        ...(saved?.runId ? { runId: saved.runId } : {}), ...(saved?.phase ? { phase: saved.phase } : {}),
        session: { ...zero(), chunks: 0, httpRequests: 0, unmeasuredProviderRequests: 0, maxChunkMs: 0 } };
    });
  }

  /** Graceful stop (e.g. SIGINT): no new launches; in-flight requests are allowed to finish. */
  stop(reason = 'interrupted'): void {
    this.stopReason ??= reason;
    this.interrupt?.();
  }

  snapshot(baseUrl: string): PersistedBulkState {
    return { version: BULK_HISTORY_VERSION, baseUrl, savedAt: new Date(this.clock.now()).toISOString(),
      accounts: Object.fromEntries(this.accounts.map((a) => [a.accountId, { ...(a.runId ? { runId: a.runId } : {}), state: a.state, ...(a.phase ? { phase: a.phase } : {}), observedAt: new Date(this.clock.now()).toISOString() }])) };
  }

  async run(): Promise<BulkSummary> {
    this.startedAt = this.clock.now();
    for (;;) {
      const now = this.clock.now();
      if (this.config.maxMinutes !== undefined && now - this.startedAt >= this.config.maxMinutes * 60_000) this.stopReason ??= 'max_minutes';
      if (!this.stopReason) {
        const launched = this.tryLaunch(now);
        if (launched) continue;
      }
      const active = this.accounts.some((a) => this.isActive(a));
      if (this.inFlight.size === 0) {
        if (this.stopReason) break;
        if (!active) { this.stopReason = 'all_accounts_terminal'; break; }
        if (this.budgetExhausted()) { this.stopReason = 'max_provider_requests'; break; }
        if (this.config.maxHttpRequests !== undefined && this.httpCount >= this.config.maxHttpRequests) { this.stopReason = 'max_http_requests'; break; }
      }
      const wakeAt = this.stopReason ? undefined : this.nextWakeAt(now);
      if (!this.stopReason && this.inFlight.size === 0 && wakeAt === undefined) {
        // Nothing can ever launch again (e.g. remaining budget < the next reservation): stop, never hang.
        const remaining = this.config.maxProviderRequests - this.providerCharged;
        this.stopReason = this.accounts.some((a) => this.isActive(a) && this.costFor(a) > remaining) ? 'max_provider_requests' : 'no_progress_possible';
        continue;
      }
      const waiter = wakeAt === undefined ? undefined : this.clock.wait(Math.max(0, wakeAt - now));
      const interrupted = new Promise<void>((resolve) => { this.interrupt = resolve; });
      await Promise.race([...this.inFlight.values(), interrupted, ...(waiter ? [waiter.promise] : [])]);
      waiter?.cancel();
    }
    return this.summary();
  }

  private isActive(account: AccountTelemetry): boolean {
    return account.state === 'ready' || account.state === 'busy' || account.state === 'backoff';
  }

  private budgetExhausted(): boolean {
    return this.providerCharged + this.reservedInFlight + 1 > this.config.maxProviderRequests;
  }

  private costFor(account: AccountTelemetry): number {
    if (account.needsStatus && account.runId) return 0;
    return account.phase === 'live_v4' ? 1 : 2;
  }

  private routeFor(account: AccountTelemetry): Route {
    if (account.needsStatus && account.runId) return 'status';
    return account.runId ? 'continue' : 'start';
  }

  private windowCost(now: number): number {
    while (this.ledger.length && this.ledger[0]!.at <= now - 60_000) this.ledger.shift();
    return this.ledger.reduce((sum, entry) => sum + entry.cost, 0);
  }

  private routeOk(route: Route, now: number): boolean {
    const calls = this.routeCalls[route];
    while (calls.length && calls[0]! <= now - 60_000) calls.shift();
    return calls.length < this.config.routeLimitsPerMinute[route];
  }

  /** Round-robin: the first eligible, idle account at or after the pointer. */
  private pick(now: number): AccountTelemetry | undefined {
    const n = this.accounts.length;
    for (let step = 0; step < n; step += 1) {
      const index = (this.pointer + step) % n;
      const account = this.accounts[index]!;
      if (!this.isActive(account) || account.eligibleAt > now || this.inFlight.has(account.accountId)) continue;
      return account;
    }
    return undefined;
  }

  private tryLaunch(now: number): boolean {
    if (this.inFlight.size >= this.config.lanes) return false;
    if (this.config.maxHttpRequests !== undefined && this.httpCount >= this.config.maxHttpRequests) return false;
    const account = this.pick(now);
    if (!account) return false;
    const cost = this.costFor(account);
    const route = this.routeFor(account);
    if (!this.routeOk(route, now)) return false;
    if (cost > 0) {
      if (now < this.cooldownUntil || now < this.nextLaunchAt) return false;
      if (this.windowCost(now) + cost > this.config.providerRpm) return false;
      if (this.providerCharged + this.reservedInFlight + cost > this.config.maxProviderRequests) return false;
    }
    this.pointer = (this.accounts.indexOf(account) + 1) % this.accounts.length;
    this.launch(account, route, cost, now);
    return true;
  }

  private nextWakeAt(now: number): number | undefined {
    const candidates: number[] = [];
    for (const account of this.accounts) if (this.isActive(account) && !this.inFlight.has(account.accountId) && account.eligibleAt > now) candidates.push(account.eligibleAt);
    if (this.cooldownUntil > now) candidates.push(this.cooldownUntil);
    if (this.nextLaunchAt > now) candidates.push(this.nextLaunchAt);
    if (this.ledger.length) candidates.push(this.ledger[0]!.at + 60_000);
    for (const route of ['start', 'continue', 'status'] as const) if (this.routeCalls[route].length) candidates.push(this.routeCalls[route][0]! + 60_000);
    if (this.config.maxMinutes !== undefined) candidates.push(this.startedAt + this.config.maxMinutes * 60_000);
    const future = candidates.filter((at) => at > now);
    return future.length ? Math.min(...future) : undefined;
  }

  private launch(account: AccountTelemetry, route: Route, cost: number, now: number): void {
    const entry = { at: now, cost };
    if (cost > 0) {
      this.ledger.push(entry);
      this.reservedInFlight += cost;
      this.nextLaunchAt = now + (cost * 60_000) / this.config.providerRpm;
    }
    this.routeCalls[route].push(now);
    this.routeTotals[route] += 1;
    this.httpCount += 1;
    account.session.httpRequests += 1;
    this.onEvent({ type: 'launch', at: now, accountId: account.accountId, route, cost });
    const call = route === 'status' ? this.transport.status(account.runId!) : route === 'continue' ? this.transport.continue(account.runId!) : this.transport.start(account.accountId);
    const done = call.catch((): SyncCallResult => ({ ok: false, httpStatus: 0, code: 'NETWORK_ERROR' })).then((result) => {
      this.reservedInFlight -= cost;
      this.settle(account, route, cost, entry, result);
    }).finally(() => { this.inFlight.delete(account.accountId); });
    this.inFlight.set(account.accountId, done);
  }

  private charge(account: AccountTelemetry, entry: { at: number; cost: number }, reserved: number, actual: number | undefined): void {
    const used = actual === undefined ? reserved : Math.min(actual, reserved);
    if (actual === undefined && reserved > 0) { this.unmeasuredProvider += reserved; account.session.unmeasuredProviderRequests += reserved; }
    else this.measuredProvider += used;
    this.providerCharged += used;
    account.session.providerRequests += used;
    // Unused reserved capacity is returned to the rolling window and the launch spacing.
    if (used < reserved) {
      entry.cost = used;
      this.nextLaunchAt = Math.max(this.clock.now(), entry.at + (used * 60_000) / this.config.providerRpm);
    }
  }

  private settle(account: AccountTelemetry, route: Route, cost: number, entry: { at: number; cost: number }, result: SyncCallResult): void {
    const now = this.clock.now();
    if (!result.ok) {
      this.errors[result.code] = (this.errors[result.code] ?? 0) + 1;
      this.charge(account, entry, cost, zeroCostErrors.has(result.code) ? 0 : undefined);
      this.onEvent({ type: 'error', at: now, accountId: account.accountId, route, code: result.code });
      this.applyError(account, route, result.code, now);
      return;
    }
    const sync = result.sync;
    const counters = countersOf(sync);
    const sameRun = account.runId === sync.runId && account.baseline !== undefined;
    // A first response for a pre-existing run has no baseline: its delta is unmeasurable and is charged at the reservation.
    const newRunFirstPage = !sameRun && route === 'start' && sync.progress.pages <= 1 && counters.providerRequests <= cost;
    const delta = sameRun ? this.diff(counters, account.baseline!) : newRunFirstPage ? counters : undefined;
    this.charge(account, entry, cost, route === 'status' ? 0 : delta?.providerRequests);
    if (delta && route !== 'status') {
      const s = account.session;
      s.seen += delta.seen; s.persisted += delta.persisted; s.overlaps += delta.overlaps; s.pages += delta.pages;
      s.providerFetchMs += delta.providerFetchMs; s.databaseMs += delta.databaseMs; s.totalMs += delta.totalMs;
      if (delta.pages > 0) s.chunks += delta.pages;
      s.maxChunkMs = Math.max(s.maxChunkMs, delta.totalMs);
      if (delta.totalMs > this.config.maxChunkMs) this.stopReason ??= 'chunk_latency';
    } else if (route !== 'status') {
      account.session.chunks += 1;
    }
    if (route !== 'status' && (delta?.pages ?? 1) > 0) this.consecutiveProviderErrors = 0;
    account.runId = sync.runId;
    account.baseline = counters;
    account.needsStatus = false;
    account.phase = sync.history?.historyPhase ?? account.phase;
    account.storedTotal = sync.history?.storedTotal;
    account.sourceExhausted = sync.history?.sourceExhausted === true;
    account.terminationReason = sync.terminationReason;
    account.lastErrorCategory = sync.lastErrorCategory;
    account.nextAttemptAt = sync.nextAttemptAt;
    account.coverageFrom = sync.coverage.from;
    account.coverageTo = sync.coverage.to;
    this.onEvent({ type: 'result', at: now, accountId: account.accountId, route });
    const nextAttempt = sync.nextAttemptAt ? Date.parse(sync.nextAttemptAt) : Number.NaN;
    if (sync.status === 'complete') { account.state = 'complete'; return; }
    if (sync.status === 'cancelled') { account.state = 'revoked'; return; }
    if (sync.status === 'failed') { account.state = 'failed'; return; }
    if (sync.status === 'running') { account.state = 'busy'; account.eligibleAt = now + this.config.lockBusyRetryMs; return; }
    if (Number.isFinite(nextAttempt) && nextAttempt > now) { account.state = 'backoff'; account.eligibleAt = nextAttempt; return; }
    account.state = 'ready';
    account.eligibleAt = now;
  }

  private diff(a: Counters, b: Counters): Counters {
    return { pages: a.pages - b.pages, seen: a.seen - b.seen, persisted: a.persisted - b.persisted, overlaps: a.overlaps - b.overlaps,
      providerRequests: a.providerRequests - b.providerRequests, providerFetchMs: a.providerFetchMs - b.providerFetchMs, databaseMs: a.databaseMs - b.databaseMs, totalMs: a.totalMs - b.totalMs };
  }

  private applyError(account: AccountTelemetry, route: Route, code: string, now: number): void {
    switch (code) {
      case 'LOCK_BUSY':
        account.state = 'busy'; account.eligibleAt = now + this.config.lockBusyRetryMs; return;
      case 'SYNC_BACKOFF':
        // Rejected before provider work. With a known run id, read the durable nextAttemptAt (cost 0);
        // a start that resumed an unknown backed-off run exposes no id, so wait locally instead of polling.
        account.state = 'backoff';
        if (account.runId) { account.needsStatus = true; account.eligibleAt = now; } else account.eligibleAt = now + this.config.unknownBackoffRetryMs;
        return;
      case 'RATE_LIMITED':
        this.cooldownUntil = Math.max(this.cooldownUntil, now + this.config.rateLimitCooldownMs);
        account.state = 'backoff'; account.needsStatus = Boolean(account.runId); account.eligibleAt = this.cooldownUntil;
        if (this.config.stopOnRateLimit) this.stopReason ??= 'rate_limited';
        return;
      case 'PROVIDER_TIMEOUT':
      case 'PROVIDER_ERROR':
        this.consecutiveProviderErrors += 1;
        account.state = 'backoff'; account.needsStatus = Boolean(account.runId); account.eligibleAt = now + 60_000;
        if (this.consecutiveProviderErrors >= this.config.maxConsecutiveProviderErrors) this.stopReason ??= 'repeated_provider_errors';
        return;
      case 'DATABASE_ERROR':
        account.state = 'failed'; account.lastErrorCategory = code; this.stopReason ??= 'database_error'; return;
      case 'MALFORMED_PROVIDER_RESPONSE':
        account.state = 'failed'; account.lastErrorCategory = code; return;
      case 'CONSENT_REVOKED':
        account.state = 'revoked'; account.lastErrorCategory = code; return;
      case 'SYNC_NOT_FOUND':
        if (route !== 'start' && account.runId) { delete account.runId; delete account.baseline; account.needsStatus = false; account.state = 'ready'; account.eligibleAt = now; return; }
        account.state = 'revoked'; account.lastErrorCategory = code; return;
      default:
        // Network failure, non-JSON or unexpected 5xx: possibly shared — stop the whole session.
        account.state = 'failed'; account.lastErrorCategory = code; this.stopReason ??= 'unexpected_response';
    }
  }

  summary(): BulkSummary {
    const now = this.clock.now();
    const sum = (key: keyof Counters) => this.accounts.reduce((total, a) => total + a.session[key], 0);
    const counts: Record<AccountState, number> = { ready: 0, busy: 0, backoff: 0, complete: 0, failed: 0, revoked: 0 };
    for (const account of this.accounts) counts[account.state] += 1;
    return {
      version: BULK_HISTORY_VERSION, stopReason: this.stopReason ?? 'running',
      startedAt: new Date(this.startedAt).toISOString(), endedAt: new Date(now).toISOString(), elapsedMs: now - this.startedAt,
      lanes: this.config.lanes, providerRpm: this.config.providerRpm,
      providerRequests: this.providerCharged, measuredProviderRequests: this.measuredProvider, unmeasuredProviderRequests: this.unmeasuredProvider,
      httpRequests: { ...this.routeTotals },
      chunks: this.accounts.reduce((total, a) => total + a.session.chunks, 0),
      matchesSeen: sum('seen'), persistedObservations: sum('persisted'), overlaps: sum('overlaps'),
      providerFetchMs: sum('providerFetchMs'), databaseMs: sum('databaseMs'), serverTotalMs: sum('totalMs'),
      maxChunkMs: Math.max(0, ...this.accounts.map((a) => a.session.maxChunkMs)),
      counts, sourceExhausted: this.accounts.filter((a) => a.sourceExhausted).length,
      errors: { ...this.errors }, accounts: this.accounts.map((a) => ({ ...a, session: { ...a.session } })), lifetimeComplete: false,
    };
  }

}
