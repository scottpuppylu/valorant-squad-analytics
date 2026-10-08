# Shared-Match Rating v2 evaluation — TASK-SCORING-SHARED-MATCH-02

**STATUS: PHASE A COMPLETE / OUTCOME_B / AWAITING SDD REVIEW (2026-10-08).**
- **Not implemented:** `shared-match-rating-v2`, because no candidate clearly dominates Firepower.
- **Unchanged and current:** `shared-match-rating-v1`. Its sanitized baseline reproduces exactly (jack 80.9 … 小麻花 25.5,
  σ 35.23, neutral band 7.05).
- **Event engine:** event-metrics-v2 was used **only** in this private, offline evaluation path. event-metrics-v1 stays the
  default and canonical engine.
- **Safety:** 0 provider requests, no Neon, nothing published, no canonical writes.

The v1 model, its evidence dataset and its same-team limitation are documented in
[SHARED_MATCH_RATING.md](SHARED_MATCH_RATING.md). This file covers only the v2 question.

## Question and v1 limitation

v1 rates teammates from one per-match signal, community-score-v2 **Firepower**. The richer dimensions were unusable
because event-metrics-v1 failed closed on revives and posthumous kills. Its documented limitations were:
- a between-member Duelist effect of 0.66 σ, at the time described as residual Duelist bias (corrected below);
- single-match saturation (51 % of values at 0 or 100).

event-metrics-v2
([EVENT_RECONSTRUCTION_ROBUSTNESS.md](EVENT_RECONSTRUCTION_ROBUSTNESS.md)) makes Entry, Teamplay, Role Value and KAST
available for 82–100 % of pair units. The question: does that evidence give a materially better same-match model?

Scope is unchanged: all 1 341 units are **teammates**. The model measures relative teammate performance under a shared
lobby. It is not head-to-head ("who would beat whom") and not a global skill rating.

## Evaluation framework (`src/analytics/sharedMatch/candidateAudit.ts`)

Every candidate is evaluated with the same code. Input is the usable valid (≥ 10-round) units, one per (pair, match),
in canonical order. σ = pooled within-member SD of the candidate's per-side values, the v1 calibration rule.

| Statistic | Definition |
|---|---|
| Availability | Usable units / valid units |
| Saturation | Share of per-side values ≤ 0.5 or ≥ 99.5 (bounded signals only) |
| Noise share | Within-member variance / total variance of per-side values (scale-free match noise) |
| Duelist bias (between) | Mean (Duelist − non-Duelist) margin over units with exactly one Duelist, in σ. **Confounded by who plays Duelist** |
| Duelist effect (within member) | The same member's signed margin when on a Duelist minus when not; pooled over members with ≥ 5 units of each (harmonic weights), in σ. Controls for the member |
| Role bias by role | Mean (role R − other) margin over units where exactly one side is R, in σ |
| Pair separation | Mean \|pair mean margin\|, in σ |
| Temporal stability | Chronological first-half vs second-half sign agreement, pairs with ≥ 8 units |
| Pairwise direction stability | Odd vs even (interleaved) sign agreement, pairs with ≥ 8 units |
| Outlier sensitivity | Share of pairs whose mean-margin sign flips when their single most extreme unit is removed; mean \|Δ\| in σ |
| Same-role sensitivity | Mean \|all-role − same-role-only\| member rating under the **v1 aggregation rules**, plus a deterministic **sampling floor**: the same statistic for pseudo-random subsets of equal size, averaged over 40 draws |

The harness reproduces v1 ratings exactly for Firepower (tested). Member names and rank are never inputs.

## Candidates (all event-metrics-v2 evidence, Competitive + Unrated)

The pair-consistent profile (H) is new as a candidate, but adds no new weights:
- it uses the existing overall-profile-v1 weights over the single-match dimensions **both** members have in the unit;
- it requires Firepower, Entry, Teamplay and Role Value; Round Impact joins only when both sides have it;
- both sides are therefore always averaged over the same components.

