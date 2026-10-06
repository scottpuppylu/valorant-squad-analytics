# Official VALORANT Performance Score — evidence audit (TASK-DATA-PERFORMANCE-SCORE-01)

SDD STRICT, 2026-10-06. Starting HEAD `7368553`; checkpoint `checkpoint-before-performance-score-01`.

**Status: AUDIT COMPLETE / PHASE B BLOCKED.** The provider's Performance Score field is NOT VERIFIED.
- Phase-A outcome: **D**.
- Phase-B entry gate: **FAIL**.
- No ingestion, no migration, no public-contract or scoring change.
- **ACS: ACS_SAFE.** `stats.score` is still the legacy combat-score total.

## Official Riot evidence (semantic authority)

Source: Riot, *VALORANT Patch Notes 13.06*,
<https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-13-06/>, accessed 2026-10-06.
Patch go-live was 2026-09-22.

| Question | Answer |
|---|---|
| Name | Performance Score (表現分數); it replaces Average Combat Score |
| Range | 0–500 |
| Modes | Competitive, Unrated, Swiftplay, Premier |
| Replaces ACS? | Yes, for scoreboard position and MVP in those modes |
| Factors | Riot states it measures more than damage and kills. Players can view an end-of-game breakdown and a "Masterful" threshold. No itemised factor list is published |
| Formula | **NOT PUBLICLY DOCUMENTED** |
| Historical / retroactive availability | **NOT DOCUMENTED** (no retroactive scoring stated) |
| API / match-history change | Not mentioned by Riot |

Third-party coverage repeats the same facts and is not authoritative: thespike.gg, gameriv.com and an
AMA recap (youmind.com). Commentary that Performance Score "correlates with wins" and does not change
RR is unofficial and is not used.

## Henrik provider evidence (accessed 2026-10-06)

- **Public OpenAPI** <https://api.henrikdev.xyz/openapi.json>: `info.version` **4.6.0**, the same
  version this repository already assumed.
  - Searching every schema property for score / performance / combat / rating / contribution / mvp /
    acs finds no Performance Score field in match v4, match v2/v3, match detail or stored-match
    schemas.
  - `score` appears only as an undocumented `integer/int32` in: `MatchesV4DataPlayerStats.score`,
    `MatchesV4DataRoundPlayerStatsStats.score`, `MatchesV2Data*Stats.score` and
    `StoredMatchStats.score`.
  - Other matches are unrelated: esports-only `acs` / `rating` / `econ_rating`, team `score` (rounds),
    and MMR `rankedRating` / `games_needed_for_rating`.
- **API reference** (`docs.henrikdev.xyz/api-reference/valorant/get-matches-by-name-v4.md`) embeds the
  same 4.6.0 schema.
- **Changelog** (`docs.henrikdev.xyz/valorant/changes/*`):
  - The index names v4.9.0 as the latest change. v4.9.0 mentions no score change.
  - **v4.10.0 is labelled "Available on BETA"**. It says Match v4 responses "now include additional
    data where available", including **player performance scores, breakdowns, and ratings** and match
    and team MVPs.
  - No field names, types, ranges or availability rules are published, and the production OpenAPI
    does not contain them.
  - Interpretation: if it ships, Performance Score arrives as **additional, separate** data, not a
    redefinition of `stats.score`. This is consistent with the evidence below.

### Provider candidate fields

| Field path | Documented meaning | Type | Presence | Safe aggregate range | Classification |
|---|---|---|---|---|---|
| `players[].stats.score` (v4 history/detail) | None (undocumented int32) | int | Required | Durable post-13.06: per-match total median 3,720, max 10,499 | Legacy combat-score total (corroborated) |
| `rounds[].stats[].stats.score` | None (undocumented int32) | int | Required | NOT VERIFIED (round scores not in public data) | Legacy per-round combat score (assumed; additivity NOT VERIFIED) |
| `StoredMatchStats.score` | None | int | Required | n/a | Legacy combat score (stored list) |
| Performance score / breakdown / rating (v4.10.0 BETA) | "player performance scores … where available" | Unknown | Unknown | Unknown | **NOT VERIFIED**; no schema or live evidence |

## Live audit

**Provider requests: 0.** The targeted live audit could not run without weakening the security
boundary:
- `HENRIK_API_KEY` is scoped to **Production only**. Only Vercel env var names and targets were listed,
  never values.
- `/api/valorant/provider/audit` is disabled in Production by `assertProviderAuditAllowed()`, by
  design.
- Local runs hold no key, and asking for or copying the key is forbidden.
- Enabling a production audit path was rejected as a boundary weakening.

