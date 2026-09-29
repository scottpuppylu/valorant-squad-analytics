import { PublicApiError } from './errors.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const windowMs = 60_000;
const defaultMaximumRequests = 10;

export function enforceRateLimit(key: string, now = Date.now(), maximumRequests = defaultMaximumRequests): void {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= maximumRequests) {
    throw new PublicApiError(429, 'RATE_LIMITED', '請求次數過多，請稍後再試。');
  }
  current.count += 1;
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
