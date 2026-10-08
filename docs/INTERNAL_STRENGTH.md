# Community Internal Strength — TASK-SCORING-INTERNAL-STRENGTH-01

**STATUS: PHASE A COMPLETE / OUTCOME_B / AWAITING SDD REVIEW (2026-10-08).**

| Item | Value |
|---|---|
| GROUP_RELATIVE | YES |
| NOT_RIOT_MMR | YES |
| NOT_GLOBAL_SKILL_RATING | YES |
| RANK_DIRECT_MULTIPLIER | NO |
| `community-internal-strength-v1` | **Not implemented.** Several transparent models predict equally well; none clearly beats the Shared-Match baseline |

All evaluation ran offline on the private staging store with the **canonical event-metrics-v1** engine. It made 0 provider
requests, used no Neon, published nothing and wrote nothing canonical.

## Product question

> Inside THIS opted-in group, who has the strongest overall VALORANT performance evidence?

Group-relative: a member's position depends on the members of that group. It is not Riot MMR, not Elo, not a
global skill rating, not scouting and not an official rank. The candidate code takes any member list (3, 5, 20, …),
so each future private or invite-only group gets its own comparison.

## Accepted input evidence (Phase A audit)

The evidence table is built by `src/analytics/internalStrength/evidence.ts`. It sees only evidence strictly before an
instant, accounts are merged per member, and the mode policy is unchanged: absolute evidence is Competitive only,
Shared-Match is Competitive + Unrated.

