# TASK-DATA-03B — Full-history runtime consumption

Governance: SDD STRICT. Started 2026-10-05 from HEAD
`e8884d7cc5b21b946be920eaed3d8aec4387ad0b`; checkpoint tag
`checkpoint-before-data-03b-full-history-runtime` pushed before implementation.

## Split

| Task | Scope | Status |
|---|---|---|
| **DATA-03B.1** | Bounded keyset history runtime + browse-only consumption | **IMPLEMENTED** (deployment acceptance below) |
| **DATA-03B.2** | All-history analytical aggregation / scalable scoring consumption | **NOT STARTED** |

DATA-03B.1 makes every eligible durable match in Neon **browsable**. It does
**not** make rankings, community-score-v2, benchmarks, profiles or Synergy
consume the full tracked history. Do not describe DATA-03B as "full-history
analytics complete".

## Analytics consumption decision: STAGED

Inspection of the browser pipeline:

- `buildAnalytics(dataset)` → `buildPlayerAnalytics(players, matches)` scores every
  player from every match in the in-browser dataset; `selectPerformances` and the
  recent10/recent30 periods slice the same array.
- community-score-v2 / community-benchmarks-v1 / overall-profile-v1 sample gates and
  confidence depend on match count; duo-synergy-v1 aggregates pair evidence across
  all matches in the dataset.

