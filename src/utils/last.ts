/**
 * The last element of `items`, or `undefined` for an empty array — the exact semantics of `items.at(-1)`.
 *
 * TASK-RELEASE-PRODUCTION-BUILD-HARDENING-01: Vercel's function bundler type-checks with the root solution-style
 * tsconfig (no compilerOptions → ES2021 lib), where `Array.prototype.at` (ES2022) is reported as TS2550. Index access is
 * supported by every lib target, so runtime code reachable from API functions uses this helper instead.
 */
export function last<T>(items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[items.length - 1];
}