| Family | Signal | Status on canonical real data |
|---|---|---|
| Shared-Match | shared-match-rating-v1 (combined, Competitive, Unrated, recent-30), partners, confidence | 9 / 9; 36 / 36 pairs direct; **all same-team** |
| Absolute | community-score-v2 **Overall** (全部已追蹤排位) | **0 / 9 — unavailable** |
| Absolute | Current Strength Overall (adaptive window) | **0 / 9 — unavailable** |
| Absolute | role-aware **Firepower** dimension, lifetime Competitive | 8 / 9 (one member's agent/role mix leaves component evidence < 70 %) |
| Absolute | Firepower over the Current Strength window | 9 / 9 |
| Absolute | ACS, ADR, K/D (plain) | 9 / 9 |
| Absolute | KAST | Lifetime value present; only 31 Competitive member-matches carry reconstructed KAST |
| Recent / trend | Recent Form delta, improvement-index-v1 | **0 / 9 — unavailable** |
| Rank | Latest ranked point-in-time tier strictly before the instant | 9 / 9 |
| Rank | Peak tier | 9 / 9; descriptive only, never point-in-time |

**Why the composites are unavailable.**
- Overall needs six of eight dimensions and 75 % configured weight.
- Under event-metrics-v1, Round Impact, Entry, Teamplay, Role Value, Clutch and Consistency are unavailable for every
  member: the engine fails closed on revive / self-kill rounds (EVENT_RECONSTRUCTION_ROBUSTNESS.md).
- Recent Form and Progress inherit this.
- **The existing absolute composite family cannot represent this group until event-metrics-v2 is rolled out canonically.**

**Research arm (private, `--research-event-metrics-v2`, never a result of record):**
- With v2, Overall exists for 5–6 of 9 members.
- It predicts worse than every canonical candidate: pooled 0.684 at 51 % coverage. Current Strength gives 0.57.
- Progress saturates at ±100 for most members. Rollout alone would not make these families useful here.

## Redundancy audit

**Member level** (Spearman, n = 9, full data):

| | SM | SM-Comp | FP | FP-cur | ACS | ADR | K/D | KAST | Rank latest | Rank peak |
|---|---|---|---|---|---|---|---|---|---|---|
| Shared-Match | 1 | 0.97 | 0.90 | 0.93 | 0.92 | 0.93 | 0.92 | 0.07 | 0.87 | 0.90 |
| Firepower | 0.90 | 0.95 | 1 | 0.93 | 0.95 | 0.98 | 0.95 | 0.26 | 0.92 | 0.92 |
| ACS | 0.92 | 0.95 | 0.95 | 0.88 | 1 | 0.98 | **1.00** | 0.10 | 0.82 | 0.80 |
| Rank latest | 0.87 | 0.79 | 0.92 | 0.87 | 0.82 | 0.79 | 0.82 | 0.04 | 1 | 0.98 |

**Match level** (Pearson, 708 Competitive member-matches):

| Stat pair | r |
|---|---|
| ACS – ADR | 0.98 |
| ACS – KPR | 0.98 |
| ACS – kill differential | 0.90 |
| Firepower – ACS / ADR / KPR | 0.88–0.89 |
| APR – any kill stat | ≈ 0 |
| KAST – others | 0.34–0.65 (31 rows) |

| Category | Signals |
|---|---|
| **Highly redundant** | Shared-Match (all views), Firepower, ACS, ADR, K/D, KPR. One underlying signal; member orderings differ by a few swaps |
| **Partly independent** | Rank tier: correlated 0.79–0.92 with the others, an external source |
| **Weak / unreliable** | Lifetime KAST (sparse canonical evidence), APR |
| **Unavailable** | Community Score, Current Strength, Recent Form, Progress |
| **Dropped as separate inputs** | ACS, ADR, K/D: already inside Firepower; counting them again would only duplicate it |

## Candidates (`src/analytics/internalStrength/candidates.ts`)

There are no hand-made weights. Families are put on a common scale by within-group z-scores or percentiles. The only
blending weight is the existing shared-match shrinkage w = n/(n+8), used in an empirical-Bayes form:
`w·shared share + (1−w)·prior`. Rank is only a prior or a vote, never a multiplier.

| Id | Structure |
|---|---|
| D / E baselines | Community Score / Current Strength (unavailable canonically); FP and FP_CURRENT as the available absolute baselines |
| SM | shared-match-rating-v1 alone (plus SM_COMPETITIVE, SM_RECENT) |
| A | SM with an absolute prior (A_SM_PRIOR_FP; A_SM_PRIOR_FP_CURRENT = recency variant) |
| B | SM with an absolute + rank prior (B_SM_PRIOR_FP_RANK); no-SM ablation B_NO_SM_FP_RANK = mean z(FP, rank) |
| C | Family consensus: mean within-group percentile of SM, FP and rank, plus every leave-one-family-out variant |
| References | RANK, ACS, K/D alone; each pair's own earlier head-to-head record |

## Holdout design (`src/analytics/internalStrength/holdout.ts`)

- **Split by match time.** A match is train iff it started before the split, so every pair unit of a match is on one side.
- **Training evidence.** Everything is computed from evidence before the split: shared pairs, Competitive matches,
  rank observations. No future rank, peak or current snapshot.
- **Target.** The accepted shared-match-rating-v1 outcome of each later shared match, with σ and the neutral band
  calibrated on train only. NEUTRAL targets are reported, never scored. Equal or missing scores count as abstentions
  (coverage).
- **Primary split.** Chronological 70 / 30: 233 train / 100 test matches, 249 decisive and 44 neutral test units.
- **Forward chaining.** 4 consecutive test blocks after 50 / 62.5 / 75 / 87.5 % (42 / 41 / 42 / 42 matches); pooled
  374 decisive units.
- **Uncertainty.** SE of a pooled accuracy is about 0.022. Paired candidates are compared with a two-sided sign test on
  units where they predict differently.

## Results (canonical event-metrics-v1)

| Candidate | 70/30 acc. | 70/30 pair-weighted | Pooled acc. | Coverage | Fold range | Member-order stability (ρ) | Rank dependence (ρ) |
|---|---|---|---|---|---|---|---|
| SM (shared-match-rating-v1) | 0.735 | 0.818 | **0.754** | 100 % | 0.69–0.83 | 0.93–0.98 | 0.89 |
| SM_COMPETITIVE | 0.731 | 0.808 | 0.743 | 100 % | 0.68–0.83 | 0.90–0.95 | 0.85 |
| SM_RECENT (30) | 0.727 | 0.798 | 0.735 | 100 % | 0.67–0.85 | 0.83–0.93 | 0.81 |
| FP (lifetime) | 0.749 | 0.819 | 0.744 | 82 % | 0.72–0.75 | 0.86–0.98 | 0.92 |
| FP_CURRENT | 0.735 | 0.805 | 0.674 | 86 % | 0.58–0.71 | 0.71–0.88 | 0.72 |
| RANK | 0.797 | 0.853 | 0.727 | 88 % (ties abstain) | 0.66–0.79 | 0.91–0.98 | 1 |
| ACS / K/D (reference) | 0.731 / 0.759 | 0.808 / 0.821 | 0.759 / 0.754 | 100 % | 0.68–0.85 | 0.88–1.00 | 0.85 / 0.84 |
| A: SM ← FP prior | 0.735 | 0.818 | 0.746 | 100 % | 0.69–0.83 | 0.92–0.98 | 0.89 |
| B: SM ← FP + rank prior | 0.735 | 0.818 | 0.746 | 100 % | 0.69–0.83 | 0.92–0.98 | 0.89 |
| SM ← rank prior | 0.735 | 0.818 | 0.765 | 100 % | 0.70–0.86 | 0.95–0.98 | 0.89 |
| FP + rank (no SM) | 0.779 | 0.812 | 0.757 | 100 % | 0.70–0.81 | 0.92–0.97 | 0.98 |
| C: consensus SM + FP + rank | 0.763 | **0.831** | **0.775** | 100 % | 0.70–0.85 | 0.92–0.95 | 0.95 |
| C: consensus SM + FP | 0.743 | 0.821 | 0.750 | 99.5 % | 0.69–0.83 | 0.88–0.98 | 0.91 |
| Pair head-to-head record (reference) | — | — | 0.756 | 99.7 % | — | — | — |

**Role and sample strata (70/30, SM):**
- Same-role units: 0.857. Cross-role units: 0.724.
- Pairs with 10–25 train matches: 0.692. Pairs with more than 25: 0.775.
- Every candidate scores best on the 4+ tier-gap stratum (0.86–0.87).
- The same-role stratum is small (about 9 % of units), so it is not a reliable role test.

### Ablations (pooled forward chaining, paired sign test)

| Question | Comparison | Wins on differing units | p | Reading |
|---|---|---|---|---|
| **Rank** | SM ← rank prior vs SM | 11 vs 7 | 0.48 | Not material |
| | Consensus with vs without rank | 19 vs 8 | 0.052 | Borderline; ~20 candidates compared, so not significant after multiplicity |
| | SM ← FP+rank vs SM ← FP | 0 differing units | — | With w ≈ 0.9 the prior almost never changes order |
| **Shared-Match** | FP+rank with vs without SM (B) | 18 vs 22 | 0.64 | **Not material** on this target |
| | SM vs FP, where both predict and disagree | 10 vs 15 | 0.42 | Not material. Raw counts that include FP's missing member (68 vs 15) are a coverage effect, not accuracy |
| **Recency** | SM recent-30 vs all-history | 16 vs 23 | 0.34 | Recency does not help (worse, n.s.) |
| | FP current window vs lifetime | 37 vs 49 | 0.24 | Same |
| | FP + current vs FP | 27 vs 27 | — | No gain |
| **Absolute on top of SM** | A (FP prior) vs SM | 0 vs 3 | — | No gain |
| | Consensus SM+FP vs SM | 5 vs 8 | — | No gain |

**Rank calibration experiment.** Pooled units where SM and FP both predict and disagree:
- 25 units: SM right 10, FP right 15.
- Rank predicted all 25, was right 19 (p = 0.015), and sided with FP 19 times.
- So rank may help resolve the two families' disagreements, but on 25 units only. It is a hypothesis to re-test, not
  evidence for a formula.

## Selection — OUTCOME_B

Several transparent models are statistically indistinguishable on future same-match outcomes (pooled 0.74–0.78, SE ≈
0.022):
- Shared-Match alone;
- Firepower;
- raw K/D or ACS;
- FP + rank;
- family consensus.

The nominal best is the consensus of Shared-Match, Firepower and rank (0.775 pooled, 0.831 pair-weighted). Its edge
over Shared-Match alone (+2.1 points) is about one SE, and its rank component is only borderline (p = 0.052, before
multiplicity).

The product thesis "Shared-Match materially improves prediction" was **tested and not confirmed** (p = 0.64). The
reasons are structural:
- At member level every performance family is the same signal (ρ ≈ 0.9–1.0).
- The validation target is the v1 Firepower-based unit outcome, which favors the Firepower family.
- Nine members allow few distinct orderings.

**Not implemented:** `community-internal-strength-v1`.

**Interim recommendation for SDD** (the OUTCOME_C reading): if a single group-internal representation is needed before
more evidence exists, shared-match-rating-v1 alone is the most defensible. It is:
- statistically tied with the best candidates;
- 100 % covered;
- lobby-controlled by construction;
- rank-independent;
- already accepted.

The consensus-with-rank candidate should be re-tested, unchanged and pre-registered, once more matches accumulate.

## Roles of each family (findings)

| Family | Finding |
|---|---|
| **Rank** | Context, prior or vote only; never a multiplier. Its value is unproven: include it only if a pre-registered re-test confirms it. Peak is never point-in-time. Match-time snapshots are used only strictly before the evaluated instant |
| **Shared-Match** | Direct, lobby-controlled, teammates only (all 1 341 units same-team). Not head-to-head. Full coverage here (36 / 36 pairs) is unusually strong; sparse groups will have members without it (handled: SM null → prior or other families) |
| **Absolute** | Firepower is the only usable canonical absolute composite. ACS, ADR and K/D are redundant with it and are not counted separately |
| **Recency** | No forward-prediction gain. Do not add recency to a strength score |
| **Progress** | Trend context only. Unavailable on canonical evidence, and saturating at ±100 in the research arm. Never current-strength evidence |

## Confidence, scale, generalization (design notes for a future v1)

No model is implemented, so the following are design constraints. They are tested in the Phase A framework where they
apply.

- **Confidence stays separate from the score.** It reflects:
  - shared-match count and partner coverage (the shared-match-rating-v1 confidence);
  - Competitive evidence amount;
  - rank coverage;
  - signal agreement.
- **Scale.** A 0–100 group-relative scale is not justified yet. Holdout favors only an ordering, and differences among
  orderings are within noise, so ranking-only output with confidence is the safer first product form.
- **Group size.** z-scores and percentiles work for any size ≥ 2. Tested with 3, 5 and 20 members, fully connected and
  sparse.
- **New member.**
  - Shared-match gives no number below 5 shared matches.
  - The empirical-Bayes blend moves only n/(n+8) of the way from the absolute prior (tested: 2 matches = 20 %).
  - Nothing fakes matches or fills 50.
- **Multi-account.** Evidence is merged per member before any value. One row per person (tested); never averaged across
  accounts.

## Limitations

1. **Target circularity.** The holdout target is the Firepower-based v1 unit outcome, so Firepower-family candidates are
   advantaged. A richer target needs event-metrics-v2 (rollout task) or a new accepted target.
2. **Small group.** Nine members means 36 pair orderings. Accuracy differences come from a handful of swapped pairs;
   test blocks are 41–42 matches.
3. **Absolute composites are unavailable canonically** until event-metrics-v2 is rolled out, and they underperformed in
   the research arm.
4. **Teammates only.** No opposing-team evidence.
5. **Coverage.** Provider-visible history only; `lifetimeComplete = false`.

## Sanitized evidence table (full data, canonical)

FP = Firepower. FP-cur = Firepower over the current window. Tier is the latest ranked tier; ordinals are ordering only
(Silver 2 = 8, Gold 1 = 10, Platinum 1 = 13, Platinum 3 = 15).

| Member | Shared rating | Competitive | Unrated | Shared matches | Evidenced partners | Shared confidence | Competitive matches | FP | FP-cur | ACS | K/D | Tier (latest / peak) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| jack | 80.9 | 78.6 | 76.3 | 70 | 8/8 | 89 | 105 | 98.7 | 100 | 270.6 | 1.35 | Plat 1 / Plat 3 |
| 走路 | 78.0 | 74.6 | 77.9 | 94 | 8/8 | 77 | 68 | 97.8 | 90.4 | 280.0 | 1.38 | Plat 3 / Plat 3 |
| 魔王 | 72.0 | 74.9 | 57.4 | 91 | 8/8 | 85 | 75 | 99.1 | 99.1 | 285.6 | 1.43 | Plat 1 / Plat 1 |
| 滑鏟 | 55.6 | 46.5 | 71.2 | 129 | 8/8 | 83 | 102 | 56.0 | 54.4 | 200.6 | 0.92 | Gold 3 / Gold 3 |
| 天堂 | 42.3 | 43.2 | 42.1 | 101 | 8/8 | 80 | 89 | 19.3 | 29.7 | 190.2 | 0.86 | Silver 3 / Silver 3 |
| 加分 | 40.5 | 41.4 | 39.3 | 132 | 8/8 | 78 | 142 | 27.2 | 25.1 | 174.4 | 0.85 | Gold 1 / Gold 2 |
| 夏天 | 38.2 | 38.5 | 41.5 | 85 | 8/8 | 79 | 85 | 16.5 | 11.8 | 173.1 | 0.79 | Silver 2 / Silver 3 |
| 滑板車 | 25.8 | 29.8 | 25.5 | 83 | 8/8 | 65 | 73 | — | 14.4 | 147.5 | 0.65 | Gold 1 / Gold 1 |
| 小麻花 | 25.5 | 31.0 | 20.0 | 104 | 8/8 | 86 | 102 | 12.8 | 12.7 | 160.8 | 0.73 | Bronze 3 / Silver 2 |

Community Score, Current Strength, Recent Form and Progress are unavailable for all nine members on canonical evidence.

## Reproduce

`npm run internal-strength` (canonical) and `npm run internal-strength -- --research-event-metrics-v2` (private research
arm). Both are local, read the private staging store, and print sanitized output.