Merging history pages into that dataset would silently change every score's
meaning (from "newest ≤300 tracked matches" to "however many pages this visitor
happened to load") and make results differ per visitor. Client-side full loading
is also not scalable: measured ≈3 KB per 4-player match, so 10,000 tracked
matches ≈30 MB per visitor.

Decision:

1. **DATA-03B.1 (this change)** — paged history is **browse-only**. Analytics keep
   the unchanged schema 4 newest-300 snapshot and the UI labels it as the analysis range.
2. **DATA-03B.2 (future, needs explicit authorization)** — all-history analytics
   should be **server-aggregated** (bounded per-player/per-pair aggregates computed
   server-side and versioned), not client-paged. It requires its own SDD plan because
   it changes scoring inputs and needs SCORING.md/SYNERGY.md updates and tests.

## Runtime architecture

```text
Neon durable evidence (DATA-05A cron keeps appending)
  ├─ GET /api/valorant/dataset                 (unchanged schema 4 snapshot)
  │    → newest 300 → buildAnalytics()  → all analysis routes
  └─ GET /api/valorant/dataset?view=history    (DATA-03B.1)
       → PostgresDatasetReadRepository.readHistoryPage (≤6 statements)
       → DatasetProjectionService.readHistory (same per-match projection)
       → useTrackedHistory (Matches page only, in memory)
       → browse list = snapshot ∪ history pages (deduped); never buildAnalytics()
```

**Deviation from the proposed separate endpoint:** the project is at exactly 12
Vercel Functions (Hobby limit; DATA-05A already consolidated cron routes for this
reason). A new `api/` file would break deployment, so history is an explicit
`view=history` mode of the existing function. Absent `view` keeps the original
behaviour byte-for-byte (other query parameters are still ignored); an unknown
`view` returns 400.

## Pagination contract (`dataset-history-v1`)

Query: `view=history`, optional `limit` (1–100, default 50; anything else → 400),
optional `cursor` (signed, ≤200 chars) **or** `before` (lowercase public match UUID).
Both → 400. Array-valued parameters → 400.

Response (`Cache-Control: no-store`):

```text
ok, schemaVersion: 4, view: 'history', historyVersion: 'dataset-history-v1',
projectionVersion: 'evidence-decoupled-projection-v1', state: ready|empty,
page:    { limit, traversedMatchCount, withheldMatchCount, from?, to?, hasMore, nextCursor|null }
tracked: { trackedMatchCount, earliestTrackedAt?, latestTrackedAt?, lastSyncedAt?, lifetimeComplete: false }
evidence: same availability shape as the snapshot (for this page)
dataset: { players, matches, sourceId: 'durable-neon-v4', isDemo: false, mode: 'REAL' }
```

- Order: `(started_at DESC, public_id DESC)`, deterministic for exact timestamp ties.
  Matches without `started_at` are never projectable and are excluded.
- `hasMore` is computed from a `pageSize + 1` key probe; final page has `nextCursor: null`.
- `traversedMatchCount` counts eligible keys the page covered; `withheldMatchCount`
  counts those omitted because no visible performance had complete core evidence
  (existing DATA-02 rule). The cursor advances past withheld matches, so a page may
  hold fewer matches than `limit` (even zero) while `hasMore` is true.
- Matches are the same sanitized `MatchRecord`s as the snapshot: eventEvidence,
  partial/unavailable KAST/Opening without values, advancedMetrics statuses and
  synergyEvidence are preserved. Missing evidence is never manufactured as zero.
- The browser validator rejects any `lifetimeComplete` other than `false`, pages
  larger than `limit × 2`, `nextCursor` over 200 characters or inconsistent with `hasMore`, and every existing match/performance violation.

## Cursor design

`<base64url(JSON {v:1, t:"<epoch microseconds>", p:"<public match uuid>"})>.<base64url HMAC-128>`

- Position only: exact `started_at` microseconds (JS `Date` would lose them and
  break tie ordering) and the public match UUID, which is already browser-visible.
  No internal UUID, provider match ID, lookup HMAC, player scope, snapshot ID or expiry.
- MAC: `HMAC-SHA256(IDENTIFIER_HMAC_KEY, "dataset-history-cursor:v1\0" + payload)`
  truncated to 128 bits, verified with `timingSafeEqual`. Domain separation keeps it
  unrelated to identity lookup HMACs. Missing key fails closed (generic 502).
- Every failure (length, shape, MAC, JSON, version, extra field, int64 range, UUID
  format) returns the same generic 400 `BAD_REQUEST`; internals are never echoed.
- `before=<public match id>` resolves the anchor's exact key server-side and only if
  that match is **currently** eligible; otherwise generic 400. The browser falls back
  to the newest page and deduplicates.

## Consent / revocation safety

Both SQL phases recompute the active-player set (non-anonymized, active membership,
exactly one active `self_asserted` consent on `2026-10-02-public-v1`). A cursor
authorizes nothing: after revocation between page 1 and page 2, page 2 omits the
player, their performances and any match visible only through them, and the player
list no longer includes them. Already-loaded pages stay in that tab's memory until
reload — identical to the existing snapshot semantics. Nothing is written to
localStorage/sessionStorage. Deletion/revocation semantics are unchanged.

## Cron-mutation safety

DATA-05A may insert newer or older matches during traversal.

- **Phase 1** (one statement): eligible keys strictly below the cursor bound
  (`LIMIT pageSize+1`) plus the tracked summary.
- **Phase 2** (five parallel statements): detail rows for the key **range**
  `[oldest page key, cursor bound)` — never an internal ID list. A match inserted
  inside the range between phases is included rather than skipped.
- The next cursor is the oldest page key (exclusive), so consecutive pages cannot overlap:
  no duplicates, and strictly decreasing positions make loops impossible.
- Newer inserts sit above every outstanding cursor and do not appear in the current
  traversal (they appear on refresh). Older inserts below the cursor are reached normally.
- A match inserted above the cursor but below already-shown items is not shown in
  that traversal (bounded to concurrent inserts; reload shows it). No large skips.
- `started_at` is rewritten from the provider on overlap; upstream start times are
  effectively immutable. Defence in depth: the browser deduplicates by public match ID.
- The keyset upper bound is the traversal's stable boundary; no internal snapshot
  identifier is created or exposed.

## `trackedMatchCount`

Count of distinct durable matches with a non-null start time and at least one
participant who is **currently** visible. It includes matches withheld for
incomplete core evidence. It is not a Riot lifetime total, not provider exhaustion
and does not imply completeness; `lifetimeComplete` stays `false`. It is computed in
the phase-1 statement from the same eligibility join the snapshot already performs
(index `match_participants_player_idx` + primary keys), so no separate scan is added.

## UX (Matches page, PUBLIC REAL only)

- 分析範圍：最新 N 場（排行榜、評分與搭檔分析只使用此範圍）
- 目前載入範圍：已載入 X 場 · 最早已載入日期
- 已追蹤戰績：N 場 · 最早已保存紀錄 · 最近同步時間
- 仍有更舊資料可載入 / 已載入全部已追蹤戰績 · 「載入較舊戰績」 button
- Explicit note: 已追蹤戰績不是完整生涯紀錄；歷史資料持續補齊中.
- On visiting the Matches page, one page (≤50) older than the snapshot is requested;
  other routes never request history. GitHub Pages/Demo never requests it.

## Migration

None. The phase-1 eligibility join is the same join the newest-300 snapshot already
runs on every load (`match_participants_player_idx`, primary keys, then a sort of the
eligible set). Range filters in phase 2 apply to that small eligible set. At current
(56) and projected (tens of thousands) sizes this is bounded per-request work; an
index on `source_matches (started_at DESC, public_id DESC)` would only help if the
eligible set were not already filtered by player participation. Revisit with
`EXPLAIN ANALYZE` on Neon if tracked history exceeds ~50,000 matches.

## Measurements (disposable PGlite, one local run; not Neon latency promises)

`limit=100`; fixtures have one round per match and no kill events.

| Fixture | Page SQL | First-page DB ms | Projection ms | First-page bytes | Traversal | Max page bytes | Browser merge (all pages) | Snapshot bytes |
|---|---:|---:|---:|---:|---|---:|---:|---:|
| 1 player / 50 | 6 | 21.48 | 1.52 | 44,723 | 1 page, 38 ms | 44,723 | 0.04 ms | 44,548 |
| 4 players / 300 | 6 | 51.44 | 6.87 | 300,128 | 3 pages, 314 ms | 300,128 | 0.17 ms | 896,033 |
| 4 players / 1000 | 6 | 81.64 | 3.72 | 300,129 | 10 pages, 965 ms | 300,129 | 1.02 ms | 896,033 (capped at 300) |

Empty page: 2 statements. No N+1: statement count is constant per page regardless of
size. The snapshot remains exactly 6 statements and capped at 300 matches.

## Tests

`tests/datasetHistory.test.ts` (17) and `tests/historyBrowse.test.tsx` (3): first /
next / final page, default size, repeated-read boundary stability, exact duplicate
and microsecond-distinct timestamps across page sizes 1–3, zero matches, withheld
matches, one and multiple players, invalid/tampered/foreign-key/structurally invalid
signed cursors, page-size and parameter validation, `before` anchors (unknown and
revoked), consent revoked between pages, newer/older/mid-range cron inserts during
traversal, snapshot ∪ history merge without duplicates, >300 and 1000-match fixtures,
no internal/provider/HMAC/secret-name exposure, disabled-mode fail-closed handler,
browser anchor fallback, analytics staying bounded, Demo never requesting history.

## Verification

Local gates (implementation commits c9755f2 / efbe261, 2026-10-05): lint PASS;
26 files / 373 tests PASS (53.23s), source secret boundary PASS; build PASS
(714 modules, 4.71s), dist secret boundary PASS; `npm audit --omit=dev` 0
vulnerabilities; `npm run db:validate` 16 PASS (20.17s). Full `npm audit`: 5 high
(braces, chokidar, fast-glob, micromatch, tailwindcss) — unchanged SEC-2026-001
scope, NOT FIXED, no force-fix. Function count unchanged at 12.

## Deployment / production acceptance

Pending at commit time; recorded in a follow-up commit.
