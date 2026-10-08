/**
 * Provider rate ceiling for the private rebuild collector: at most REBUILD_MAX_REQUESTS_PER_WINDOW request
 * STARTS in any rolling REBUILD_WINDOW_MS window, shared by every lane. The ceiling is a hard constant: a
 * caller may configure a LOWER rate, never a higher one (no rate experiment is possible through this class).
 */
export const REBUILD_MAX_REQUESTS_PER_WINDOW = 6;
export const REBUILD_WINDOW_MS = 60_000;
export const REBUILD_MAX_LANES = 2;
/**
 * Extra spacing beyond the 60 s window: the slot time and the moment a request is really sent can differ by
 * event-loop jitter (observed up to ~0.6 s while another lane persisted a large page), so slots are spaced by
 * 61 s per 6 to keep any TRUE 60 s window at <= 6 starts.
 */
export const REBUILD_WINDOW_GUARD_MS = 1_000;

export interface RollingWindowLimiterOptions {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class RollingWindowLimiter {
  readonly maxRequests: number;
  readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  private maxObserved = 0;
  private total = 0;

  constructor(options: RollingWindowLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? REBUILD_MAX_REQUESTS_PER_WINDOW;
    this.windowMs = options.windowMs ?? REBUILD_WINDOW_MS;
    if (!Number.isSafeInteger(this.maxRequests) || this.maxRequests < 1 || this.maxRequests > REBUILD_MAX_REQUESTS_PER_WINDOW) {
      throw new Error(`rebuild provider rate must be 1..${REBUILD_MAX_REQUESTS_PER_WINDOW} requests per window.`);
    }
    if (this.windowMs < REBUILD_WINDOW_MS) throw new Error('rebuild provider window may not be shorter than 60 s.');
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private pausedUntil = 0;

  /** Provider-requested pause (its rate-limit headers report a nearly exhausted budget). Only ever slows down. */
  pauseFor(milliseconds: number): void {
    if (Number.isFinite(milliseconds) && milliseconds > 0) this.pausedUntil = Math.max(this.pausedUntil, this.now() + Math.min(milliseconds, 5 * 60_000));
  }

  /** Resolves (with the reserved slot time) when one more request may START. Served strictly in arrival order. */
  acquire(): Promise<number> {
    const turn = this.queue.then(async () => {
      for (;;) {
        if (this.now() < this.pausedUntil) { await this.sleep(this.pausedUntil - this.now()); continue; }
        const at = this.now();
        const span = this.windowMs + REBUILD_WINDOW_GUARD_MS;
        while (this.starts.length > 0 && this.starts[0]! <= at - span) this.starts.shift();
        if (this.starts.length < this.maxRequests) {
          this.starts.push(at);
          this.total += 1;
          this.maxObserved = Math.max(this.maxObserved, this.starts.length);
          return at;
        }
        await this.sleep(this.starts[0]! + span - at + 1);
      }
    });
    this.queue = turn.then(() => undefined, () => undefined);
    return turn;
  }

  /**
   * Seeds request starts made by EARLIER processes (from the persisted request log), so a resumed run can never
   * exceed the ceiling across a process restart. Only starts inside the current window matter.
   */
  seed(startTimesMs: readonly number[]): void {
    const at = this.now();
    const recent = startTimesMs.filter((start) => start > at - this.windowMs - REBUILD_WINDOW_GUARD_MS && start <= at).sort((a, b) => a - b);
    this.starts.push(...recent);
    this.starts.sort((a, b) => a - b);
    this.maxObserved = Math.max(this.maxObserved, this.starts.length);
  }

  /** Highest number of request starts observed inside one rolling window (== max observed RPM for 60 s). */
  maxObservedInWindow(): number { return this.maxObserved; }
  currentInWindow(): number {
    const at = this.now();
    return this.starts.filter((start) => start > at - this.windowMs).length;
  }
  totalStarted(): number { return this.total; }
}

/** Runs `work` over `items` with at most `lanes` concurrent workers (never more than REBUILD_MAX_LANES). */
export async function runLanes<T>(items: readonly T[], lanes: number, work: (item: T) => Promise<void>, shouldStop: () => boolean = () => false): Promise<void> {
  if (!Number.isSafeInteger(lanes) || lanes < 1 || lanes > REBUILD_MAX_LANES) throw new Error(`lanes must be 1..${REBUILD_MAX_LANES}.`);
  let next = 0;
  const worker = async () => {
    while (!shouldStop()) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, worker));
}
