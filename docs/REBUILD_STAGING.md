# Private rebuild staging collection — TASK-DATA-LOCAL-REBUILD-COLLECT-01

**STATUS: PASS_WITH_GOVERNANCE_EXCEPTION (SDD, 2026-10-07). PRIVATE_REBUILD_COLLECTION_READY = YES.** This is private,
provider-visible history for the 9 existing public accounts, held in an isolated PostgreSQL 18 staging store.
- It is not the application database and not publication-eligible.
- `lifetimeComplete = false`.

```
cached public dataset (1 earlier GET) → 9 accounts → Henrik (≤ 6 starts / rolling 60 s, ≤ 2 lanes)
  → valorant_rebuild_staging.rebuild_staging (rebuild-staging-v1) → coverage evidence → future reconciliation
```

## Boundary

- **Code:** `server/rebuildStaging/` plus `npm run rebuild:collect` (`scripts/rebuild-collect.ts`). It is a local
  maintainer tool.
  - It never imports consent, persistence, dataset or sync-store code.
  - Nothing in `api/`, `src/`, `server/` or `shared/` imports it (`tests/rebuildStaging.test.ts`).
  - It refuses any database with the application's `consents` / `schema_migrations`.
- **Unchanged:** consent code, `activePlayers`, public reads, the exporter and the publishers. There is no migration
  0012.
- **Private files:** in `~/.vsa-rebuild/` (700, every file 600, never in Git):
  - `provider.env` (Henrik key);
  - `rebuild-hmac.env` (new local key; no continuity with Production);
  - `staging-db.env`;
  - `public-dataset.json`, the cached public response;
  - `members.json`.
- **Raw identifiers kept in staging only, and why:**
  - Riot Name#Tag: the provider addresses history by it.
  - The member's provider account id: identifies the member in a payload and re-derives canonical HMACs.
  - The provider match id: the cross-source identity that survives a different HMAC key.
  - The raw v4 match document: canonical evidence can only be produced from it by the existing normalizer.
- **Logs:** counts and labels only (`safeLog`, which refuses identifier-like values).

## Mechanics

- **Phases:**
  - **Resolve:** one v2 account lookup each (affinity plus provider id).
  - **Discover:** per account, live v4 history at the accepted page size of 3 (full documents, so these are
    hydrated for free). Then the stored-match index (`STORED_INDEX_PAGE_SIZE` 20) under the deep-history stop
    rules.
  - **Hydrate:** one v4 detail per unique, not-yet-hydrated match.
  - Each discovery page commits atomically (matches + links + payloads + cursor). Restart resumes.
- **Rate:**
  - A rolling-window limiter allows ≤ 6 slots per 60 s, with a 1 s guard. Lanes ≤ 2.
  - The limiter is seeded from the request log across restarts.
  - The provider's numeric rate headers are recorded, with a pause when its remaining budget is ≤ 4.
- **Failures:** stop on 429 and on 401/403; bounded backoff on transient errors (≤ 3).

### Defects found by the real run and fixed (local commits)

1. **f2c1901:** the client timeout started before the limiter wait, producing a 0 ms false "timeout".
2. **9306425:** the limiter did not see earlier processes, which produced one 7-in-60 s window between two
   back-to-back runs. It is now seeded from the log.
3. **757b572:** Henrik budgets 30 units / 60 s and charges live history by page size. A size-10 page cost about 11
   units and gave a 429 at 6/min. The fix uses page size 3 plus the header-driven pause.
4. **03242f8:** the recorded start was stamped after the limiter slot. Event-loop jitter of up to ~0.6 s gave
   5 log windows with 7 starts inside 59.4–60.0 s. The fix records the slot time and adds a 1 s guard.

## Evidence (2026-10-07; identifier-free)

| Metric | Value |
|---|---|
| Accounts / affinity resolved | 9 / 9 (0 unresolved) |
| Provider requests | 671 total: account 11, live history 567, stored index 90, detail 3, MMR 0 |
| Outcomes | 667 ok, 1 × 401 (the first, malformed key), 1 × 429 (live page size 10), 2 timeouts (one false 0 ms, one network) |
| Max starts in any 60 s (persisted log) | 7. Once across two processes (before fix 2), and 5 × within 59.4–60.0 s (stamping jitter, before fix 4). Otherwise ≤ 6 |
| Discovered account–match links / unique matches | 1 717 / 838 (879 shared discoveries) |
| Hydrated | 838 / 838 (835 from live pages, 3 detail fetches; 0 unavailable, 0 failed) |
| Coverage | 2024-01-13 → 2026-10-06 |
| Sources | live_v4: 9 × `short_page`; stored_index: 9 × `source_exhausted`. Each account's stored total equals its live total |
| Integrity | 0 duplicate matches / payloads, 0 orphan or unlinked rows, 0 malformed payloads, 0 missing / implausible timestamps, 0 account-identity mismatches, 0 hydration failures; stored cursor entries = provider totals |
| Resume | a rerun sends 0 requests and changes nothing |

**Coverage vs reference:** 838 unique = the earlier Production tracked count of 838 (Δ 0). The rebuild found exactly
the provider-visible set Production already held. The count was not targeted.

### Competitive matches per member (provider-visible)

