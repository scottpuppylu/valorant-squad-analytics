# Production data migration (Neon → local PostgreSQL) — TASK-INFRA-PRODUCTION-DATA-MIGRATION-01

**STATUS: DEFERRED_BY_NEON_TRANSFER_QUOTA (SDD 2026-10-07).** Nothing has been read from Production; no dump exists.

- **Before that:** BLOCKED_BY_NEON_TRANSFER_QUOTA.
- **What replaces it for now:** SDD authorized a provider rebuild into local PostgreSQL 18 (TASK-DATA-LOCAL-REBUILD-01,
  [LOCAL_REBUILD.md](LOCAL_REBUILD.md)).
- **Neon stays preserved:** it is the future reconciliation source (TASK-DATA-NEON-RECONCILIATION-01). It is never
  retired before that reconciliation.

## Blocker (from Neon metadata only; no database connection was made)

| Fact | Value |
|---|---|
| Source | Neon project `valorant-squad-analytics-production`, organization "Vercel: scottpuppy's projects" (Vercel-managed). One branch `main`, one database `neondb`, PostgreSQL 18 |
| Identity confidence | HIGH: the only project in that organization; the other organization's project is an unrelated app |
| Plan | Free (`free_v3`) |
| Data transfer this period | 5,128,023,088 bytes (≈ 5.13 GB), against a ≈ 5 GB allowance |
| Period / reset | 2026-10-01 → **2026-11-01** |
| Compute | Idle; suspended since 2026-10-07 02:42 UTC |
| Production DB probe | NOT run. The expected failure is not reconfirmed while the quota is known to be exhausted |

**Resume only when** the quota has reset (on or after 2026-11-01), **or** the maintainer explicitly confirms a Neon plan
upgrade. Nothing is ever purchased automatically.

## Version rule (SDD 2026-10-07, TASK-INFRA-PRODUCTION-PG18-TARGET-PREP-01)

The migration path is **PostgreSQL 18 end to end**. PostgreSQL 16 is not a Production destination.

```
Neon PostgreSQL 18 → pg_dump 18 → local PostgreSQL 18 (pg_restore 18) → parity → static preflight
```

- **Source major:** 18, VERIFIED_METADATA. The Neon API project metadata for `sweet-art-88931438` reports
  `pg_version: 18`. Read through the Neon MCP on 2026-10-07, with no database connection.
- **Why not 16:** `pg_dump` cannot dump a newer server major, and a dump is not guaranteed to restore into an older
  major.
- **Tools:** PostgreSQL 18 clients from the official PGDG apt repository in WSL (`postgresql-client-18`, 18.6; no
  server package): `pg_dump`, `pg_restore` and `psql` 18.6. The container's own tools are also 18.6.
- **Compose follow-up:** `infra/compose.yaml` still pins `postgres:16-bookworm` for the stack. It must move to 18
  (volume mount `/var/lib/postgresql`, see below) before the restored Production copy is served by the stack.
  That is a separate decision; nothing in this task changes it.

## Prepared local targets

### PostgreSQL 18 Production migration target (current; do not recreate)

- **Container:** `vsa-prodmig-pg18` (`postgres:18-bookworm`, 18.6, restart `unless-stopped`).
- **Storage:** named volume `vsa-prodmig-pg18data`, mounted at `/var/lib/postgresql`.
  - PostgreSQL 18 images keep PGDATA in `/var/lib/postgresql/18/docker`, so the parent directory is mounted.
  - It lives on WSL ext4 (`/dev/sdd`) inside `D:\WSL\Ubuntu\ext4.vhdx`.
- **Listener:** `127.0.0.1:55901` only.
- **Database:** `valorant_production_migration`, verified EMPTY (0 tables, 0 user objects).
- **Credentials:** the target password is in `~/.vsa-migration/target18.env` (WSL, directory 700, file 600), never
  in Git.

### PostgreSQL 18 compatibility evidence (synthetic only, 2026-10-07)

| Check | Result |
|---|---|
| Migrations 0001–0011 on PostgreSQL 18.6 | PASS (and idempotent on the restored copy) |
| Real-PostgreSQL contract suite (`tests/databasePortability.test.ts`, `TEST_DATABASE_URL`) | 15/15 PASS, 0 skipped (PGlite + `PostgresDatabase` over PG 18.6) |
| `rehearse-migration.sh` (`POSTGRES_IMAGE=postgres:18-bookworm`, 600 matches; container pg_dump / pg_restore 18.6) | PASS, parity identical |
| Host tools: WSL `pg_dump` 18.6 → fresh PG18 database → WSL `pg_restore` 18.6 `--single-transaction --exit-on-error` (300 matches, 9 accounts) | PASS. Parity identical; dump header "Dumped from 18.6 / by pg_dump 18.6" |
| Read API (`dist-server` on the restored copy, loopback): bootstrap, analytics, currentStrength, lifetimeTotals, fixedRecent, map, agent, Synergy, weapons, custom-date, member profile / progress / weapons, history + signed page 2 | 15/15 HTTP 200, 0 provider mentions in the API log |
| Static export (`data:export`, `common` tier) from PG18 | PASS (`public-export-gate-v1`). An independent scan found 0 forbidden strings and 0 64-hex tokens outside `integrity.json` |

