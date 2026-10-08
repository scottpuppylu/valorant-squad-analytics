# Database operations — backup, restore, parity, bounded work

## Backup — `infra/backup/backup-postgres.sh`

- Runs `pg_dump -Fc -Z 6 --no-owner --no-privileges` **inside** the postgres container; no port is published.
- Writes `valorant-<UTC>.dump`, a `.sha256` and a non-secret `.meta.json` (backup id, time, latest migration,
  bytes).
- Retention: local dumps older than `BACKUP_RETENTION_DAYS` (default 14) are pruned. Offsite retention is the
  destination's policy.
- The destination is replaceable: `BACKUP_DIR` (local volume or NAS mount) plus an optional
  `BACKUP_COPY_COMMAND <file>` hook (rclone, S3-compatible or rsync wrapper on the host).
- No credential is ever written to disk or to output.
- Schedule it from the host, e.g. a daily cron at a time away from the 18:05/18:35 UTC jobs.
- A Docker volume is not a backup: `postgres-data` survives restarts, the dumps survive the host.

## Restore — `infra/restore/restore-postgres.sh <dump> [target-db]`

1. Verify the SHA-256 checksum. A missing or failed checksum means refuse.
2. Create the target database. A **non-empty target means refuse** (fail closed).
3. `pg_restore --single-transaction --exit-on-error`.
4. Validate: `schema_migrations` exists, then print the parity summary of the restored copy.

## Parity — `server/db/parity.ts` (`database-parity-v2`), `npm run db:parity -- summary|compare`

- Read-only and identifier-free (counts and SHA-256 digests only). It runs in one transaction with
  `SET LOCAL TIME ZONE 'UTC'`.
- It compares:
  - migration versions, tables, constraints and indexes. Constraints come from `pg_constraint`:
    PK/UNIQUE/FK/EXCLUDE by full definition, CHECK by name and constrained columns, NOT NULL by column. Nothing
    may depend on OIDs or on deparsed CHECK text, which both change across a faithful pg_restore (v1 did);
  - exact row counts and order-independent canonical content hashes of 20 critical tables (members, accounts,
    consents, provider identities, source matches and the whole evidence topology, sync runs and cursors,
    deletion jobs, analysis facts, …);
  - the tracked-match count.
- `compare` exits 1 on any difference; the cutover then **aborts**.
- `tests/databaseParity.test.ts` proves a faithful copy is identical. It also proves the gate detects row loss,
  content drift, a missing migration and index drift.

## Migration rehearsal

| Rehearsal | Where | Status |
|---|---|---|
| Parity gate over a full-cluster copy (PGlite data-dir dump/load) with realistic data + analysis facts | CI (`tests/databaseParity.test.ts`) | PASS |
| Real `pg_dump` → empty PostgreSQL B → `pg_restore` → parity compare + real-PostgreSQL contract suite + migration idempotency | `infra/rehearsal/rehearse-migration.sh` (Docker + Node; disposable containers bound to 127.0.0.1, seeded by `scripts/rehearsal-seed.ts`, which refuses non-loopback targets) | **PASS** on PostgreSQL 16.15 in WSL Docker Engine (2026-10-07, TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01). **PASS** on PostgreSQL 18.6, the Production migration major, with `POSTGRES_IMAGE=postgres:18-bookworm`, now the default (2026-10-07, TASK-INFRA-PRODUCTION-PG18-TARGET-PREP-01). Must PASS again on the Production host before any Production data migration |

## Bounded background work

Every sync, history, backfill, bulk and maintenance operation has deterministic bounds and fails closed when a
budget is reached.

| Work | Bounds |
|---|---|
| Deep or incremental sync chunk | 25 s useful-work budget, 45 s lease, page size 3 (live_v4) / 20 (stored_index), ≤ 2 provider requests per chunk, consent re-check before each provider call |
| Scheduled jobs | Advisory lock, ≤ 4 accounts and ≤ 15 s per run, same two daily jobs |
| Bulk (`bulk-history-v1`) | `--execute` refuses to run without a finite `--max-provider-requests`; ≤ 2 lanes; ≤ 8 (validated 6) provider RPM; optional `--max-http-requests` / `--max-minutes`; stop on 429; no forever mode |
| Deletion | Time budget and batch size per invocation |
| Fact hydration | One terminating keyset pass, batches of 100 |
| Static snapshot export (`data:export`) | One READ ONLY transaction on a local database; finite catalog (`static-catalog-v1`); history ≤ tracked/50 + 2 pages; ≤ 5 MiB per file, ≤ 768 MiB and ≤ 20 000 files per snapshot; statement timeout as configured; fails closed and leaves no partial version (docs/STATIC_DATA_PUBLISH.md) |
| Analysis reads | 6 constant statements (full-tracked-aggregate-v1); no raw lifetime payload |
| Database | Pool max 8 (≤ 20 enforced), 55 s statement timeout |

