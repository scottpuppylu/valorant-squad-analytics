# Multi-account bulk historical backfill — `bulk-history-v1` (TASK-DATA-BULK-01)

Status (2026-10-06): **IMPLEMENTED / CANARY PASSED**. A full crawl has **NOT STARTED** and needs its
own explicit human authorization.

## Why

Deep history was slow because of orchestration cadence, not the engine. The daily cron and
browser sessions each run one small chunk (page size 3), so a backlog of thousands of
observations takes weeks. `bulk-history-v1` is a **local maintainer controller**. It keeps
calling the *existing* deep_backfill engine, which keeps the server cursor authoritative,
under a global provider budget.

## Boundary

| | |
|---|---|
| Command | `npm run history:bulk -- …` → `tsx scripts/bulk-history.ts` |
| Code | `scripts/bulk/controller.ts` (pure scheduler; transport and clock injected), `scripts/bulk/cli.ts` (arguments, contract gate, HTTP transport, state validation) |
| Calls | Only the existing public routes: `GET /api/valorant/dataset`, `POST /api/valorant/sync/start {accountId, kind:'deep_backfill'}`, `POST /api/valorant/sync/continue {runId}`, `GET /api/valorant/sync/status?runId=` |
| Never | Server secrets or credentials, a database connection, the provider SDK or direct provider calls, Riot/RSO, a new endpoint or function, raised rate limits, cursor edits, SQL |
| Imports | Never imported by `src/`, `api/`, `server/` or `shared/` (enforced by a test) |
| Unchanged | Page size 3, the stored-detail limit, deep-history-v1, cron, FASTSYNC, schema 6, the 12 functions, scoring, Progress, Synergy and Weapon Analytics |

The server still owns everything that matters:
- consent: every chunk re-checks it;
- leases: `LOCK_BUSY` if one is held;
- backoff: `SYNC_BACKOFF`/`nextAttemptAt`;
- pagination repeats and the stored-index fallback;
- HMAC dedupe of shared matches;
- the per-chunk 25 s useful-work budget.

## Modes and limits

- **Plan (default):** reads the public dataset and prints the selected accounts. **0 POST and 0
  provider requests.**
- **Execute:** needs all of the following:
  - `--execute`;
  - a selector: `--all`, `--member <publicMemberId>` (repeatable; selects all of that member's
    accounts) or `--account <publicAccountId>` (repeatable);
  - a finite `--max-provider-requests`.

  Optional: `--max-minutes`, `--max-http-requests`, `--lanes 1|2`, `--provider-rpm ≤ 8`, `--json`,
  `--stop-on-rate-limit`, `--state <path>`. There is no unbounded or forever mode.
- **Contract gate (fail closed, before any POST):** `ok`, schema 6, `state:'ready'`,
  `identityVersion:'member-identity-v2'`, `mode:'REAL'`, `isDemo:false`, and every member has public
  accounts. Demo is rejected.

## Scheduling (account-scoped)

- **Lanes:**
  - At most `lanes` accounts in flight, and **never two requests for one account**.
  - Default is **2**: proven by the canary at +62% steady-state throughput (rule: ≥ 20%).
  - `--lanes 1` remains available.
- **Fairness:** round-robin over eligible accounts. Busy and backoff accounts are skipped, not waited on.
- **Global provider budget:** ≤ `providerRpm` (≤ 8) in any rolling 60 s window, plus launch spacing
  of `cost × 60 s / rpm`.
- **Reservations:**

  | Chunk | Reservation |
  |---|---|
  | `live_v4` | 1 |
  | `stored_index` or unknown phase | 2 (index + one detail) |
  | Status read | 0 |

  A measured chunk returns any unused reservation.
- **Measurement:** the session charge is the delta of the run's cumulative server
  `performance.providerRequests`. If no same-run baseline exists, for example when `start`
  resumes an existing run, the full reservation is charged (conservatively) and reported as
  "unmeasured". The session cap therefore can never be exceeded.
- **Route ceilings:** start 5, continue 9 and status 20 per minute, below the route limits of 6, 10 and 30.
- **Local state:** `.local/bulk-history-state.json` (gitignored).
  - Holds public account ids, public run ids, state and phase only.
  - On restart, a saved run id is re-verified with a status read that costs 0, which also gives
    an exact baseline.
  - Corrupt or mismatched state is ignored, and the plan is rebuilt from public state.
  - Unknown fields are dropped.
- **SIGINT:** no new launches; in-flight requests finish; state is saved.

### Error handling

| Server result | Controller action |
|---|---|
| `nextAttemptAt` in the future | Account backs off until then |
| `SYNC_BACKOFF` | Status read for the durable `nextAttemptAt`. If the run id is unknown, wait 5 minutes locally |
| `LOCK_BUSY` | Account marked busy and retried after 60 s; rotate to other accounts; charged 0 |
| `RATE_LIMITED` | Global 120 s cooldown. `--stop-on-rate-limit` stops the session |
| `PROVIDER_TIMEOUT` / `PROVIDER_ERROR` | Account backs off 60 s. **2 consecutive → stop session** |
| `DATABASE_ERROR` | **Stop session** |
| Network failure / non-JSON / unexpected status | **Stop session** (fail closed) |
| `MALFORMED_PROVIDER_RESPONSE` | That account fails; others continue |
| `CONSENT_REVOKED` / run cancelled | Account removed |
| `SYNC_NOT_FOUND` | A stale local run id is dropped, then start again; on start, the account is removed |
| Run `complete` | Account removed; `sourceExhausted` shown truthfully |
| Server chunk total > 25 s | **Stop session** |

