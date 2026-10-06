# Phase-2 DATABASE_ERROR diagnosis (TASK-DATA-BULK-01C)

SDD STRICT, 2026-10-06. Starting HEAD `78e5f64`; checkpoint `checkpoint-before-bulk-db-diagnosis-01`.

> **Superseded by TASK-DATA-BULK-01D below: ROOT CAUSE VERIFIED. It is C1a, a historical Riot-ID identity mismatch, and not a
> database fault.** The analysis below is the original 01C record and is unchanged.

**Outcome (TASK-DATA-BULK-01C): DIAGNOSIS BLOCKED BY OBSERVABILITY.**
- The failure is narrowed to three candidates that produce an identical durable signature; the root cause is NOT VERIFIED.
- `database-failure-stage-v1` (sanitized stage telemetry) is implemented and **READY FOR CONTROLLED REPRODUCTION**.
- Controlled reproduction: **NOT AUTHORIZED / NOT RUN**.

Boundaries kept:
- Provider calls 0; sync/start and sync/continue 0; bulk 0.
- Production DB writes 0; direct production SQL reads 0; no secrets.
- No cursor, lease or run mutation.

## Evidence used (read-only)

- The local Phase-2 controller log and state. Only aggregate facts were used; ids never appear here.
- Public `GET /api/valorant/sync/status` for the failed run, plus jack and 夏天 (zero-cost status reads).
- Public `GET /api/valorant/dataset` and `?view=history` pages.
- One Vercel request-log entry (read-only CLI log reader): `POST /api/valorant/sync/continue` → **503** at
  2026-10-06T11:21:39.475Z, with **no application log lines**.
- Code reading and local PGlite fault injection (`tests/syncDatabaseFailure.test.ts`).

Production database internals (Neon metrics, Postgres error detail): **NOT AVAILABLE**. They were not accessed, and no
DATABASE_URL was used.

## Timeline (滑板車, run `failed`)

| UTC | Event |
|---|---|
| 10:28:17 | Phase-2 status read (cost 0): pages 24, providers 24, retries 0, live_v4 |
| 10:44:32 | Chunk returned a **pagination-repeat pause** (`recordFailure` `PROVIDER_PAGINATION_UNSTABLE`, paused, +5 min): providers +1, run retries +1, pages +0 |
| 10:49 → 11:20:11 | Normal full live_v4 pages (3 matches each); last success at 11:20:11, cursor coverage from 2026-05-18T14:45:28Z |
| 11:21:39.4 → 11:21:49.6 | The failing `continue` (10.2 s): **503 DATABASE_ERROR** |

> Correction: the Phase-2 report said "pagination repetition 0". There was **1** pagination-repeat pause (this account,
> 10:44:32Z). BULK_HISTORY.md is corrected.

**Final public run state:**
- `failed`, cursor `last_error_category` DATABASE_ERROR, phase live_v4.
- Pages 54, providers 56, run retries 2.
- Cursor coverage from 2026-05-18T14:45:28Z.

**Counter reconciliation (exact):**
- Pages: 24 + 30 successful Phase-2 pages = 54.
- Provider requests: 24 + 30 + 1 (pause) + 1 (failed chunk) = 56. Run retries: 0 + 1 (pause) + 1 (failure) = 2.
- `retries` is the **run-level** `sync_runs.retry_count`. It is incremented by every `recordFailure` and never reset by a
  success; the cursor `retry_count` is separate.

**Facts proved:**
- The failure is in deep **live_v4**: the cursor phase is live_v4, and stored_index-only stages (`fillKnownMatchSeasons`,
  detail fetch) are excluded.
- **The provider request succeeded before the failure.** `recordFailure` added the chunk's `providerRequests` (+1), and
  provider errors map to 429/502/504, never 503.
- **`recordFailure` committed** (run `failed` with `DATABASE_ERROR`). Because that same transaction requires the lease
  token, the **lease was released** by it.
- **Persistence began and two match transactions committed.**
  - The public history holds exactly **2** matches of this member that are **older** than the cursor's last committed
    coverage (2026-05-18T14:07Z and 2026-05-04T15:30Z).
  - Only this account's own sync links its member (`player_id` is set for the consenting participant only), and cursor
    coverage advances only on `recordSuccess`. So these were written by the failed chunk.