| Candidate | Avail. | Satur. | Noise share | Duelist (between) | Duelist (within member) | Temporal | Odd/even | Outlier flip / infl. | Same-role Δ (floor) |
|---|---|---|---|---|---|---|---|---|---|
| A Firepower (v1 signal) | 85.4 % | 50.8 % | 0.68 | 0.66 | **−0.15** | 0.86 | 0.86 | 11 % / 0.07 | 11.5 (6.9) |
| B Engine Overall | 46.5 % | 0 % | 0.67 | 0.80 | 0.13 | 0.74 | 0.87 | 0 % / 0.14 | 11.9 (8.0) |
| B′ single-match profile (per side) | 82.1 % | 0 % | 0.70 | 0.73 | 0.02 | 0.92 | 0.86 | 3 % / 0.10 | 11.8 (7.4) |
| **H pair-consistent profile** | 82.1 % | **0 %** | 0.70 | 0.72 | **−0.01** | **0.92** | **0.89** | **3 %** / 0.10 | 12.0 (7.4) |
| C KAST (raw) | 100 % | — | 0.92 | 0.17 | −0.17 | 0.86 | 0.92 | 6 % / 0.09 | 6.5 (6.1) |
| D Entry | 82.1 % | 5.5 % | 0.84 | 0.15 | **−0.56** | 0.83 | 0.75 | 6 % / 0.11 | 11.7 (7.0) |
| E Teamplay | 82.1 % | 2.4 % | 0.92 | 0.44 | 0.26 | 0.72 | 0.86 | 3 % / 0.11 | 8.0 (6.3) |
| F Round Impact | 46.5 % | 3.9 % | 0.74 | 0.66 | 0.10 | 0.71 | 0.77 | 10 % / 0.17 | 9.9 (7.7) |
| G Role Value | 82.1 % | 2.1 % | 0.80 | 1.03 | **0.83** | 0.86 | 0.83 | 3 % / 0.11 | 8.7 (6.1) |
| Firepower + Round Impact (mean) | 46.5 % | 4.8 % | 0.67 | 0.74 | 0.02 | 0.81 | 0.84 | 0 % / 0.13 | 11.2 (8.1) |
| Raw ACS (reference) | 100 % | — | 0.60 | 1.10 | 0.21 | 0.89 | 0.94 | 3 % / 0.11 | 13.5 (7.6) |
| Kill diff / round (reference) | 100 % | — | 0.67 | 0.83 | 0.09 | 0.92 | 0.97 | 0 % / 0.10 | 12.3 (7.4) |

**Role bias by role**, in σ (role-side margin when exactly one side has that role):

| Candidate | Duelist | Initiator | Controller | Sentinel |
|---|---|---|---|---|
| Firepower | 0.66 | −0.99 | 0.74 | −0.33 |
| Pair-consistent profile | 0.72 | −0.89 | 0.65 | −0.41 |
| KAST | 0.17 | −0.40 | 0.29 | −0.06 |
| Teamplay | 0.44 | −0.42 | 0.24 | −0.27 |

### Like-for-like comparison (common subset: the 1 028 units where H is usable)

| | Firepower | Pair-consistent profile |
|---|---|---|
| Saturation | 51.2 % | **0 %** |
| Noise share | **0.68** | 0.70 |
| Pair separation (σ) | **1.12** | 1.06 |
| Duelist (between / within member) | 0.68 / −0.16 | 0.72 / **−0.01** |
| Temporal / odd-even stability | 0.83 / 0.86 | **0.92 / 0.89** (36 pairs: 33 vs 30 and 32 vs 31 agreeing) |
| Outlier flip / influence | 8.3 % / **0.07** | **2.8 %** / 0.10 (1 vs 3 pairs) |
| Same-role Δ (floor) | 11.0 (6.9) | 12.0 (7.4) |

### Competitive and Unrated separately

The evidence streams were evaluated separately and were not pooled first.

| | Units | Satur. | Duelist (within) | Temporal | Odd/even | Outlier flip |
|---|---|---|---|---|---|---|
| Firepower, Competitive | 803 | 51.8 % | −0.15 | 0.85 | 0.94 | 6 % |
| Profile H, Competitive | 788 | 0 % | −0.03 | 0.91 | 0.97 | 0 % |
| Firepower, Unrated | 266 | 48.4 % | −0.17 | 0.92 | 1.00 | 0 % |
| Profile H, Unrated | 240 | 0 % | −0.00 | 0.92 | 1.00 | 0 % |