Prepared instead, with the boundary unchanged:
- **`provider-shape-inspector-v1`** (`server/evidence/shapeInspector.ts`). It discovers unknown
  field paths and reports only path, type counts, present/absent/null counts, and min/max for
  score-like leaves with at least 3 values.
  - Array indices collapse to `[]`.
  - Non-identifier keys (ids, `name#tag`) collapse to `{key}`.
  - Strings are never output.
  - Tests: `tests/providerShapeInspector.test.ts`.
- **Audit mode** `POST /api/valorant/provider/audit` with `{ "mode": "performance-score", …, "limit": 3 }`.
  - It uses the same function (still 12) and stays non-production only.
  - It makes 2 logical requests (v4 history `size=3` plus one v4 match detail), at most 4 HTTP
    attempts with 1 retry.
  - It never persists anything.

To run it, a maintainer must intentionally grant provider access to a Preview deployment
(`HENRIK_API_KEY` for Preview, docs/ADMIN_SETUP.md) and accept that decision. That is a human
security decision.

## Post-13.06 legacy score semantics

**Zero-provider evidence:** a read-only public dataset analysis of all 332 tracked matches, limited to
the Performance Score modes. The stored per-match total is reconstructed as `ACS × rounds`. Only
aggregates were kept.

| Era | Matches | Performances | ACS p10/p50/p90 | Per-match `score` total p50 / max | Share of totals > 500 |
|---|---|---|---|---|---|
| Before 2026-09-22 | 96 | 116 | 112 / 220 / 352 | 4,370 / 12,188 | 96.6% |
| 2026-09-22..23 (rollout) | 18 | 30 | 98 / 167 / 309 | 3,073 / 8,429 | 100% |
| From 2026-09-24 | 139 | 301 | 98 / 183 / 324 | 3,720 / 10,499 | 98.3% |

- **What does Henrik `stats.score` mean now?** The legacy combat-score *total* for the match. After
  13.06, 98.3% of values exceed 500, so it cannot be the 0–500 Performance Score. ACS remains
  continuous across the patch.
- **What did it mean historically?** The same combat-score total. ACS = score ÷ rounds is the
  long-standing derivation (REAL_DATA_FIELD_AUDIT.md).
- **Can `stats.score / rounds` still be called ACS?** **Yes: ACS_SAFE.** The provider documents no
  semantic change, BETA Performance Score is described as additional data, and stored post-patch
  magnitudes are combat-score totals.
  - Residual: Henrik never documents the meaning in prose.
  - Residual: round-level additivity is NOT VERIFIED.
  - If a future provider release changes `stats.score`, this audit must be repeated before trusting
    new rows.
- **Is the field stable across eras?** Observed stable from 2026-08-14 to 2026-10-05. There is no
  semantic break, so no ACS hotfix was needed or made.

## Phase-B decision

The gate needs an established official semantic (✓), a clearly identified provider field (✗), live
sanitized confirmation (✗), compatible types (✗) and separation from legacy score (✓, `score` stays
legacy). **FAIL.** Not implemented: `performance-score-evidence-v1`, the
`performance_score` column, normalization, contract, UI or coverage disclosure. The repository
contains **no** Performance Score values and **no** approximation.

When Phase B is later allowed, the rules are:
- A separate nullable `performance_score DOUBLE PRECISION` via the next append-only migration (0011).
- Never reuse `match_participants.score`.
- Store the observed value as-is (no rounding, rescaling or per-round division); validate 0–500 and
  finite.
- Missing / unavailable / unsupported is NULL, never 0; an observed 0 stays 0.
- A later valid value may fill NULL; missing or malformed values never erase; contradictions need an
  explicit policy.
- No historical backfill without a separate task.
- Deletion follows player-match evidence.
- Expose it descriptively only (VALORANT 表現分數 / 官方表現分數; 尚無表現分數資料 when absent).
- Never feed it into community-score-v2 without a separate scoring task.

## Future architecture (documented, NOT started)

- **TASK-SCORING-SHARED-MATCH-01 — Community Shared-Match Relative Rating.** When members A and B play
  in the same match, compare their per-match evidence under the same lobby, opponents and map.
  - Signals: the official Performance Score where observed, otherwise transparent fallback evidence
    under its own name.
  - Measures: pairwise deltas and relative win/tie/loss, accumulated over shared matches, with sample
    shrinkage and independent confidence.
  - Evidence stays account/match scoped; a member's union across accounts is formed before
    comparison, and accounts are never averaged first.
  - It is distinct from duo-synergy-v1, which asks whether two players do better together than apart.
- **TASK-DATA-RANK-01.** Rank/RR later becomes context, prior or calibration and a bridge for sparse
  comparison graphs. It is never a crude multiplier.
- Traditional ACS is not the intended primary comparison basis. community-score-v2 is unchanged until
  a separate scoring task.