- **The cursor did not advance**: phase live_v4 and coverage unchanged. `recordSuccess` is a single transaction (cursor
  and run) that either never ran or rolled back.

## Throw-site audit (every path to a public DATABASE_ERROR)

| Stage | File / function | Possible error | Public mapping | State before → after |
|---|---|---|---|---|
| DB-A findRun / status | `historicalSyncService.continue` | raw DB error | **502 PROVIDER_ERROR** (`toPublicApiError`), not 503 | Untouched |
| DB-B consent check | `continue` / chunk `request()` | raw DB error | 502 (UNKNOWN) | Untouched / run failed UNKNOWN |
| DB-C acquireCursorLease | `continue` | raw error | 502 | Untouched |
| DB-D markRunRunning | `continue` | raw error | 502 | Lease held → expires |
| DB-E existingMatchHmacs | `deepHistoryChunk` | raw error | 502, run failed `UNKNOWN` | Provider +1 |
| **DB-F persistSyncPage** | `deepHistoryChunk.persist` catch | **any** non-consent error, including the identity error below | **503 DATABASE_ERROR** | Earlier per-match transactions stay committed; cursor unchanged |
| DB-G fillKnownMatchSeasons | `deepHistoryChunk` (stored_index only) | any | 503 | Excluded (live_v4) |
| **DB-H recordSuccess** | `executeChunk` (`databaseStage=true`) | any, incl. "lease lost", CHECK, connection | **503** | Transaction rolled back; page matches committed |
| DB-H′ pagination-pause commit | `executeChunk` | any | 503 | Returns before persistence, so 0 page matches |
| DB-I recordFailure | `executeChunk` catch | any | 503 (`databaseStage=true`) | Run stays `running`; lease freed by `finally` |
| DB-J releaseLease | `finally` | swallowed | — | Lease expires (45 s) |
| Post-commit status read | `executeChunk` `return requireStatus()` | raw | **escapes the try/catch → 502** (see defect) | Committed |
| DB-K / DB-L | connection / unknown | — | 503 only inside DB-F / DB-H / DB-I | — |

`DATABASE_ERROR` collapses DB-F (including **non-database** errors thrown inside `persistSyncPage`), DB-H and DB-I.
Before this task, the server logged nothing on failure.

## Durable persistence atomicity and idempotency

- `persistSyncPage` normalizes the whole page first, then runs **one transaction per match**: consent `FOR UPDATE` plus
  the upsert of the match, participants, teams, rounds, round participants, events and season.
- Each match is atomic, but **the page is not**: earlier matches stay committed when a later one fails.
- Normalization errors fail before any transaction, so 0 matches commit.
- The consenting-participant check runs per match, so earlier matches commit first.
- Replay is idempotent. Locally, after a failed page the same page replays to 6 unique matches with 6 participant rows,
  the 2 already-committed matches count as overlaps, the cursor advances once and there are no duplicates. Upserts use
  `ON CONFLICT`.

## Constraint audit

All CHECKs are enum or range checks on evidence status, sync state, phase and counters, plus FKs and unique keys
(`source_matches` lookup HMAC and public id; `match_teams (match, team)`; `rounds (match, round)`; participants per match).
- No constraint depends on match age.
- Older matches of many modes (Deathmatch, Unrated, Competitive) persisted successfully down to 2026-05-04.
- A constraint failure on the third match **cannot be excluded** without its shape, which was not fetched.

## Historical-shape risk (concrete code path found)

`normalizeHenrikEvidence` marks the consenting participant only when `players[].name` / `tag` equal the account's
**current** Riot ID (case-insensitive). Riot match data carries the name at match time. If an account changed its Riot ID,
every older match lacks a consenting participant. `persistSyncPage` then throws (previously a plain `Error`), and the
deep chunk relabels that as `DATABASE_ERROR`.
- This would recur deterministically at the same cursor.
- It would affect only history older than the rename.
- Whether 滑板車 renamed is **NOT VERIFIED**.

## Local fault-injection matrix (real deep_backfill path, PGlite)

