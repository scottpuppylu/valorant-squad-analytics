# Stored-index efficiency — `stored-index-efficiency-v1` / `deep-history-v2` (TASK-DATA-STORED-INDEX-01)

SDD STRICT, 2026-10-07. Starting HEAD `7a9934e`; checkpoint `checkpoint-before-stored-index-01`.

## Phase-3 evidence (TASK-DATA-BULK-01E)

| Phase | Chunks | Provider | Seen | Persisted | Overlap | Persisted per request |
|---|---|---|---|---|---|---|
| live_v4 | 89 | 89 | 267 | 267 | 115 | 3.0 |
| stored_index | 494 | 503 | 1,455 | 14 | 1,442 | 0.028 |

stored_index used 84 % of the provider budget to re-read entries that were already durable.

## Root cause

stored_index reused the deep-history page size (3), the same value live_v4 uses.
- Every continuation fetched one stored-matches page of at most **3** entries and checked them with one exact
  HMAC query.
- An overlap-dense index therefore cost about one index request per 3 known entries: 1,455 / 503 ≈ 2.9.
- Detail requests were rare (14); the bottleneck was purely index page size.

## Provider documentation

Sources: [stored matches guide](https://docs.henrikdev.xyz/valorant/guides/stored-matches.md) and
[API reference](https://docs.henrikdev.xyz/api-reference/valorant/get-stored-matches-by-name-v1.md).

- **Parameters:** `size` is an "optional page size … a positive integer when paginating". No maximum is
  documented. `page` is "1-based" and requires `size`.
- **Order:** "sorted newest first by match start time".
- **Counters:** `results.total / returned / before / after` describe the stored records matching the request,
  not Riot history.
- **Mutability:** pages may change between requests as new matches are stored. The index grows at the newest end.
- **Example:** the guide's own pagination example uses `size=20`.

## Options

| | Idea | Decision |
|---|---|---|
| A | Larger stored page only | Part of C |
| B | Known-boundary / known-prefix skip (e.g. skip pages whose first or last entry is known) | **Rejected.** The index is mutable and only partially ordered for our purposes; a known boundary does not prove the entries in between are known, so it could skip an unknown match |
| C | Larger stored page (20) + the existing exact per-entry HMAC check + at most 1 detail per invocation + versioned restart of old cursors | **Chosen** |
| D | Omit `size` (the endpoint then returns every stored record) | **Rejected.** The response is unbounded, it breaks page coordinates, and with one detail per call the whole list would be refetched each time |

## Chosen design

- **Page size:** `STORED_INDEX_PAGE_SIZE = 20` (`server/sync/historicalDiscoveryProvider.ts`) is used only for
  stored_index. `live_v4` keeps its page size (3), cursor, fingerprint and stall behaviour, all unchanged.
- **Exact check:** every entry is still checked exactly by `sourceMatchHmac` against durable matches. Known
  entries are consumed; the first unknown entry gets at most **one** detail request per invocation, and the walk
  stops before a second one is needed.
- **Provider requests per chunk:** at most **2** (1 index + 1 detail), unchanged. The bulk-history-v1 reservation
  (2 for stored_index, unused part refunded) is unchanged.
- **Validation:** `data.length ≤ 20`. The `results` counters must be finite non-negative safe integers with
  `returned == data.length` and `before + returned + after == total`; anything else fails closed.
- **Exhaustion signals:** `after == 0`, or a page shorter than 20 when the counters are absent.
- **Raw ids:** raw match ids are hashed immediately and live only inside the invocation. Nothing new is persisted.

## Safety

| Concern | Handling |
|---|---|
| Mutable index (new matches at the front) | Later entries shift towards later pages: they can be re-read (cheap, idempotent) but never skipped. An in-progress page whose fingerprint changed restarts at item 0 (unchanged rule). |
| Repeated page | Same stall → pause → incomplete termination (`provider_repeated_page`); never treated as exhaustion. |
| Detail 404 | `detailUnavailableCount` +1, nothing fabricated, the walk continues (unchanged). |
| Season evidence | `fillKnownMatchSeasons` runs for every known entry on the fetched page in one batched statement, so the larger page fills more per request. |
| Consent | Checked before every provider request (unchanged). |
| Time budget | Checked per entry. Phase-3 stored chunks took ~1.2 s; a 20-entry known page adds only the HMAC and season-fill queries. |

### Cursor version and old-cursor transition

- `sync_cursors.history_rule_version` (existing column, no migration) is now `deep-history-v2`.
- A cursor still marked `deep-history-v1` that is **inside stored_index** had its page and item coordinates
  written in 3-entry pages. They cannot be safely offset-rebased on a mutable index, so the next chunk
  **restarts stored discovery at page 1**: `storedPage=1`, `storedItemIndex=0`, and no repeat comparison against
  the old fingerprint.
- At 20 entries per request, re-walking the known prefix is cheap, and it cannot skip anything.
- The first successful v2 chunk persists `deep-history-v2`. Until then the restart simply repeats.
- **live_v4** v1 cursors keep their position; the label becomes v2 on the next success.
- **complete** cursors are never reopened by the version change; this is tested.
- Public status `history.ruleVersion` now reports the cursor's real version (`deep-history-v1 | deep-history-v2`).
- Chunk telemetry adds `storedCursorRestarts`.

`sourceExhausted` keeps its meaning (provider-visible sources exhausted). `lifetimeComplete` stays **false**.
The external Tracker reference is never a cursor, stop or exhaustion input.

## Local request benchmark

`tests/storedIndexEfficiency.test.ts` runs the real HistoricalSyncService on PGlite. The old algorithm is the
same code with `storedPageSize: 3`.

| Scenario | Entries | Unknown | Old index | New index | Detail | Index reduction | Total requests old → new |
|---|---|---|---|---|---|---|---|
| A all durable | 1,500 | 0 | 500 | 75 | 0 | **85 %** | 500 → 75 |
| B Phase-3 density | 1,500 | 14 | 500 | 75 | 14 | **85 %** | 514 → 89 (−83 %) |
| C half unknown | 600 | 300 | 323 | 300 | 300 | 7 % | 623 → 600 |

In C the one-detail-per-call bound dominates. Every unknown still needs its own detail request, so a larger page
cannot help.

**Exactness:** in every scenario the old and new algorithms discover **exactly** the same unknown set and reach
the same exhaustion conclusion. Detail requests equal the unknown count, and each chunk uses ≤ 2 provider
requests.

**Additional tests:**
- page-boundary clusters
- detail 404
- mutable index growth during the walk and mid-page shifts
- v1 stored cursor upgrade (restart at page 1, new and older unknowns found, no duplicates, complete cursor not reopened)
- crash/resume (detail timeout, failed cursor commit after persistence, index timeout)
- season fill on 20-entry pages
- repeated page stall
- consent revoked
- more than 20 rows → MALFORMED
- two-lane 6 RPM controller window ≤ 6 with no same-account concurrency

## External sanity reference (read-only, never an input)

The human supplied 滑鏟's Tracker.gg figures (Competitive, all Acts): V26:A1 24, A2 72, A3 61, A4 201,
A5 82, total 440 (242 W / 191 L). This is an **EXTERNAL SANITY REFERENCE ONLY**: it is not provider evidence,
not a cursor, not a stop condition and not a completeness criterion.

Current durable evidence comes from the public read-only analysis API, captured 2026-10-07 before the Neon
transfer hold. It covers 滑鏟's Competitive appearances by our Act key:

| Act key | Durable appearances |
|---|---|
| e11a5 | 73 |
| e11a4 | 23 |
| e11a3 | 5 |
| Every older Act key | 0 |
| **Lifetime total** | **101** |

The V26:A1–A5 ↔ `e11a1–e11a5` key mapping is **NOT VERIFIED**, so a per-Act comparison is not stated. The
total difference (440 vs 101) is not a confirmed count of missing Riot matches. 滑鏟 is still in stored_index,
not source-exhausted. After the stored index is exhausted, a separate TASK-DATA-COVERAGE-AUDIT-01 should
evaluate this.

## Status (2026-10-07)

**IMPLEMENTATION IN PROGRESS / PRODUCTION ACCEPTANCE BLOCKED BY NEON TRANSFER QUOTA.**
- Neon reported 100 % of the monthly 5 GB public network transfer allowance.
- The implementation and every local gate are complete. Work is preserved in a local commit and has **not**
  been pushed, because a push triggers a Production deployment.
- 0 Production sync POSTs, 0 canaries, 0 provider calls.

**Pending once Neon transfer is restored:**
1. Push main and verify CI, Pages and Vercel.
2. Run the sequential canary: at most 3 `sync/continue` POSTs, one each for 加分, 小麻花 and 滑鏟, only if each
   is stored_index, ready or paused, with no backoff or lease. Each is ≤ 2 provider requests (6 total).
   - Expect `storedCursorRestarts` 1 on the first v2 chunk (restart at page 1) and up to 20 entries inspected per
     index request.
   - Stop on the first safety failure.
3. Run the read-only checks, then record acceptance.