Both modes show the same pattern, so no mode-specific treatment or multiplier is indicated. Unrated has only 13
pairs with ≥ 8 units, so its stability figures are weak.

## Findings

1. **v1's between-member Duelist effect is materially confounded by member/role composition.**
   - BETWEEN_MEMBER_DUELIST_EFFECT = 0.66; WITHIN_MEMBER_DUELIST_EFFECT = −0.15.
   - The 0.66 compares different people. Members who are stronger in this group also disproportionately play Duelist.
   - Controlling for the member, the same person's Firepower margin is slightly lower on a Duelist.
   - Conclusions: ROLE_COMPOSITION_CONFOUNDING = YES; INTRINSIC_DUELIST_SIGNAL_BIAS = NOT_PROVEN;
     SAME_ROLE_SENSITIVITY = STILL_MATERIAL (finding 4).
   - This does not show Firepower is role-neutral. SHARED_MATCH_RATING.md limitation 1 now uses this wording.
2. **The pair-consistent profile removes saturation and the within-member role effect (−0.01 σ).** It also improves
   direction stability and outlier flips. Some of these gains are small in absolute terms: 3 of 36 pairs.
3. **It is not better on everything.**
   - Noise share is equal or slightly worse (0.70 vs 0.68).
   - Pair separation is slightly lower.
   - Outlier influence is slightly higher.
   - Availability drops by 3.3 points.
4. **Same-role sensitivity did not improve.**
   - The required test gives 12.0 vs 11.5.
   - Both sit 4.6 points above their sampling floors, so the excess attributable to role is identical.
   - The test is weak (only about 9 % of units are same-role), but it shows no gain.
5. **Single components are biased in opposite directions within member:** Entry −0.56, Role Value +0.83. They are not
   usable alone. KAST and Teamplay have low bias but the highest noise share (0.92), so they discriminate poorly.
6. **Event-heavy candidates at 46.5 %** (Engine Overall, Round Impact, Firepower + Round Impact) lose too much coverage.
   Clutch and Impact stay partial wherever alive counts are undecidable.

## Selection — OUTCOME_B

Richer metrics improve several dimensions:
- saturation;
- within-member role neutrality;
- stability;
- outlier flips.

No candidate clearly dominates Firepower:
- noise and separation are not better;
- availability is lower;
- the brief's primary role-fairness test (same-role sensitivity) shows **no improvement**.

Per the gate, `shared-match-rating-v2` is **not implemented**, and shared-match-rating-v1 stays with its documented
limitations.

**Rejected candidates:**

| Candidate | Reason |
|---|---|
| Engine Overall, Round Impact, Firepower + Round Impact | 46.5 % availability |
| Entry, Role Value | Strong within-member role effects |
| KAST, Teamplay | Highest noise, weakest separation |
| Raw ACS, kill differential | Largest Duelist bias, as in v1 |

**Strongest candidate for a future v2:** the pair-consistent profile. It is the only one that is saturation-free,
role-neutral within member, and as stable as Firepower.

**Not decided here.** The SDD decision on whether the within-member evidence outweighs the unchanged same-role test.
The neutral band, aggregation, shrinkage and confidence for v2 were not re-estimated, because no v2 model was selected.

## Rank boundary

- Rank was not read by any candidate statistic (tested: rank and future rank change nothing).
- No v2 was finalized, so no v2 rank sanity check exists.
- The v1 diagnostic is unchanged:

| Tier gap | Higher tier ahead | Lower tier ahead | Neutral |
|---|---|---|---|
| 1–3 | 261 | 97 | 98 |
| ≥ 4 | 180 | 21 | 21 |

  Same tier: 37 neutral of 111 units. Unknown tier: 38 neutral of 280 units.

## Tests (`tests/sharedMatchCandidatesV2.test.ts`)

Determinism and input-order independence; duplicate idempotency; pair-swap symmetry; identical stats → 0;
pair-profile same-component rule and requirements; excluded modes and Competitive/Unrated separation; rank and
future-rank independence; between- vs within-member role statistics; outlier measurement; deterministic sampling
floor; exact v1 reproduction by the harness (v1/v2 coexistence); explicit event-metrics-v2 dependency (default
projection stays v1).

## Reproduce

`npm run shared-match -- candidates-v2` (local, private staging, sanitized aggregates only).