Production signature: failed / DATABASE_ERROR, run retries +1, providers +1, pages +0, cursor unchanged, lease released,
**2 page matches committed**.

| Injected stage | Run | Cursor | Lease | Retries | Providers | Page matches committed | Match |
|---|---|---|---|---|---|---|---|
| **C1a** 3rd match lacks consenting participant (Riot ID changed) | failed / DATABASE_ERROR | unchanged | released | +1 | +1 | 2 | **YES** |
| **C1b** 3rd match's transaction fails in DB (connection, SQLSTATE 57P01) | failed / DATABASE_ERROR | unchanged | released | +1 | +1 | 2 | **YES** |
| **C2** short final page (2 matches) and `recordSuccess` fails | failed / DATABASE_ERROR | unchanged (phase rolled back to live_v4) | released | +1 | +1 | 2 | **YES** |
| Normalization throws inside `persistSyncPage` | failed / DATABASE_ERROR | unchanged | released | +1 | +1 | **0** | NO |
| `recordFailure` also fails | **running** | unchanged | released (finally) | +0 | +0 | 2 | NO |
| `existingMatchHmacs` fails | failed / **UNKNOWN**, **502** | unchanged | released | +1 | +1 | 0 | NO |
| Status read after commit fails | **paused**, cursor **advanced**, raw error → 502 | advanced | released | 0 | +1 | 3 | NO |
| Pre-chunk stages (DB-A..D) | → 502 | — | — | — | +0 | 0 | NO |

**Timing doesn't discriminate.** The failed request took 10.2 s. jack's successful short-page (2-match) live→stored
transition also took **10.2 s**, and full 3-match chunks take a median of 12.9 s.
- Both C1 and C2 fit, and the live window ending near this depth (jack 182, 夏天 156; this account 162 + 2) makes C2
  plausible.
- jack (2-match page) and 夏天 (empty page) both completed the short/empty-page `recordSuccess` in production, so the C2
  code path itself is proven. C2 would be transient.

## Root-cause candidates

| Class | For | Against | Confidence |
|---|---|---|---|
| DETERMINISTIC_DATA_BUG: C1a Riot-ID rename | Concrete code path; exact signature; only old history affected; would recur | Rename not verifiable; live window may simply have ended | Medium |
| TRANSIENT_INFRASTRUCTURE / CONNECTION: C1b or C2 | Exact signature; serverless Pool over WebSocket; ~7 s DB per chunk over many round trips | No error detail; 30 earlier pages succeeded | Medium |
| CONSTRAINT_BUG on the 3rd match | Exact signature | No age-dependent constraint; many old modes persisted | Low |
| TRANSACTION_BUG / STATE_MACHINE_BUG | — | Commits and rollbacks behave correctly in local injection | Low |
| CONNECTION_POOL_BUG | Module-level `Pool` reused across warm invocations | No evidence | Low |

**Root cause: NOT VERIFIED.**

**Safety (verified):**
- The cursor is preserved.
- Committed matches are fully formed (per-match atomic).
- The lease is released.
- A replay is idempotent in principle. It was **not** performed.

## Connection layer (static)

- `@neondatabase/serverless` `Pool` is created per `NeonDatabase` instance; single queries use `pool.query`.
- Transactions run `connect` → BEGIN → work → COMMIT, with ROLLBACK on error and `release` in `finally`.
- No statement timeout, no retry, and no error wrapping. Raw errors reach the stage classifiers above.

## Observability gap → `database-failure-stage-v1` (implemented, log only)

**Server log only**, via `server/sync/databaseFailureStage.ts`:

```
{"event":"sync_database_failure","failureStageVersion":"database-failure-stage-v1","stage":"persist_sync_page",
 "syncKind":"deep_backfill","historyPhase":"live_v4","errorKind":"consenting_participant_absent"}
```

- **Stages:** `persist_sync_page`, `season_fill`, `cursor_success_commit`, `pagination_pause_commit`, `failure_commit`.
- **errorKind:** `consenting_participant_absent` (now a typed `ConsentingParticipantAbsentError`, same message), `lease_lost`,
  `postgres` (with the 5-character SQLSTATE only), `connection`, `code_or_data_shape`, `other`.
