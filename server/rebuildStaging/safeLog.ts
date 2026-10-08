/**
 * Sanitized collector events: counts, booleans, durations and short enum labels ONLY. Riot IDs, provider
 * account ids, match ids, keys and URLs can never be logged — any string that is not a short lowercase
 * label (or that looks like an identifier) is refused, so a logging mistake fails loudly instead of leaking.
 */
export type SafeValue = number | boolean | null;
export type SafeFields = Record<string, SafeValue | string | Record<string, number>>;

const LABEL = /^[a-z][a-z0-9_:.-]{0,47}$/u;
const IDENTIFIER_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}|[0-9a-f]{24,}|hdev|#|@|\/|https?:/iu;

export class UnsafeLogError extends Error {
  constructor(field: string) { super(`refusing to log a non-label value in field "${field}".`); this.name = 'UnsafeLogError'; }
}

function assertSafe(field: string, value: unknown): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new UnsafeLogError(field); return; }
  if (typeof value === 'string') {
    if (!LABEL.test(value) || IDENTIFIER_LIKE.test(value)) throw new UnsafeLogError(field);
    return;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (!LABEL.test(key) || typeof inner !== 'number' || !Number.isFinite(inner)) throw new UnsafeLogError(`${field}.${key}`);
    }
    return;
  }
  throw new UnsafeLogError(field);
}

export function sanitizedEvent(event: string, fields: SafeFields = {}): string {
  assertSafe('event', event);
  for (const [key, value] of Object.entries(fields)) {
    if (!LABEL.test(key)) throw new UnsafeLogError(key);
    assertSafe(key, value);
  }
  return JSON.stringify({ event, at: new Date().toISOString(), ...fields });
}

export type EventSink = (line: string) => void;
export const stdoutSink: EventSink = (line) => { process.stdout.write(`${line}\n`); };
