# Production migration runbook — Neon/Vercel → VPS (NOT STARTED)

Follow strictly in order; never skip a step. Any row-count, cursor, schema, analytics, constraint or API mismatch,
or a failed write canary, means **CUTOVER = ABORT**. Do not continue because it "looks close".

## Preconditions

- **Local gates PASS:** tests, lint, build, db:validate, portability, architecture guards.
- **Real-PostgreSQL rehearsal PASS:** `infra/rehearsal/rehearse-migration.sh`, the ephemeral stack and `caddy validate`.
  **PASS locally** (TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01, synthetic data). Repeat it on the Production host
  before step 5.
- **Neon transfer:** restored, or the export path verified to fit inside the allowance.

## Steps

1. **VPS ready:** baseline from [VPS_PRODUCTION_ARCHITECTURE.md](VPS_PRODUCTION_ARCHITECTURE.md), with
   `infra/env/production.env` and `infra/env/postgres.env` created on the server (never committed). All Compose
   commands use `docker compose --env-file infra/env/production.env -f infra/compose.yaml …`.
2. **Docker stack ready:**
   - `docker compose -f infra/compose.yaml config`, then `build`.
   - Start `postgres`, then run `migrate` on the EMPTY database.
3. **Fresh migrations PASS:** `0001`–`0011` recorded once each.
4. **Backup target verified:** `backup-postgres.sh` on the empty schema, then restore that dump into a scratch
   database.
5. **Neon export:** `pg_dump -Fc` from Neon (operator machine, connection string never printed or committed),
   plus its checksum and a source parity summary (`database-parity summary`).
6. **Restore** into the VPS PostgreSQL with `restore-postgres.sh`.
7. **Schema parity:** migrations, tables, constraints and indexes.
8. **Row-count parity:** every critical table.
9. **Constraint and integrity parity:** content hashes; FK and unique constraints valid.
10. **Analytics parity:** read-only shadow GETs of `view=analysis` features against both stacks; payloads equal.
11. **Sync cursor parity:** content hash of `sync_cursors` and `sync_runs`.
12. **Read-only API shadow tests:** dataset, history, analytics, analysis, sync status.
13. **Temporary Production write freeze:** no syncs, no cron, no Bulk. Pause Vercel Cron.
14. **Final export** taken during the freeze.
15. **Final restore**, then repeat steps 7–12 (all must be identical).
16. **Production routing switch:** DNS/proxy to the VPS.
17. **VPS smoke:** health, dataset, analysis.
18. **Write canary:** one authorized manual sync on one account, then verify.
19. **Enable** the scheduler.
20. **stored_index canary:** one `sync/continue` each for 加分 / 小麻花 / 滑鏟, sequential.
    - Run only if each is in stored_index, ready or paused, with no lease and no backoff.
    - ≤ 2 provider requests each, ≤ 6 total, no retry.
    - Expect `storedCursorRestarts` = 1 and page size 20.
21. **Monitoring:** health, logs, backups.
22. **Neon** is retained read-only for rollback.
23. **Vercel Production** retired.
24. **Observation window.**
25. **Neon** retired, after a verified VPS backup restore.

## Rollback metadata

Record these before step 16 (non-secret only): old deployment commit, new deployment commit, schema version,
backup id, cutover timestamp.

Rollback is a routing, `DATABASE_URL` or deployment-target switch. It never needs a business-logic change.

## Never

- Run `docker compose down -v` on Production.
- Print or commit `DATABASE_URL` or any secret.
- Delete Neon or Vercel before steps 23 and 25.
- Start Phase 4 Bulk before the VPS is stable and stored_index is accepted.
