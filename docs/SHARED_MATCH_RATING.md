# Shared-Match Relative Rating — TASK-SCORING-SHARED-MATCH-01

**STATUS: COMPLETE / AWAITING SDD REVIEW (2026-10-08).** Versions: `shared-match-evidence-v1`, `shared-match-rating-v1`.

- **SHARED_MATCH_IS_GROUP_RELATIVE = YES**
- **RANK_IS_CONTEXT_ONLY = YES**
- **NOT_RIOT_MMR = YES**
- **NOT_GLOBAL_SKILL_RATING = YES**
- **LIFETIME_COMPLETE = NO**

It is not the final Community Internal Strength: no rank, Community Score, Current Strength or Progress is mixed in.
Computed locally from the private staging store. 0 provider requests, no Neon, no canonical writes.

## Problem

Absolute K/D or ACS mixes skill with lobby strength: a Diamond K/D of 1.05 and a Gold K/D of 1.25 are not comparable.
When two opted-in members play the **same match**, the lobby, map, patch, opponents and conditions are shared, so the
difference between them is far fairer evidence. This model measures exactly that and nothing more.

## Eligibility (mode-eligibility-policy-v1, unchanged)

- **Eligible:** Competitive and Unrated. They stay separate: separate ratings plus a combined view.
- **Excluded:** Swiftplay, Deathmatch, Team Deathmatch, Premier, Custom and other modes produce no units.
- **Short matches:** matches with fewer than 10 rounds (remakes / early surrenders) are not comparable.

## Evidence model (`shared-match-evidence-v1`)

- **Projection:** staged v4 documents → the **canonical** per-match projection, reused line for line:
  1. `normalizeHenrikEvidence` (durable-evidence-v2, private rebuild key);
  2. the rows `upsertMatch` and the four detail SELECTs would produce (`server/sharedMatch/stagingMatches.ts`, in memory);
  3. `reconstructMatchFacts` (event-metrics-v1);
  4. `assembleMatch`.

  An end-to-end fixture test covers it; no consent table is involved.
- **Pair units:** every eligible match with k tracked members yields k·(k−1)/2 **unordered** pair-match units, with
  A = the smaller member id. A↔B is never counted twice, and a duplicated match never adds evidence.
- **Identity:** stable private member and account ids. A member's two accounts never pair with each other, and
  same-match collisions are withheld by the canonical assembly.
- **Each unit carries:**
  - private match ref, time, mode, map, Act, rounds, same-team flag;
  - per-member ACS, ADR, KPR, APR, kill differential per round, KAST / FK / FD when reconstructed, and the one-match
    community-score-v2 dimensions;
  - the **pre-match tier** of both members (rank-context-v1, exact in-match snapshot), with tier difference as context
    only;
  - validity flags.

## Phase A findings (real data, sanitized)

| Item | Value |
|---|---|
| Projected matches | 838 (0 skipped, 0 identity conflicts); eligible: Competitive 345, Unrated 203 |
| Pair-match units | 1 341 (Competitive 952, Unrated 389); 89 short / remake; 1 069 scorable |
| Pair coverage | 36 / 36 pairs evidenced, in both modes; 0 with no evidence; shared matches per pair min 14, median 36.5, mean 37.25, max 83; one connected component |
| Same team / opposing team | **1 341 / 0.** All evidence is teammates; no cross-team evidence exists in this group's data |
| Rank context | Every unit resolved by an exact in-match snapshot; 403 units have an unranked side, so no tier difference |

**Event-reconstruction availability is the decisive constraint.**
- event-metrics-v1 is fail-closed per match. It requires every kill's killer to be alive and every victim to die once.
- Real rounds contain self-kills (542), revives (873) and posthumous kills (627). 84 % of rounds are valid, but
  **502 of 548** eligible matches contain at least one such round.
- So KAST, Round Impact, Entry, Teamplay, Role Value and the engine Overall exist for only about 3–5 % of units.
- This is canonical engine behavior, not an adapter defect (verified by a direct count). Changing the engine is a
  separate task.

### Candidates evaluated

Role bias here is the **between-member** mean Duelist − non-Duelist margin in within-member SD units. It compares
different people, so it is confounded by who plays Duelist (corrected 2026-10-08; see Limitation 1). Stability is
first-half vs second-half
sign agreement over 36 pairs.

