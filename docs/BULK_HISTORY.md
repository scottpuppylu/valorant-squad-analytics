# Multi-account bulk historical backfill — `bulk-history-v1` (TASK-DATA-BULK-01)

Status (2026-10-06): **IMPLEMENTED / CANARY PASSED**. Phase 1 (TASK-DATA-BULK-01A) stopped on the first provider 429.
Phase 2 (TASK-DATA-BULK-01B, 6 RPM) **STOPPED / BLOCKED** on a DATABASE_ERROR after 53.6 min with zero 429; see below. Further crawling needs its
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

## Production bulk crawl Phase 1 — TASK-DATA-BULK-01A (2026-10-06): STOPPED / NEEDS REVIEW

The authorized bounds were 2 lanes, ≤ 8 provider requests/min, ≤ 500 charged provider requests, ≤ 650 HTTP
requests, ≤ 120 min and `--stop-on-rate-limit`. The run used HEAD `1d3a647` in a foreground Terminal tab, all 9
eligible accounts, and the saved resume state (2 run ids). It **stopped at the first 429 after 631.5 s**, as required.
There was no retry and no resume.

- **Window:** 2026-10-06T05:28:41Z → 05:39:13Z. Stop reason `rate_limited`.
- **Cause:** a **provider-side** 429.
  - The server persisted `lastErrorCategory: RATE_LIMITED` with `retries 1` and a short `nextAttemptAt` on one run (滑鏟).
  - That run shows 23 provider requests against 22 pages, so the request reached the provider.
  - Our own route limiter was not the cause: rolling maximums were 8 provider launches/60 s, 8 continues/60 s and
    4 starts/60 s (route limits are 6/10).
  - Whether other traffic shared the provider key at that moment: NOT VERIFIED.
- **Provider requests:** 84 charged (69 measured + 15 conservatively charged starts on pre-existing runs) of 500.
  **77 actual** (one per live_v4 page, plus the one 429 request; server counters).
- **HTTP requests:** start 7 / continue 70 / status 2 = 79.
- **Fairness:** 9 of 9 accounts served, 8–9 chunks each (2 lanes, round-robin).
- **Errors:** 0 LOCK_BUSY (so no concurrent same-account work reached the server lease).

| Error | Count |
|---|---|
| 429 | 1 |
| Timeout | 0 |
| 5xx | 0 |
| DATABASE_ERROR | 0 |
| Consent | 0 |
| Malformed | 0 |
| HTTP 500 | 0 |
| Pagination repeats | 0 |
| Backoffs (other than the 429) | 0 |

- **Phases:** every chunk was `live_v4`; **stored_index chunks: 0**.

| Phase | Chunks | Seen / persisted / overlaps (measured) | Server time (sum) | Provider fetch | DB | Max chunk |
|---|---|---|---|---|---|---|
| live_v4 | 76 | 207 / 207 / 97 | 699.0 s (avg 9.2 s) | 128.7 s (avg 1.7 s) | 523.4 s (avg 6.9 s, 75%) | 11.8 s |
| stored_index | 0 | — | — | — | — | — |

- **Throughput:**
  - 19.7 measured observations/min, a lower bound: the 7 resumed start chunks are unmeasured, at about 3 each.
  - Provider requests: 8.0 charged/min and 7.3 actual/min.
- **Unique growth:** tracked matches went **213 → 332 (+119)** from about 228 account-observations. Shared friend
  matches collapse to one source match each.
- **Coverage:** the global oldest date moved from 2026-08-21 to **2026-08-14**; the newest is unchanged (2026-10-05).
  `lifetimeComplete` is false, and no account is `sourceExhausted`.
- **Final state:** all 9 runs `paused` in `live_v4` (leases released). One account is in a short provider backoff.
  Nothing is complete, failed or revoked.
- **Post-run read-only checks:**
  - Dataset: REAL, ready, schema 6, member-identity-v2, 9 members / 9 accounts.
  - 0 duplicate member, account or snapshot match ids; no non-finite numbers; leak scan clean.
  - Analytics smoke — Overall/currentStrength, Profile form, Progress, Synergy, lifetime totals, Weapon
    (all/current), analytics context and History: all 200, with versions unchanged.
- **DB-level integrity:** NOT VERIFIED (it would need secret access).

**Reading.** The binding constraint was the provider rate, not stored_index (never reached) and not our scheduler. DB time
dominates chunk latency. Two lanes stayed safe (no LOCK_BUSY, chunk max 11.8 s).

**Phase-2 decision: A.** Continue bulk-history-v1 unchanged, but with a lower `--provider-rpm` (an existing flag, no
code change). Not prepared to execute without review.

## Production bulk crawl Phase 2 — TASK-DATA-BULK-01B (2026-10-06): STOPPED / BLOCKED (DATABASE_ERROR)

**Bounds:** 2 lanes, `--provider-rpm 6`, ≤ 600 charged provider requests, ≤ 750 HTTP requests, ≤ 120 min,
`--stop-on-rate-limit`, all 9 eligible accounts.
- **Execution:** HEAD `f900e93`, foreground Terminal; window 2026-10-06T10:28:13Z → 11:21:49Z (**53.6 min**).
- **Resume:** the saved state (9 public run ids) was re-verified with 9 zero-cost status reads.
- **Stop reason:** `database_error`. The controller stopped the whole session at the first `DATABASE_ERROR`, as designed,
  with no retry and no resume.
  - The failure was one `sync/continue` for account 滑板車 (主帳), which returned HTTP **503** at 11:21:39Z with no chunk
    event logged. The run is now `failed` / `DATABASE_ERROR` (`retries` 2; 56 provider requests vs 54 pages).
  - **Root cause NOT VERIFIED.** The server logs no SQL details by design, and DB-level inspection needs secret access
    (not authorized). Whether the error is transient or deterministic for that account's next page is unknown.

