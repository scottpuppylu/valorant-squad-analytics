import { HenrikDataProvider } from '../henrikDataProvider.js';
import type { RollingWindowLimiter } from './rateLimiter.js';

/**
 * The ONE provider path of the private rebuild collector: the existing Henrik client with retries disabled,
 * whose every real HTTP fetch first waits for the shared rolling-window limiter (so retries can never add
 * unmetered requests) and is then recorded as a sanitized accounting row (category + status class only).
 */
export type RequestCategory = 'account' | 'discovery_live' | 'discovery_stored' | 'detail' | 'mmr' | 'other';
export type RequestOutcome = 'ok' | 'http_429' | 'http_4xx' | 'http_5xx' | 'timeout';
/** Numeric provider rate-limit headers (diagnostics only; never identifiers). */
export interface RateLimitHeaders { limit: number | null; remaining: number | null; reset: number | null }
export interface RequestRecord { at: string; category: RequestCategory; httpStatus: number | null; outcome: RequestOutcome; durationMs: number; rateLimit?: RateLimitHeaders }

const headerNumber = (headers: Headers, names: readonly string[]) => {
  for (const name of names) {
    const value = Number(headers.get(name));
    if (headers.get(name) !== null && Number.isFinite(value) && value >= 0) return Math.round(value);
  }
  return null;
};
export function rateLimitHeaders(headers: Headers): RateLimitHeaders | undefined {
  const parsed = {
    limit: headerNumber(headers, ['x-ratelimit-limit', 'ratelimit-limit']),
    remaining: headerNumber(headers, ['x-ratelimit-remaining', 'ratelimit-remaining']),
    reset: headerNumber(headers, ['x-ratelimit-reset', 'ratelimit-reset', 'retry-after']),
  };
  return parsed.limit === null && parsed.remaining === null && parsed.reset === null ? undefined : parsed;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function requestCategory(url: string | URL): RequestCategory {
  const path = new URL(String(url)).pathname;
  if (/^\/valorant\/v[12]\/account\//u.test(path)) return 'account';
  if (/^\/valorant\/v1\/stored-matches\//u.test(path)) return 'discovery_stored';
  if (/^\/valorant\/v4\/matches\//u.test(path)) return 'discovery_live';
  if (/^\/valorant\/v4\/match\//u.test(path)) return 'detail';
  if (/mmr/u.test(path)) return 'mmr';
  return 'other';
}

export function outcomeOf(status: number | null): RequestOutcome {
  if (status === null) return 'timeout';
  if (status === 429) return 'http_429';
  if (status >= 500) return 'http_5xx';
  if (status >= 400) return 'http_4xx';
  return 'ok';
}

export interface GatewayOptions {
  apiKey: string;
  limiter: RollingWindowLimiter;
  record: (request: RequestRecord) => Promise<void> | void;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

/** Upper bound for one queued + executed call (limiter waits + a provider-requested pause of ≤ 5 min). */
export const CLIENT_QUEUE_GUARD_MS = 15 * 60_000;
/** Pause until the provider's reset when its reported remaining budget is at or below this. */
export const PROVIDER_REMAINING_FLOOR = 4;

export function createRebuildProvider(options: GatewayOptions): HenrikDataProvider {
  const base = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? 20_000;
  const limitedFetch: FetchLike = async (input, init) => {
    const slot = await options.limiter.acquire();
    // The request timeout starts only when the request really starts: time spent queued in the limiter must
    // never count against it (the client's own timer starts before this function and is therefore disabled).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    // Record the reserved slot time: the persisted log then shows exactly what the ceiling governed.
    const startedAt = new Date(slot).toISOString();
    const category = requestCategory(input);
    let status: number | null = null;
    let rateLimit: RateLimitHeaders | undefined;
    try {
      const response = await base(input, { ...init, signal: controller.signal });
      status = response.status;
      rateLimit = rateLimitHeaders(response.headers);
      // Henrik charges some endpoints more than one unit: when the provider's own budget is nearly spent, wait
      // for its reset before the next start (this can only lower the rate, never raise it).
      if (rateLimit && rateLimit.remaining !== null && rateLimit.remaining <= PROVIDER_REMAINING_FLOOR) {
        options.limiter.pauseFor(((rateLimit.reset ?? 60) + 1) * 1000);
      }
      return response;
    } finally {
      clearTimeout(timer);
      await options.record({ at: startedAt, category, httpStatus: status, outcome: outcomeOf(status), durationMs: Math.max(0, Math.round(now() - started)),
        ...(rateLimit ? { rateLimit } : {}) });
    }
  };
  // retries: 0 → one logical call == one metered fetch; the collector owns retry/backoff decisions.
  // The client timer only guards a stuck limiter queue (it starts before the queue wait), so it is generous.
  return new HenrikDataProvider(options.apiKey, { fetchImpl: limitedFetch, retries: 0, timeoutMs: CLIENT_QUEUE_GUARD_MS });
}