- **Never logged:** ids, names, cursor or page values, SQL text or parameters, raw messages or stacks.
- No API response change, no endpoint, no function, no migration.
- Tests show it separates C1a, C1b and C2 and leaks nothing.

## Minor defect found (separate task)

`executeChunk` returns `this.requireStatus(...)` without `await`, so a status-read failure **after** a committed cursor
escapes the try/catch. The 「同步已安全提交，但狀態暫時無法讀取」 branch is unreachable for that case, and the route maps
the raw error to 502. Data is safe, since the commit already happened.
- It is not this incident.
- It is characterized in tests and left unchanged here.

## Next evidence required

One **separately authorized** controlled reproduction: a single `sync/continue` for the failed run, now that the stage
telemetry is deployed. It would be one provider request and one page.
- `persist_sync_page` + `consenting_participant_absent` → deterministic rename (fix: identity by provider identity, not
  current name; separate task).
- `persist_sync_page` + `connection` / `postgres` → DB.
- `cursor_success_commit` → C2 (transient, or SQLSTATE-specific).

## TASK-DATA-BULK-01D — controlled production reproduction (2026-10-06): ROOT CAUSE VERIFIED (C1a)

**Authorization:** explicit human authorization for EXACTLY ONE `POST /api/valorant/sync/continue` for 滑板車's existing failed
deep_backfill run.
- Executed from a gitignored one-shot local script with a single-POST guard and no retry. The run id was resolved in memory and
  never printed.
- HEAD `ce511d0`; the production deployment was created 4 s after that commit, so `database-failure-stage-v1` was deployed.
- No bulk worker was running.

**Pre-state (read-only):**
- deep_backfill, `failed`, `DATABASE_ERROR`, live_v4, sourceExhausted false.
- Pages 54, provider requests 56, run retries 2, detail requests 0.
- Coverage 2026-05-18T14:45:28Z → 2026-10-04T15:58:02Z; no `nextAttemptAt`.
- Tracked 671 (2025-01-25 → 2026-10-05).

**The one POST:** 2026-10-06T13:34:36.555Z → 13:34:48.252Z (11.7 s) → **HTTP 503 `DATABASE_ERROR`**.

**Telemetry** (Vercel request log, read-only CLI; one event; no identifiers):

```
{"event":"sync_database_failure","failureStageVersion":"database-failure-stage-v1","stage":"persist_sync_page",
 "syncKind":"deep_backfill","historyPhase":"live_v4","errorKind":"consenting_participant_absent"}
```

**Post-state (read-only):**

| Counter | Before → after | Delta |
|---|---|---|
| status / phase | failed / live_v4 | unchanged |
| pages | 54 → 54 | +0 |
| provider requests | 56 → 57 | **+1** (≤ 1 logical; budget kept) |
| run retries | 2 → 3 | +1 |
| detail requests | 0 → 0 | +0 |
| coverage | — | unchanged (cursor did not advance) |
| tracked matches | 671 → 671 | +0 unique |

**Conclusion: C1a VERIFIED. Root-cause class: DETERMINISTIC HISTORICAL IDENTITY BUG.**
- In the next live_v4 page, a match carries no participant whose Riot name/tag equals the account's **current** Riot ID.
  `normalizeHenrikEvidence` identifies the consenting participant by current name+tag (`normalizeHenrikEvidence.ts:102`), so
  `persistSyncPage` throws `ConsentingParticipantAbsentError`, which the deep chunk reports as `DATABASE_ERROR`.
- **The database itself is not at fault.** C1b and C2 are refuted for this failure: the stage is persist, not cursor commit,
  and the kind is identity, not connection or Postgres.
- The most likely reason is that the account used a different Riot ID in older matches. That specific reason is not separately
  proven: the payload and names are never retained, by design.
- It recurs at this cursor on every attempt, so **bulk cannot pass this point for this account** until identity matching is fixed.

**Effects of the single request:**
- One provider history page was read.
- The page's matches that do contain the consenting participant were re-upserted idempotently. There was no new unique match
  (tracked +0), and the matches committed in Phase 2 stayed as they were.
- `recordFailure` committed: run retry +1, provider count +1, lease released, cursor unchanged.
- **0 direct SQL** reads or writes. No other production mutation, no second POST and no bulk.
