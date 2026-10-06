# Analytics mode eligibility — `mode-eligibility-policy-v1` (TASK-DATA-MODE-POLICY-01)

SDD STRICT, 2026-10-06. Starting HEAD `20c2dcc`; checkpoint `checkpoint-before-mode-policy-01`.

## Product rule

The product compares internal community members fairly. Members play at different Riot ranks against
different lobby strengths, so absolute individual statistics must never mix queue environments.

| Purpose | Competitive | Unrated | Other |
|---|---|---|---|
| Absolute player metrics (K/D, ADR, ACS, KPR, APR, HS%, KAST, FK/FD, clutch, economy…) | YES | NO | NO |
| Community Score (community-score-v2, all 8 dimensions + Overall) | YES | NO | NO |
| Current Strength / Recent Form | YES | NO | NO |
| Progress (improvement-index-v1) | YES | NO | NO |
| Map / Agent / Role / Act strength | YES | NO | NO |
| Weapon strength (weapon-analytics-v2) | YES | NO | NO |
| Current Synergy (duo-synergy-v1) | YES | NO | NO |
| Future Shared-Match Relative (TASK-SCORING-SHARED-MATCH-01) | YES | YES | NO |
| Match History (browse) | YES | YES | YES |

- **"Other"** covers Premier, Custom, Swiftplay, Deathmatch, Team Deathmatch, Spike Rush, Escalation, Gauntlet and event
  queues. **Premier is deliberately excluded.**
- **Unknown or future modes fail closed:** they are browse-only. A new eligible mode needs explicit product authorization.
  There is no fuzzy "looks competitive" rule, and matching is exact on the normalized mode (`src/utils/gameMode.ts`,
  unchanged).

### Unrated

Unrated is eligible **only** for future within-the-same-match A-vs-B comparison. The same match approximately controls
the lobby, opponents, map, patch, duration and team environment.
- Allowed future use: in the same Unrated match, A's evidence minus B's evidence, relative win/tie/loss, or shared-match
  relative impact.
- Not allowed: A's average Unrated K/D, ADR or ACS, an Unrated Overall or community score, or any cross-match absolute
  aggregate.
- A future engine may read raw Unrated rows internally to form within-match deltas, but must never publish them as an
  absolute rating.

### Why current Synergy is Competitive only

duo-synergy-v1 compares a pair's shared window against each member's baseline appearances **without** the partner, using
community-score-v2 Overall. That compares *different* matches and lobbies, so it is an absolute-strength consumer, not a
same-match engine. The formula is unchanged; only its population is Competitive.

## Implementation

**Policy module** `src/analytics/modeEligibility.ts`:
- Exports `MODE_ELIGIBILITY_POLICY_VERSION`, `isAbsoluteStrengthMode`, `isSameMatchRelativeMode`, `isBrowseMode`,
  `eligibleModesFor(kind)`, `isEligibleMode` and `requestedModeAllowed`.
- It is pure, and shared by the server (REAL) and the browser (Demo), so there is no divergence.

**Single enforcement point** (`feature-scope-policy-v3`):
- `featureScopePolicies[*].queues` derive from the policy: every strength feature is `['Competitive']`, and only
  `matchHistory` is `'all'`.
- `resolveScopeSelection` (analysis-scope-v1) applies the feature's queues **before every horizon**: current, lifetime,
  Act, recent N and custom. All REAL server analysis and all Demo analysis pass through it.
- An explicitly requested ineligible mode (for example a legacy `?mode=Unrated`) yields `unavailable` /
  `queue_excluded_by_policy` and never computes.
- Players whose context is entirely non-Competitive stay listed as unavailable with `queue_restricted_by_policy`.
- Match History (`lifetimeFeature: 'matchHistory'`) is the explicit browse exception, recent N included.
- `matchesInPairContext` (the PAIR horizon, server and Demo) applies the synergy policy.

**Adaptive anchor:** `populationFromMatches` derives the anchor and floor from Competitive evidence only, so newer Unrated
or entertainment play cannot shift strength-window freshness. adaptive-window-v1 itself is unchanged.