| Member | Matches | Competitive | 2024 | 2025 | 2026 | Earliest visible |
|---|---|---|---|---|---|---|
| jack | 166 | 105 | 0 | 4 | 101 | 2025-01-25 |
| 加分 | 267 | 142 | 0 | 1 | 141 | 2025-03-21 |
| 夏天 | 131 | 85 | 1 | 0 | 84 | 2024-01-13 |
| 天堂 | 180 | 89 | 0 | 0 | 89 | 2026-01-09 |
| 小麻花 | 229 | 102 | 0 | 0 | 102 | 2026-05-26 |
| 滑板車 | 173 | 73 | 0 | 0 | 73 | 2026-01-29 |
| **滑鏟** | 240 | **102** | 0 | 0 | **102** | 2026-02-15 |
| 走路 | 167 | 68 | 0 | 0 | 68 | 2024-08-27 |
| 魔王 | 164 | 75 | 0 | 0 | 75 | 2026-01-25 |

**滑鏟 diagnostic:** the provider exposes **102 Competitive matches in 2026**, 0 earlier, against the user's
observation of about 433.
- Henrik's whole history for this account starts on 2026-02-15 and holds 240 matches of every mode.
- The live and stored totals agree.
- So the low counts are a **provider-retention ceiling**, not a crawler or dedupe fault. More history needs a
  different source (e.g. official Riot access, DATA-04B), and lifetime completeness remains unproven.

## SDD closeout (2026-10-07)

### Accepted result

| Field | Value |
|---|---|
| Provider requests | 671 total: account lookups 11, discovery 657, detail 3, MMR 0, other 0 |
| Errors | HTTP 401 1, HTTP 429 1, 5xx 0, timeouts 2 |
| Lanes | max observed 2 |
| Discovery | complete |
| Matches | 1 717 account–match links, 838 unique discovered, 838 hydrated |
| Detail fetches | duplicate avoidance PASS |
| Resumable | YES |
| Span | 2024-01-13 → 2026-10-06 |
| vs reference | 838 vs 838, Δ 0 |
| Integrity | PASS |
| `lifetimeComplete` | false |

### Rate exception: SDD_RATE_EXCEPTION_WAIVER = ACCEPTED

The waiver covers this task only.
- **HISTORICAL_MAX_OBSERVED_RPM = 7.** It is recorded truthfully and never rewritten.
- **Cause 1 (one window):** a new process did not inherit the previous process's request state.
- **Cause 2 (five windows):** jitter of under ~0.6 s between the limiter reservation and the logged timestamp.
- **Corrective controls (fixes 2 and 4 above):**
  - the limiter is seeded from the persisted log;
  - the exact slot time is persisted;
  - a 1 s guard is added;
  - a regression test asserts that any 7 consecutive slots span ≥ 61 s.
  - POST_FIX_RATE_LIMIT_REGRESSION = PASS (14/14 focused tests).
- **The single 429** was Henrik's weighted unit budget being used up by oversized live pages. Fix 3: page size 3,
  recorded rate headers, and a low-budget pause.
- **No rerun:** the full 671-request crawl is NOT rerun (waived).
- **Future limits unchanged:** 6 per minute and 2 lanes. The waiver never authorizes > 6 per minute or removing the
  limiter or budget guards.

### Coverage gap (滑鏟)

| | Value |
|---|---|
| User-observed reference (approx.) | ≈ 433 Competitive in 2026 |
| Henrik-visible Competitive 2026 / 2025 / older / total | 102 / 0 / 0 / 102 |
| Provider-visible account history start | 2026-02-15 |
| COVERAGE_GAP_CONFIRMED | YES. The user observation is not treated as false |

**CRAWLER_INCOMPLETENESS_AS_PRIMARY_CAUSE = REJECTED.** The evidence:
- all 9 live sources and all 9 stored sources are exhausted;
- stored-index totals equal the live-history sets;
- 838 unique;
- a resume sends 0 requests;
- integrity is clean.

**Classification: UPSTREAM_HISTORY_COVERAGE_LIMITATION.** Deeper local crawling does not recover the missing history.
No claim is made about Henrik's exact retention policy, and none that it guarantees lifetime completeness.

### Preserved (private, local)

- **Staging:** `vsa-rebuild-staging-pg18` / `valorant_rebuild_staging` / rebuild-staging-v1, holding:
  - 838 hydrated matches and 1 717 links;
  - cursors and request accounting;
  - reconciliation identity fields.
- **Private files:** the `~/.vsa-rebuild/` member cache, rebuild HMAC and provider credential.
- **Backup:** one local `pg_dump` 18.6 custom-format backup in `~/.vsa-rebuild/backups/` (directory 700, file 600,
  timestamped, about 24 MB), with a SHA-256 sidecar.
  - Verified by checksum, a complete `pg_restore -l` TOC (8 tables + 8 data entries) and a full archive read.
  - Never uploaded; never restored into Production.

## Next

**TASK-DATA-HISTORY-COVERAGE-GAP-01** (planned; RESEARCH ONLY, not started). It determines whether the history behind
the 滑鏟 gap (≈ 433 observed vs 102 provider-visible in 2026) can be recovered from an authorized additional source.
Categories to assess:
- Riot official / RSO access;
- the existing Riot support request #139243830;
- provider retention guarantees;
- other explicitly authorized sources;
- product UX if full recovery is impossible.

No scraping and no bypassing access controls.

**TASK-DATA-NEON-RECONCILIATION-01** (not executed). It runs after the Neon quota resets on 2026-11-01. Steps:
1. Restore Neon into PostgreSQL 18.
2. Take the union with this staging store, keyed by provider match id.
3. Preserve canonical consent and public ids.
4. Re-key identities under the canonical HMAC.
5. Then verify analytics.

Publication stays blocked until then.