| Candidate | Availability | Role bias | Stability | Verdict |
|---|---|---|---|---|
| A: engine Overall (one match) | 3.4 % | 0.44 | — | Rejected: its 6-of-8 gate needs multi-match dimensions |
| B: Round Impact (one match) | 3.4 % | 0.51 | — | Rejected: event-dependent, too sparse |
| C: profile-weighted single-match dimensions | 3.4 % | 0.38 | — | Rejected: needs ≥ 4 of 5 dimensions; too sparse |
| **Firepower dimension (role benchmarks)** | **85 %** | **0.66** | **0.86** | **Chosen** |
| Raw ACS | 100 % | 1.10 | 0.89 | Rejected: strongest Duelist bias |
| Kill differential / round | 100 % | 0.83 | 0.92 | Rejected: more Duelist bias than Firepower |
| KAST | 5 % | −0.23 | — | Rejected: too sparse |

## Model (`shared-match-rating-v1`)

- **Signal:** per-match community-score-v2 **Firepower**, i.e. N(ACS) .35, N(ADR) .30, N(KPR) .20, N(KD) .15, with the
  **actual agent role's** benchmarks. No new weights or benchmarks.
- **Margin:** for each scorable unit, margin = Firepower_A − Firepower_B.
  - σ = the pooled within-member SD of Firepower (match noise; 35.23 on real data).
  - **Neutral band:** |margin| < 0.2σ (≈ 7.05 points) is NEUTRAL. This is a small-effect convention derived from the
    data's noise, not tuned to member order.
  - Otherwise A_OUTPERFORMED_B or B_OUTPERFORMED_A.
- **Outliers:**
  - Outcomes are sign-based.
  - Margins used in means are winsorized at ±2σ.
  - A test proves one extreme match cannot flip a relationship.
- **Member rating:**
  - Each shared match counts **once** for the member: its units are weighted 1/(other members in the match).
  - The outperform share is p = Σ w·u / Σ w, with u = 1 ahead, ½ neutral, 0 behind.
  - It is shrunk toward ½ by n/(n+8), the project's existing pair-evidence shrinkage from SYNERGY.md.
  - **rating = 100·p.** 50 = even shared-match evidence; above 50 the member tends to outperform the peers they shared
    matches with.
  - Fewer than 5 scorable shared matches gives no number; missing evidence never becomes 50.
- **Views:**
  - combined (both modes pooled, each match once);
  - **Competitive** and **Unrated** separately;
  - **recent**: the member's 30 most recent shared matches, reusing the fixed-recent 10 / 30 convention (no new decay);
  - per-pair aggregates: counts, mean (winsorized) and median margin, recent-30, confidence.
- **Confidence (separate from skill):**
  - Formula: 100·√(min(n/30,1) · min(evidencedPartners/min(4, members−1),1)) · validShare.
  - n = shared matches; an evidenced partner has at least 3 scorable shared matches; validShare = scorable units / all
    eligible units.
  - Pair confidence = 100·√min(n/30,1).
- **Explainability:** every unit keeps the A − B differences of Firepower, ACS, ADR, KPR, kill differential, KAST and
  Round Impact (where present).

**Rank boundary:**
- `rating.ts` never reads rank, as the architecture test checks.
- Rank appears only as stored context and in a descriptive breakdown.
- On real data the higher-tier member came out ahead in 261 vs 97 units (tier gap 1–3) and 180 vs 21 (gap ≥ 4). This
  is consistent with the signal tracking real performance, and it is not used.

**Invariants (tested):**
- swap symmetry; pair order independence;
- identical stats → NEUTRAL;
- duplicate match → no extra evidence;
- excluded modes → no effect;
- rank (alone or "future") → no effect;
- determinism, independent of input order.

## Real results (community names only)