Telemetry exists for provider requests, SQL statement counts, chunks, elapsed time and (in `PostgresDatabase`)
exact rows returned and affected. Network bytes are **not** claimed: they are not measured.

## Local runtime rehearsal — TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01 (2026-10-07)

**STATUS: PASS** on this desktop: WSL Ubuntu 24.04 with its vhdx on D:, Docker Engine 29.8.2, PostgreSQL 16.15
on ext4. Synthetic data and disposable credentials only; no Production access and no provider request.

| Evidence | Result |
|---|---|
| REAL_POSTGRES_TESTS | 5/5 `requires-real-postgres` PASS; full suite 730 passed / 0 skipped |
| MIGRATION_REHEARSAL | `rehearse-migration.sh` PASS: 600 matches, parity identical, migrate idempotent on the copy |
| BACKUP_RESTORE | Backup, checksum, restore and parity identical. Covered: the live stack DB (`valorant` → `valorant_restore`) and a 300-match synthetic dump (→ `valorant_seeded`). The non-empty `valorant` target is refused |
| Negative restores | Corrupt copy exit 1, missing checksum exit 1, unsafe target exit 2, missing dump exit 2. The valid backup still verifies |
| LOCAL_STACK | postgres healthy, migrate exit 0, app healthy, scheduler running, `caddy validate` valid. `/`, the SPA fallback, `/healthz` and `/api/valorant/dataset` return 200 over local TLS. The edge was bound to 127.0.0.1 by a disposable override |
| Isolation | postgres: no published port, only on `app-internal` (`internal: true`), no outbound DNS. app: no published port |

### Defects found by the real runtime and fixed
1. **Parity false mismatch:** `database-parity-v1` listed `information_schema.table_constraints`. Its NOT NULL
   names are `<nsp oid>_<table oid>_<n>_not_null`, and its CHECK text deparses differently after pg_restore, so
   every faithful copy reported `constraints`. Fixed as v2; the regression lives in `tests/databaseParity.test.ts`.
2. **Scheduler always unhealthy:** it inherited the image HEALTHCHECK, which probes the API's `:3000/healthz`.
   It is now disabled for `scheduler` only, guarded in `tests/databaseArchitecture.test.ts`.

**Operational finding:** an idle WSL VM shuts down, and Docker restarts the stack on the next WSL start. Self-hosted
Production must keep WSL running.

## Real-PostgreSQL / Docker rehearsal — TASK-INFRA-REAL-POSTGRES-REHEARSAL-01 (2026-10-07)

**STATUS: BLOCKED_BY_RUNTIME_ENVIRONMENT** [SUPERSEDED: PASS above]. The authoring machine has no Docker, Docker Compose, PostgreSQL
client tools or Caddy, on Windows or in WSL (Ubuntu 24.04, no sudo). Nothing was installed.

| Evidence | Result |
|---|---|
| REAL_POSTGRES_REHEARSAL | NOT_RUN (no PostgreSQL); the 5 `requires-real-postgres` cases remain skipped |
| DOCKER_REHEARSAL | NOT_RUN (no Docker) |
| BACKUP_RESTORE_REHEARSAL | PARTIAL — the negative paths ran for real and all refuse. The positive pg_dump / pg_restore path is NOT_RUN |
| CADDY_VALIDATION | NOT_RUN (no Caddy binary or container) |
| Shell syntax (`bash -n`) of backup / restore / rehearsal | PASS |
| Structural compose parse (js-yaml) | PASS: postgres on `app-internal` only with no ports; app on `app-internal` + `edge`; only `web` publishes 80/443; `app-internal` is `internal: true` |
| Compiled server imports | `pg` + `node:*` only, so `npm ci --omit=dev` is sufficient |

Restore negative paths: a corrupted copy fails SHA-256 (exit 1), a missing checksum is refused (exit 1), and an
unsafe target name or missing dump is refused (exit 2). A valid checksum proceeds to the Docker step. Every check
ran on a dummy file; no real backup was touched.

### Defects found by static review and fixed
1. `app` and `scheduler` referenced the locally built image without a `build:` block, so Compose could try to pull
   that tag from a registry. All three services that use the app image now share the same `build` target.
2. `postgres` loaded the full `production.env`, which gave the database container application secrets. It now reads
   only `infra/env/postgres.env` (see `infra/postgres.env.example`).

Both are guarded in `tests/databaseArchitecture.test.ts`.

**Next required environment:** **A.** this machine with Docker Desktop, or **B.** the future VPS with Docker
installed. Run `bash infra/rehearsal/rehearse-migration.sh`, the ephemeral stack (`up` / checks / `down -v`) and
`caddy validate` there. They must all PASS before any Production data migration.