`npm run db:validate` is PGlite-only by design. Its PG18 equivalent is the migration, contract-suite and parity
evidence above.

### PostgreSQL 16 target: SUPERSEDED_EMPTY_MIGRATION_TARGET

- `vsa-prodmig-pg` (16.15, `127.0.0.1:55900`, volume `vsa-prodmig-pgdata`) was verified EMPTY on 2026-10-07:
  0 tables, 0 user objects, never held Production data.
- It may be stopped after SDD accepts the PG18 target. Its volume is kept until SDD explicitly authorizes cleanup.

## Resume checklist (execute in order; STOP on any failure)

1. **Authorization:** the date is on or after 2026-11-01, or the maintainer has confirmed an upgrade in chat.
2. **Quota (metadata only, via the Neon API):** project `data_transfer_bytes` is reset (or the plan is upgraded) and the
   endpoint is not disabled.
3. **Target:** `vsa-prodmig-pg18` (PostgreSQL 18) is healthy and `valorant_production_migration` is still EMPTY. If it is non-empty, STOP;
   never drop unknown data.
4. **Authentication:** check whether the existing Neon CLI session works.
   - `neonctl` 8.0.11 in WSL (`~/.local/neonctl`) holds a session that reported "Auth complete" on 2026-10-07.
   - The current `neon` CLI 8.0.11 is on Windows.
   - Never read session files.
5. **Provider auth, if needed:** request only the single unavoidable browser / MFA approval. Never ask for a
   `DATABASE_URL`, password or token in chat. Never broaden Claude Code permissions.
6. **Connection info:** the official CLI connection-string output is piped directly into libpq service + `.pgpass` files
   under `~/.vsa-migration/` (700 / 600). Nothing is printed, kept in shell history, or placed on a command line.
7. **Probe:** exactly ONE cheap read-only probe with `psql` 18 (`default_transaction_read_only`, short timeout):
   server version (major 18 required; anything else means STOP and report to SDD), current database, latest
   migration. A quota refusal means STOP, with no retry.
8. **Identity:** confirm the Production database with HIGH confidence (project, branch, database name, migration
   state).
9. **Consistent snapshot:** keep one `REPEATABLE READ READ ONLY` session open and take `pg_export_snapshot()`. If
   exported snapshots are unavailable, document the fallback (pg_dump's own snapshot).
10. **Source summary:** `database-parity` summary (counts and digests only) from that snapshot.
11. **Dump:** exactly ONE `pg_dump` **18** `-Fc --snapshot=<id>` into `~/.vsa-migration/dumps/`, outside every repository. Record
    size and SHA-256; it is a job-ledger entry, monitored by file growth.
12. **Restore:** with `pg_restore` **18** into the empty PostgreSQL 18 target, using `--single-transaction --exit-on-error`. Classify every warning.
13. **Parity:** compare against the source summary: schema, row counts, content hashes, identities, cursors, analysis
    facts. Fail closed.
14. **Integrity:** duplicates, orphans, foreign keys, cursors, public ids, timestamps. Read-only; never repair real
    data.
15. **Local reads:** a disposable read-only API on the local database (no scheduler, no sync, no Henrik): bootstrap,
    analytics, analysis, history, weapons, Synergy, profiles.
16. **Static preflight:** `npm run data:export` against the LOCAL database, with output kept local.
    - Check the privacy gate, PUUID / HMAC / internal-id / secret exposure, and size.
    - Run a loopback-only frontend check.
    - **No publication.**
17. **STOP for SDD review.** Then remove the temporary source credential files (not the dump or the target).

## Prohibited throughout

- Any write to Neon.
- Henrik calls, sync, Bulk, Phase 4.
- Real-data publication.
- Changes to the data repository.
- Pushing the source repository.
- Vercel, DNS or router changes.
- Exposed home ports.
- Bypassing Claude Code's permission classifier.

## Follow-up (not blocking)

- **FOLLOWUP_LOCAL_STORAGE_CLEANUP:** 26 anonymous Docker volumes (10,587,666,382 bytes, none in use) left by earlier
  rehearsal containers (`docker rm -f` without `-v`). Classify them before deleting, in a separate bounded task.
- **Neon MCP:** DEFERRED (Neon transfer quota, plus the Claude Code permission boundary on OAuth). Reconsider when the
  migration resumes.