**Rate verdict: C — STOPPED FOR NON-RATE SAFETY FAILURE.**
- 6 RPM ran **53.6 min with zero 429**: 311 charged / 310 measured provider requests, 5.8 provider/min.
- Launches were exactly 10 s apart. A rolling window counts 7 only when both endpoints of an exactly-60.0 s span are
  included; the controller window is half-open (≤ 6).
- This is strong but **not accepted** evidence: the run did not end on a normal bound.

| | Charged | Measured | Unmeasured | HTTP start / continue / status | Chunks |
|---|---|---|---|---|---|
| Phase 2 | 311 (cap 600) | 310 | 1 (the failed chunk) | 0 / 311 / 9 = 320 (cap 750) | 309 |

| Phase (post-chunk) | Chunks | Seen | Persisted | Overlaps | Provider requests | Notes |
|---|---|---|---|---|---|---|
| live_v4 | 292 | 873 | 873 | 538 | 292 | 1 request per page |
| stored_index | 18 | 50 | 2 | 48 | 18 | Index requests only, **0 detail requests**; mostly known matches |

Server totals:
- Provider fetch 403.5 s (avg 1.3 s per chunk); DB 2,231.5 s (avg 7.2 s, **78%**); server total 2,850.6 s; max chunk
  **12.7 s** (< 25 s).
- Throughput: 17.2 observations/min (923 seen), 6.3 unique tracked matches/min.

**Fairness:** 9/9 accounts served, round-robin.
- 7 accounts had 35 chunks each; 夏天 had 34; 滑板車 had 30 before failing.
- At most 2 in flight, never 2 for one account. LOCK_BUSY 0.

| Error | Count |
|---|---|
| 429 | 0 |
| Timeout | 0 |
| Provider 5xx | 0 |
| DATABASE_ERROR | **1** |
| LOCK_BUSY | 0 |
| Consent | 0 |
| Malformed | 0 |
| HTTP 500 | 0 |
| Pagination repetition | 0 |
| SYNC_BACKOFF | 0 |
| Network / unexpected | 0 |

**Final account states:**
- 8 accounts are `paused`, with no backoff and no error; leases are released.
- jack and 夏天 are in `stored_index` (pages 7/164 and 11/129).
- 滑板車 is `failed`. No account is source-exhausted.

**Growth:**
- Tracked matches went **332 → 671 (+339 unique)** from 923 account-observations. 586 overlaps are shared friend
  matches and re-seen matches.
- The oldest tracked date moved from **2026-08-14 to 2025-01-25**; the newest is unchanged at 2026-10-05.
- `lifetimeComplete` stays false.

**Post-run read-only checks:**
- Dataset: REAL, ready, schema 6, member-identity-v2, 9 members / 9 accounts.
- History: 671 browsable (371 beyond the snapshot, 0 duplicates).
- Analysis: every `server-analysis-v2` response had `transportSnapshotUsed=false`, `populationLimit=null` and
  `populationComplete=true`. Populations: lifetime/map/agent 671, Act 497, synergy 671 (36 pairs, max 80 shared),
  currentStrength 130, improvement 21.
- Weapon all/current return 200. 0 non-finite values, no leaks.
- DB-level integrity: NOT VERIFIED.

**New risk (DATA-03B.2C latency):**
- Production `lifetimeTotals` / `mapStats` / `agentStats` / `synergy` now take **≈ 9.4–10.0 s** at 671 matches, against
  5.5 s at 332 (≈ 13 ms per added match, linear).
- Extrapolated, the 60 s function limit is reached near **~4,000–4,500 tracked matches**. That is a real ceiling for
  全部已追蹤, which must not be papered over.

**Next bulk decision: D — investigate the database error and chunk/analysis latency before the next crawl.** Prerequisites:
1. A separate task to diagnose the 滑板車 `DATABASE_ERROR` safely (it needs an authorized read path; no repair or
   reset here).
2. A latency task for full-tracked analytics (incremental/materialized aggregates, sampling never allowed) before the
   population approaches ~4,000.

The prepared continuation below is NOT executed and must not run until both are reviewed.

### Prepared Phase-3 command (NOT executed; only after the decision-D prerequisites)

```bash
npm run history:bulk -- --base-url https://valorant-squad-analytics.vercel.app --all --execute --lanes 2 --provider-rpm 6 --max-provider-requests 600 --max-http-requests 750 --max-minutes 120 --stop-on-rate-limit --json
```

### Phase-2 command as prepared after Phase 1 (executed in TASK-DATA-BULK-01B above)

Updated after Phase 1: provider rate lowered to 6/min (the 429 occurred at a sustained 8/min); everything else is the same
unchanged controller and 2 lanes.

```bash
npm run history:bulk -- --base-url https://valorant-squad-analytics.vercel.app --all --execute --lanes 2 --provider-rpm 6 --max-provider-requests 600 --max-http-requests 750 --max-minutes 120 --stop-on-rate-limit --json
```

### Original full-crawl command from the canary report (superseded by the Phase-2 command above)

```bash
npm run history:bulk -- --base-url https://valorant-squad-analytics.vercel.app --all --execute --lanes 2 --provider-rpm 8 --max-provider-requests 2500 --max-minutes 420 --stop-on-rate-limit --json
```

Run it in the foreground and stop it with Ctrl+C (state is saved). It is resumable: rerun the same
command.