**Weapons (`weapon-analytics-v2`):**
- ALL / ACT / CURRENT use Competitive queue keys only, both in server SQL and in the Demo engine.
- `mode=all` means every eligible mode; an ineligible mode is `queue_excluded_by_policy`.
- This is a population contract change only. Formulas, thresholds and weapon-catalog-v2 are unchanged.

**`view=analytics`** (additive, identifier-free):
- `modeEligibility { policyVersion, competitiveMatches, unratedMatches, otherMatches }`.
- `facets.competitiveTeamOutcome` is the performance number used by the Dashboard 小隊排位勝率.
- `facets.teamOutcome` and `evidence.queues` stay all-mode inventory.

**`view=analysis`:** additive `modeEligibilityPolicyVersion`. The `server-analysis-v2` structure is unchanged.

**UI:**
- Strength pages label 全部已追蹤排位 / 最近 N 場排位 / 指定 Act（排位）.
- The mode selector offers only 排位. A legacy ineligible mode shows a disabled option and an alert (此分析僅使用排位模式…)
  with 改用排位.
- Synergy and Weapons lock to 排位. The Dictionary explains the policy.
- Matches (`browse`) keeps every mode with all-mode labels.

**Storage and acquisition are unchanged.** Nothing is deleted or hidden from history. Ingestion, pagination, page size,
cursor, bulk, cron and FASTSYNC are untouched. No migration.

### Versions

| Version | Status |
|---|---|
| `mode-eligibility-policy-v1` | **NEW** |
| `feature-scope-policy-v2` → **v3** | Queue eligibility only; bounds unchanged |
| `weapon-analytics-v1` → **v2** | Population contract only |
| community-score-v2, community-benchmarks-v1, overall-profile-v1, duo-synergy-v1, improvement-index-v1, adaptive-window-v1, analysis-scope-v1, server-analysis-v2, selection-summary-v1, analytics-context-v1, weapon-catalog-v2 | **Unchanged** |

## Previous-behavior audit

| Feature | Previous queues | New eligibility | Enforcement | Was wrong? |
|---|---|---|---|---|
| currentStrength (Dashboard, Leaderboard, Compare, Profile default) | Competitive | Competitive | resolveScope + adaptive window | No |
| recentForm (current + baseline) | Competitive | Competitive | Adaptive window; anchor now Competitive-only | Anchor could shift from other modes; fixed |
| improvementIndex (current + baseline, Act fallback) | Competitive | Competitive | Progress windows; anchor fixed | Same as above |
| lifetimeTotals (全部已追蹤) | all | Competitive | resolveScope | **Yes**; fixed |
| mapStats (Maps page) | all | Competitive | resolveScope | **Yes**; fixed |
| agentStats / roles (Agents page) | all | Competitive | resolveScope | **Yes**; fixed |
| actOverview | all | Competitive | resolveScope | **Yes**; fixed |
| fixedRecent 10/30 | all (latest N of any mode) | latest N Competitive | resolveScope | **Yes**; fixed |
| trends / recent six (PlayerAnalytics.recent) | Selection's modes | Competitive (from the selection) | resolveScope | **Yes** for lifetime/recent; fixed |
| custom dates | all | Competitive | resolveScope | **Yes**; fixed |
| synergy (duo-synergy-v1) | all | Competitive | matchesInPairContext | **Yes**; fixed |
| Weapons ALL / ACT | mode param (default Competitive; `all` = every mode) | Competitive | Server SQL queue keys + Demo engine | **Yes** for `mode=all` / other modes; fixed |
| Weapons CURRENT | currentStrength (Competitive) | Competitive | Analysis | No |
| Dashboard 小隊勝率 | All tracked modes | Competitive (`competitiveTeamOutcome`) | view=analytics | **Yes**; fixed |
| Dashboard 已追蹤 N 場 | Inventory | Inventory (all modes) | — | No (inventory) |
| Matches / History | all | all (browse) | matchHistory exception | No |

## Verification

**Tests** (`tests/modeEligibility.test.ts`; existing suites updated to Competitive semantics):
- The mode matrix covers 12 strings, including unknown values and the lowercase `competitive`. Normalization keeps
  Competitive, Premier and Unrated distinct, and every policy queue is checked.