`lifetimeComplete` is always false. The ETA is **unknown** while in `live_v4`, because the
provider does not publish history depth.

## Telemetry

Per account:
- member community name, Riot `Name#Tag`, label (主帳/小帳 or a custom label);
- phase and state;
- session chunks, seen, persisted and overlaps;
- provider requests (measured and unmeasured);
- coverage, `nextAttemptAt`, last error and max chunk time.

Overall:
- stop reason;
- provider requests and HTTP requests by route;
- matches per minute and provider requests per minute;
- provider fetch and DB time.

`--json` prints the summary. Nothing in logs or state contains a PUUID, HMAC, raw match id,
internal DB UUID, management credential or secret.

## Verification (local)

`tests/bulkHistory.test.ts` has 32 tests on a deterministic fake clock (no real waiting). They cover:
- CLI: plan = 0 POSTs (end-to-end against a local fake origin); execute requires a selector and a
  budget; unsafe options rejected; REAL contract and Demo rejection; multi-account member selection.
- Scheduling: two lanes; same-account serialization; round-robin; ≤ 8 per rolling minute; a
  lower rpm; cost reservation and return; budget and minute/HTTP caps; budget below a reservation
  stops instead of hanging.
- Errors: LOCK_BUSY, RATE_LIMITED (cooldown and stop), PROVIDER_TIMEOUT once vs. twice,
  DATABASE_ERROR global stop, unexpected-response stop, MALFORMED, CONSENT_REVOKED, SYNC_BACKOFF via
  status read.
- Recovery: completion and `sourceExhausted`; restart recovery with a zero-cost status read; stale
  run id; conservative charging of a resumed run; SIGINT; corrupt state; a privacy-clean state file.
- Scale: **15 accounts × 500 matches**. Deterministic decisions, every account served in the
  first round, ≤ 8 per minute, state < 10 KB, CPU well under the budget.
- Real engine: the real `HistoricalSyncService` on PGlite with two accounts sharing every match.
  Result: 6 source matches (no duplicates), 12 participant rows, 2 cursors, leases released.
- Boundaries: no imports from src/api/server/shared; no secret or provider identifiers;
  `.local/` is gitignored.

## Production canary (2026-10-06, ≤ 12 provider requests)

**Baseline (read-only):** schema 6 REAL, 9 members / 9 accounts, 191 tracked matches, coverage
2026-08-24 → 2026-10-05, lifetimeComplete false.

| Phase | Accounts | Lanes | Charged (cap) | Actual provider | HTTP | Chunks | Seen / persisted / overlaps | Max server chunk | Errors |
|---|---|---|---|---|---|---|---|---|---|
| A | jack | 1 | 4 (4) | 3 | start 1, continue 2 | 3 | 6 / 6 / 0 (measured) | 10.0 s | 0 |
| B | jack (resumed via status) + 加分 | 2 | 8 (8) | 7 | status 1, start 1, continue 6 | 7 | 18 / 18 / 4 (measured) | 11.1 s | 0 |

- **Totals:** 12 charged, **10 actual** provider requests. Server counters show one request per page:
  every chunk was `live_v4`, and the two start chunks were charged 2 each conservatively.
- **Incidents:** 0 of each of 429, timeouts, 5xx, DB errors, consent errors and HTTP 500s.
- **Steady state:**
  - 1 lane: 6 matches in 27.4 s = **13.1 matches/min**, about 4.4 provider/min (latency-bound:
    about 13–15 s wall per chunk).
  - 2 lanes: 18 matches in 50.9 s = **21.2 matches/min**, about 7.1 provider/min (close to the
    8/min ceiling).
  - Improvement: **+62% → two lanes are the default.** This rests on a small sample: 2 accounts, 13
    measured chunks.
- **Post-canary health (read-only):**
  - Dataset: schema 6 ready REAL, 9 members.
  - Tracked matches 191 → **213**; coverage now starts 2026-08-21, so the cursor only moved backward.
  - 0 duplicate match ids; leak scan clean.
  - Both runs `paused` (leases released), no backoff, no error, `sourceExhausted` false.

### Rough full-crawl estimates (not a promise)

The `live_v4` ceiling is 8 req/min × 3 = 24 observations/min; the canary observed about 21.

| Account-observations | Provider requests (live_v4) | Time at about 21/min |
|---|---|---|
| 4,500 | ~1,500 | ~3.5 h |
| 6,000 | ~2,000 | ~4.7 h |
| 7,500 | ~2,500 | ~5.9 h |

The real duration is longer:
- `stored_index` is about 1 match per 2 requests (≤ 4 matches/min);
- pagination-repeat backoffs pause accounts for 5–30 minutes;
- overlaps (shared matches) count as observations but not as new matches;
- live depth is unknown.

### Future full-crawl command (NOT executed; needs explicit authorization)

```bash
npm run history:bulk -- --base-url https://valorant-squad-analytics.vercel.app --all --execute --lanes 2 --provider-rpm 8 --max-provider-requests 2500 --max-minutes 420 --stop-on-rate-limit --json
```

Run it in the foreground and stop it with Ctrl+C (state is saved). It is resumable: rerun the same
command.