| Member | Shared rating | Competitive | Unrated | Recent-30 | Shared matches | Competitive / Unrated matches | Pair coverage | Confidence |
|---|---|---|---|---|---|---|---|---|
| jack | 80.9 | 78.6 | 76.3 | 77.9 | 70 | 55 / 15 | 8 / 8 | 89 |
| 走路 | 78.0 | 74.6 | 77.9 | 72.9 | 94 | 58 / 36 | 8 / 8 | 77 |
| 魔王 | 72.0 | 74.9 | 57.4 | 73.6 | 91 | 71 / 20 | 8 / 8 | 85 |
| 滑鏟 | 55.6 | 46.5 | 71.2 | 46.5 | 129 | 85 / 44 | 8 / 8 | 83 |
| 天堂 | 42.3 | 43.2 | 42.1 | 46.5 | 101 | 69 / 32 | 8 / 8 | 80 |
| 加分 | 40.5 | 41.4 | 39.3 | 49.6 | 132 | 115 / 17 | 8 / 8 | 78 |
| 夏天 | 38.2 | 38.5 | 41.5 | 37.1 | 85 | 73 / 12 | 8 / 8 | 79 |
| 滑板車 | 25.8 | 29.8 | 25.5 | 25.2 | 83 | 45 / 38 | 8 / 8 | 65 |
| 小麻花 | 25.5 | 31.0 | 20.0 | 36.4 | 104 | 70 / 34 | 8 / 8 | 86 |

Strongest direct pair evidence:
- jack vs 小麻花: 28 shared, jack ahead 27, 1 neutral.
- jack vs 加分: 26 shared, jack ahead 24, 2 neutral.
- 走路 vs 小麻花: 19 shared, 走路 ahead 18, 1 neutral.

Weakest-evidence pairs: 走路 vs 夏天 (11 scorable), jack vs 魔王 (13), 天堂 vs 走路 (13).

## Limitations

1. **Role effects (corrected 2026-10-08, TASK-SCORING-INTERNAL-STRENGTH-01).**

   | Item | Value |
   |---|---|
   | BETWEEN_MEMBER_DUELIST_EFFECT | 0.66 σ |
   | WITHIN_MEMBER_DUELIST_EFFECT | −0.15 σ (the same member, Duelist vs other roles; [SHARED_MATCH_RATING_V2.md](SHARED_MATCH_RATING_V2.md)) |
   | ROLE_COMPOSITION_CONFOUNDING | YES |
   | INTRINSIC_DUELIST_SIGNAL_BIAS | NOT_PROVEN |
   | SAME_ROLE_SENSITIVITY | STILL_MATERIAL |

   - The 0.66 compares different people. The members who come out ahead in this group also play Duelist
     disproportionately, so the figure is materially confounded by member/role composition. It is **not** evidence
     that Firepower intrinsically favors Duelists.
   - The within-member estimate is small and slightly negative. It does **not** prove Firepower is role-neutral: it rests
     on members who play both, and it is one estimate on one group.
   - A same-role-only run still changes several ratings: jack 80.9 → 68.6, 魔王 72.0 → 51.4, 走路 78.0 → 60.0,
     滑板車 25.8 → 44.0, on 9–37 matches. The mean change is 11.5 points against a 6.9-point sampling floor for an
     equally small random subset, so a role-related component of about 4.6 points remains unexplained.
2. **Event-metric sparsity.** Utility, trade, KAST and clutch value are largely invisible until event-metrics-v1 handles
   revives and posthumous kills (a separate engine task).
3. **Single-match saturation.** One-match Firepower often clamps at 0 or 100 (σ ≈ 35), so margins are coarse. Outcomes
   are sign-based for this reason.
4. **Teammates only.** There is no opposing-team evidence, so the rating says nothing about head-to-head play.
5. **Group-relative.** A rating is relative to the peers each member actually shared matches with. The direct graph is
   complete, but mixes differ by member. The future Internal-Strength task may use the graph explicitly (labelled
   inferred).
6. **Coverage.** This is provider-visible history only (HISTORY_COVERAGE_GAP.md); `lifetimeComplete = false`.

## Interface for TASK-SCORING-INTERNAL-STRENGTH-01

- `server/sharedMatch/buildPairs.ts` → `PairMatchEvidence[]`.
- `src/analytics/sharedMatch/rating.ts`: `computeSharedMatchRatings`, `scoreUnits`, `aggregatePair`, `memberRating`.
- Rank context per unit (`rankA`, `rankB`, `rankTierDifference`) is available for calibration studies.
- Nothing here is persisted: everything is reproducible from staged matches + rank evidence + these rules.
  `npm run shared-match -- audit | rate` (local, sanitized output).