- **Mixed fixture:** Demo Competitive evidence plus extreme Unrated / Swiftplay / TDM / DM / Premier / Custom / future-mode
  copies (60 kills, ACS 900, ADR 600), both interleaved and newer than everything. The summaries are **byte-identical**
  for:
  - lifetime, current, recent 10/30, custom, map and agent;
  - Act (Competitive rows only);
  - Improvement Index (values, windows and confidence identical; only the disclosure reason is added);
  - duo-synergy-v1 results;
  - weapon-analytics-v2 ALL and CURRENT.
- Recent N is the latest N **Competitive**. Legacy `mode=Unrated` computes nothing. History still browses every mode.
- **Server (PGlite):** 60 Competitive matches, plus or minus 40 extreme non-Competitive matches.
  - Every absolute feature (lifetime/map/agent/Act/recent/current+form/synergy/improvement) returns identical summary,
    synergy and progress, and identical `populationMatches`.
  - `mode=Unrated` returns no analytics, and `mode=Competitive` equals the default.
  - Context counts are 60 / 8 / 32. History returns all 100.
- **UI:** a legacy `?mode=Unrated` Leaderboard shows the alert, offers only 排位 and renders no ranking rows. Dashboard
  win rate ignores 1000 extreme Unrated/Swiftplay wins.

## Production read-only acceptance (2026-10-06, HEAD `ffc95c0`; 0 provider calls, 0 writes)

**Queue distribution** (tracked 671):

| Mode | Matches |
|---|---|
| Competitive | **309** |
| Unrated | **157** |
| Deathmatch | 65 |
| Swiftplay | 56 |
| Custom | 45 |
| Gauntlet: Glitched | 21 |
| Team Deathmatch | 16 |
| Escalation | 1 |
| Spike Rush | 1 |
| Premier | 0 |

`modeEligibility` = 309 / 157 / 205.

**Absolute proof:** every `server-analysis-v2` response reported `feature-scope-policy-v3`, `mode-eligibility-policy-v1`,
scope queues `["Competitive"]`, tracked 671, `populationComplete` true and `populationLimit` null.

| Feature | populationMatches |
|---|---|
| lifetimeTotals / mapStats / agentStats | **309** (= Competitive) |
| actOverview e11a5 | 226 |
| fixedRecent 10 | 53 |
| currentStrength + form | 130 |
| Profile form | 30 |
| improvementIndex | 21 |
| synergy | 309 (36 pairs) |

- The default `lifetimeTotals` summary is byte-identical to an explicit `mode=Competitive` request.
- `mode=Unrated` / `mode=Swiftplay` return 0 players with `queue_excluded_by_policy`; `synergy mode=Unrated` returns 0 pairs.
- Weapon v2: ALL (Competitive only, 16,022 eligible rounds) and ACT / CURRENT are 200. `mode=Unrated` is `unavailable` /
  `queue_excluded_by_policy`.
- 0 non-finite values and no leaks.

**Inventory and browse:**
- The Dashboard shows 已追蹤 671 場 (inventory) and 小隊排位勝率 51.5% (159/309 Competitive; all-mode inventory 289/671).
- History browses all 671 matches across all 9 modes.
- In the browser, the legacy Leaderboard `?mode=Unrated` shows the alert and 0 ranking rows.
- Demo (Pages): 0 `/api` calls, mode locked to 排位.

**Timing** (read-only, single requests):

| Feature | Before | After |
|---|---|---|
| `lifetimeTotals` | 17.7 s | **7.1 s** (phase 2 now loads 309 Competitive, not 671) |
| `synergy` | 10.8 s | 5.9 s |
| `currentStrength` | 5.3 s | 4.9 s |

This is an incidental reduction from filtering. The **analysis latency risk remains OPEN**: the architecture is still
linear in the Competitive population (see BULK_HISTORY.md).

## Out of scope / unchanged

- Bulk Phase 2 is still STOPPED / BLOCKED (the DATABASE_ERROR is NOT RESOLVED).
- Analysis latency risk: OPEN.
- Performance Score: PHASE B BLOCKED (no audit run). ACS_SAFE; ACS is used for Competitive-only analytics.
- Rank: NOT STARTED. Shared-Match Rating (Competitive + Unrated): NOT IMPLEMENTED.
- V1: NOT RELEASED.
