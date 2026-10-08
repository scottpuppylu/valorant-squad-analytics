# Database portability — TASK-INFRA-DATABASE-PORTABILITY-01

**Principle:** PostgreSQL is the persistence contract. Application business logic MUST NOT depend on a
proprietary database provider SDK. Replacing the PostgreSQL host requires changing `DATABASE_URL`, nothing else.

## Before → after

| | Before | After |
|---|---|---|
| Driver | `@neondatabase/serverless` (`NeonDatabase`, `server/db/neon.ts`) | Standard `pg` (node-postgres) — `server/db/postgres.ts` `PostgresDatabase` |
| Factory | `createNeonDatabase()` in 5 runtimes + 6 scripts | `server/db/runtime.ts`: `createDatabase()` (caller-owned, scripts) and `getSharedDatabase()` (one bounded pool per process, runtimes) |
| Configuration | `DATABASE_URL` | `DATABASE_URL` only (optional `DATABASE_POOL_MAX` ≤ 20, `DATABASE_STATEMENT_TIMEOUT_MS`) |
| Provider SDK in `package.json` | yes | **removed** |
| Schema / migrations | 0001–0011 | **unchanged** |

The application contract is unchanged: `SqlDatabase` (`query`, `transaction`, `close`) in `server/db/types.ts`.
PGlite (real PostgreSQL compiled to WASM) remains for tests and local deterministic validation only, and is
never a Production dependency. That is guarded by a test.

## Pool

`DEFAULT_POOL_OPTIONS`: `max` 8, `idleTimeoutMillis` 30 s, `connectionTimeoutMillis` 10 s, server-side
`statement_timeout` 55 s and `application_name`. These fit a 9-account private community plus bounded jobs.

- Runtimes share **one** pool per process; previously each factory opened its own.
- Pool idle errors are counted, not fatal.
- A failed `ROLLBACK` destroys the client instead of returning it to the pool.
- `stats()` exposes identifier-free counters: queries, transactions, rollbacks, rows returned, rows affected,
  errors and pool sizes.

## Contract verification

| Suite | Runs | Covers |
|---|---|---|
| `tests/databasePortability.test.ts` — PGlite | CI | Parameterized query, rowCount, `json` key order, `jsonb`, `timestamptz` + `interval`, `numeric`, `ON CONFLICT`, unique violation SQLSTATE `23505`, commit/rollback, handle reuse after rollback, `pg_try_advisory_xact_lock`, all migrations idempotent |
| Same suite — `PostgresDatabase` over real PostgreSQL | **requires-real-postgres** (`TEST_DATABASE_URL` → disposable DB; run by `infra/rehearsal/rehearse-migration.sh`) | Same, through the Production adapter |
| `PostgresDatabase` with mocked `pg` | CI | Bounded pool options, BEGIN/COMMIT/ROLLBACK order, single release, destroy-on-failed-rollback, error propagation, counters, `close`, `DATABASE_POOL_MAX` bound |
| `tests/databaseArchitecture.test.ts` | CI | No provider SDK / Neon factory in runtime code; `pg` only in the adapter; PGlite never in runtime; small pool; locality and secret guards for the deployment assets |

## Legacy contract labels

The public dataset contract still carries `snapshot.source: 'durable-neon'` and `sourceId: 'durable-neon-v4'`.
These are **opaque wire values** that the client validator (`src/dataSources/server/datasetContract.ts`) checks,
not a dependency. Renaming them would be a breaking public-contract change for no runtime benefit, so they stay
until a separately versioned contract bump.

**Rehearsal status (2026-10-07):** the real-PostgreSQL suite PASSES on PostgreSQL 16.15 (WSL Docker Engine,
TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01). See [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md).

## Transition

Vercel functions now use the same `pg` driver. Neon accepts standard PostgreSQL TCP/TLS through its connection
string, so the current Production keeps working until cutover. See
[PRODUCTION_MIGRATION_RUNBOOK.md](PRODUCTION_MIGRATION_RUNBOOK.md).
