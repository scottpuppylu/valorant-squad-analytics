# Rank evidence — TASK-DATA-RANK-01

**STATUS: COMPLETE / AWAITING SDD REVIEW (2026-10-07).**
- **RANK_IS_CONTEXT_NOT_FINAL_SCORE = YES.**
- **NO_CRUDE_MULTIPLIERS = YES.**
- **Not built:** no strength score, rank weight, multiplier, MMR / Elo estimate, scoring change or UI change.

Rank evidence is **context / prior / calibration** for TASK-SCORING-SHARED-MATCH-01 and
TASK-SCORING-INTERNAL-STRENGTH-01. Rank alone is never Community Internal Strength.

## Architecture

| Layer | Module | Role |
|---|---|---|
| Provider-independent interface | `src/analytics/rank/tiers.ts` (`valorant-tier-order-v1`), `src/analytics/rank/rankContext.ts` (`rank-context-v1`) | Tier ordering, `RankEvidence`, `resolveRankContextAt()`, `rankCoverage()` |
| Provider-specific (below the boundary) | `server/rankEvidence/henrikRankParser.ts` (`henrik-rank-parser-v1`) | Henrik v3 MMR, v2 stored MMR history, v4 `players[].tier` |
| Private store | `server/rankEvidence/rankStagingStore.ts` (`rank-staging-v1`) | `rank_staging` schema in the private staging database. It references `rebuild_staging.accounts` (stable private account id, never Name#Tag); no raw provider account id |
| Ingestion / report | `server/rankEvidence/rankIngestion.ts`, `rankReport.ts`, `npm run rank:ingest -- snapshots \| fetch \| report` | Bounded, resumable; private gateway; community-name-only report |

**Isolation:**
- Canonical tables are untouched. `rank_observations` (migration 0001) stays unused; no migration was added.
- Consent, `activePlayers`, publication and the exporter are unchanged.
- Guarded by `tests/rankEvidence.test.ts` (no canonical imports or writes; no public importer; no multiplier or final
  score identifiers).

## Provider contract (Henrik; [docs index](https://docs.henrikdev.xyz/llms.txt), accessed 2026-10-07)

| Endpoint | Fields used (DOCUMENTED) | Notes |
|---|---|---|
| `GET /valorant/v3/mmr/{affinity}/pc/{name}/{tag}` | `current.tier{id,name}`, `rr`, `elo`, `last_change`, `games_needed_for_rating`, `rank_protection_shields`, `leaderboard_placement`; `peak.season{id,short}`, `tier`, `rr`, `ranking_schema`; `seasonal[].season`, `wins`, `games`, `end_tier`, `end_rr`, `ranking_schema`, `act_wins` | One request returns current, peak and seasonal. Current has no season field |
| `GET /valorant/v2/stored-mmr-history/{affinity}/pc/{name}/{tag}?size=100` | `data[].match_id`, `date`, `tier`, `season`, `rr`, `last_change`, `elo`, `refunded_rr`, `was_derank_protected`, `map`; `results.total/returned/before/after` | Returned `total = returned` for all 9 accounts (19–28 rows), so no pagination was needed |
| v4 match `players[].tier{id,name}` plus `metadata.started_at/season/queue` (already-hydrated private documents) | — | 0 provider requests |
| Not used | `/v2/mmr-history` (overlaps stored history), `/v1|v2 mmr` (superseded by v3) | — |

**Cost:** 18 requests (9 × 2). Henrik budget headers: limit 30 / 60 s, remaining never below 21. Weighted cost was about
1–2 units per request.

### Semantics established from the data (INFERRED, aggregate checks only)

- **`players[].tier` is the PRE-match tier.**
  - In all 20/20 matches where the tier changed between the previous and the same match's history rows, the in-match
    tier equals the previous post-match tier, and 0/20 equal the post-match tier.
  - 171/171 snapshots with a known previous row equal it.
- **Stored-history rows are POST-match state stamped at the match start.** The median gap to the match start is
  0.46 s. `rr` is 0–100 on 196/196 rows.
- **`elo` is not a hidden rating.**
  - It is DOCUMENTED only as an undescribed integer.
  - It equals `(tier_id − 3) × 100 + rr` on **196/196** rows: a linear encoding of the visible tier and RR.
  - It is stored as `providerElo`, carries no information beyond tier + RR, and is **never called Riot MMR**.
- **Stored MMR history is short.** 7 of 9 accounts returned exactly 20 rows, the others 28 and 19, covering
  2026-08-28 → 2026-10-07. A provider-side cap is suspected but not documented.

## Normalized model

- **Evidence kinds:**
  - `match_snapshot`: the in-match tier, pre-match.
  - `history`: a post-match stored row.
  - `current`: as of the fetch.
  - `peak`: the highest ever; not point-in-time.
  - `seasonal`: per-season summary as of the fetch.
- **Every row keeps:** observed provider facts (`providerTierId/Name`, `rr`, `providerElo`, `rrChange`, season, queue);
  the source endpoint; `effectiveAt` (when the value was true); and `first/last_ingested_at`.
- **Derived normalization** (`normalized_tier_key`, `tier_ordinal`, `tier_model_version`) is stored separately.
- **Tier ordering:**
  - Iron 1 = 1 … Immortal 3 = 24, Radiant = 25. Unranked / Unrated have no ordinal.
  - Normalization is by tier **name**. A numeric id is mapped only for the current (Ascendant-era) schema, because
    pre-Ascendant ids 21–24 meant Immortal 1–3 / Radiant.
  - An unknown or new tier name stays unknown.
  - `tierOrdinal` is ordering metadata only: no equal-interval or skill-distance claim.
- **Idempotency (`evidence_key`):**
  - one row per (account, match) for snapshots and history;
  - one row per distinct observed state for current and peak; re-observation bumps `observation_count`, a changed state
    is a new row;
  - one row per (account, season) for seasonal, updated in place.
  - Re-ingestion created 0 rows; a resumed fetch sent 0 requests.

## Point-in-time contract (`resolveRankContextAt(evidence, account, at, matchRef?)`)

1. **Exact match:** an in-match `match_snapshot` of this match.
2. **Prior observation:** otherwise the latest point-in-time evidence (`match_snapshot`, `history`, `current`)
   **strictly before** `at`, excluding post-match rows of the same match.
3. **Unknown:** otherwise. `laterEvidenceExists` is informational only.

**No future leakage:**
- `peak` and `seasonal` are never used point-in-time.
- `current` applies only after it was observed.
- Nothing is backfilled.
- Tests prove that current and peak are not projected backward and that a match never sees its own result.
- On real data, every member's earliest staged match resolves to `exact_match` (match snapshot), never current or peak.

**Coverage:** `rankCoverageStart/End`, `rankObservationCount`; `rankHistoryCompleteness = "unknown"` always (no
documented completeness).

## Results (private staging; community names only)

| Member | Current | RR | Peak | Peak season | Seasons | Stored history | Match snapshots (Competitive, ranked) | Coverage start → end | Completeness |
|---|---|---|---|---|---|---|---|---|---|
| jack | Platinum 1 | 33 | Platinum 3 | e11a3 | 13 | 28 | 166 (105, 99) | 2025-01-25 → 2026-10-07 | unknown |
| 加分 | Gold 1 | 0 | Gold 2 | e11a5 | 10 | 20 | 267 (142, 142) | 2025-03-21 → 2026-10-07 | unknown |
| 夏天 | Silver 2 | 30 | Silver 3 | e11a3 | 8 | 20 | 131 (85, 85) | 2024-01-13 → 2026-10-06 | unknown |
| 天堂 | Silver 3 | 48 | Silver 3 | e11a5 | 5 | 20 | 180 (89, 87) | 2026-01-09 → 2026-10-03 | unknown |
| 小麻花 | Bronze 3 | 72 | Silver 2 | e11a5 | 3 | 20 | 229 (102, 102) | 2026-05-26 → 2026-10-04 | unknown |
| 滑板車 | Gold 1 | 0 | Gold 1 | e11a5 | 6 | 20 | 173 (73, 72) | 2026-01-29 → 2026-10-06 | unknown |
| 滑鏟 | Gold 3 | 57 | Gold 3 | e11a5 | 5 | 20 | 240 (102, 99) | 2026-02-15 → 2026-10-06 | unknown |
| 走路 | Platinum 3 | 0 | Platinum 3 | e11a5 | 13 | 19 | 167 (68, 67) | 2024-08-27 → 2026-10-06 | unknown |
| 魔王 | Platinum 1 | 10 | Platinum 1 | e11a5 | 6 | 20 | 164 (75, 72) | 2026-01-25 → 2026-09-28 | unknown |

**Totals:** 9 current, 9 peak, 69 seasonal, 187 history, 1 717 match snapshots. Earliest observation 2024-01-13,
latest 2026-10-07.

## Data-quality answers

| Question | Answer |
|---|---|
| A. Current rank for all 9? | YES, 9/9 |
| B. Peak rank for all 9? | YES, 9/9 |
| C. Members with usable historical observations | 9/9: stored history (19–28 rows) and in-match snapshots for every staged match |
| D. How far back? | Stored MMR history only to 2026-08-28. In-match snapshots as far as the provider-visible matches (2024-01-13 at earliest; per-member starts in the table) |
| E. Associated with matches / timestamps? | YES. Snapshots are per match; history rows carry the match id (→ private match ref) and date |
| F. Enough for point-in-time calibration? | YES within the provider-visible window: every staged Competitive match has the exact pre-match tier (67–142 ranked Competitive snapshots per member). Before a member's coverage start: UNKNOWN |
| G. Rating / Elo-like field? | YES, `elo`; provider docs give no description |
| H. Documented as Riot MMR? | NO. Empirically it is `(tier_id − 3) × 100 + rr`, so it is not called MMR |

**Recorded for SDD, not integrated:** the v4 player objects contain a `performance` key. Its semantics were not
examined (TASK-DATA-PERFORMANCE-SCORE-01 stays separate).

## Shared-Match readiness

The next task needs only `RankEvidence` + `resolveRankContextAt` / `rankCoverage` (`src/analytics/rank`). Evidence can
be loaded with `RankStagingStore.evidence()`. Provider shapes stay in `server/rankEvidence`. Mode policy is unchanged
(mode-eligibility-policy-v1): snapshots record their queue; consumers filter.

## Unresolved

- Whether Henrik caps stored MMR history at about 20 rows (NOT_DOCUMENTED).
- No rank evidence before each member's provider-visible match coverage (see HISTORY_COVERAGE_GAP.md).
- Canonical import of rank evidence (later, with reconciliation).
- How rank context influences strength: decided only by the scoring tasks. No weights here.
