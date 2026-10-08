# Team Composition — TASK-ANALYTICS-TEAM-COMPOSITION-01

**STATUS: COMPLETE / OUTCOME_B / AWAITING SDD REVIEW (2026-10-08).** Version: `team-composition-v1`, built on
`team-observation-v1`, `team-fit-hierarchy-v1` and `team-responsibility-v1`.

| Boundary | Value |
|---|---|
| GROUP_SCOPED | YES |
| HISTORICAL_FIT_NOT_CAUSAL_PROOF | YES |
| NO_LIVE_OPPONENT_SCOUTING | YES |
| POSITION_RECOMMENDATION_READY | NO |

Everything ran locally and offline: private staging, read-only, 0 provider requests.

## Product question and boundary

> For these five players on this map, what assignment best fits their historical strengths and team relationships?

- **Input:** `recommendTeamComposition({ memberIds, map }, model)`, with exactly five distinct members of any group (no
  names or group size are hard-coded).
- **Output:**
  - a **RECOMMENDED_HISTORICAL_FIT** lineup plus two alternatives;
  - per member: agent, role, responsibility, fit, confidence and reasons;
  - per lineup: role distribution, Team Fit, confidence, pair-synergy context and the tradeoff of each alternative.
- **v1 never claims:** exact site, coordinates, setup position, attack path, anchor coordinate, rotation timing or live
  opponent counter-strategy. Those need TASK-DATA-POSITION-NORMALIZATION-01.

## Inputs (Competitive only, mode-eligibility-policy-v1; canonical event-metrics-v2; agent-catalog-v1)

| Input | Samples (9 members, 841 member-matches) | Use in v1 |
|---|---|---|
| member × agent | 115 cells; 48 with ≥ 5, 28 with ≥ 10 | **scored** (agent level) |
| member × role | 36 / 36 cells; 31 with ≥ 5 | **scored** (prior of agent) |
| member × map | 77 cells; 65 with ≥ 5 | context (did not validate) |
| member × agent × map | 350 cells; 48 with ≥ 5, 9 with ≥ 10 | context (did not validate) |
| member × role × map | 220 cells; 62 with ≥ 5 | context |
| Pair synergy (duo-synergy-v1, Competitive) | Value for only **14 / 36** pairs (Overall gate under event-metrics-v2) | context |
| Pair × map synergy | 242 cells, 24 with a value | context; shrunk to global (K 8) |
| Behaviour | Opening 841, trade 737, KAST 841, clutch 553 member-matches | responsibilities |
| Full-team role distribution | 792 matches with the tracked team's five agents | evaluated, not scored |
| Rank | — | not an input (context only, never multiplied) |
| Shared-Match | — | not an assignment input (see sensitivity) |

**Performance unit.** The one-match role-aware profile: overall-profile-v1 weights over at least 4 of Firepower, Round
Impact, Entry, Teamplay and Role Value. It is available for 825 / 841 member-matches. There are no new weights; missing
values are null.

## Shared-Match catalog sensitivity

| Item | Value |
|---|---|
| FROZEN_MODEL | shared-match-rating-v1 (agent catalog v0) |
| CORRECTED_CATALOG_CONTROL | Same formula, engine and thresholds; only the catalog differs; 190 pair-sides change |
| Rank correlation (Spearman) | 0.983 (only 滑板車 / 小麻花 swap places 8–9) |
| Max member rating delta | 3.0 |
| Team recommendation sensitivity | **NONE**: Shared-Match is not an input to the assignment |

A per-member strength term is constant for a fixed five, so it cannot change which agent each member gets.

**Version decision:** the frozen v1 stays the group-strength evidence; the corrected control is research only.

## Sample hierarchy (`team-fit-hierarchy-v1`)

```
μ_member    = shrink(member,              → group mean)
μ_role      = shrink(member × role,        → μ_member)
μ_map       = shrink(member × map,         → μ_member)
μ_agent     = shrink(member × agent,       → μ_role)
μ_role×map  = shrink(member × role × map,  → μ_role + (μ_map − μ_member))
μ_agent×map = shrink(member × agent × map, → μ_agent + (μ_role×map − μ_role))
shrink(cell, prior) = (Σ + 8·prior) / (n + 8)        — the project's n/(n+8) convention; no hard cutoff, no invented match
```

- Every output exposes the samples at each level and the deepest level with evidence.
- Unknown-role agents get no role-scoped estimate and are never candidates.
- There are two channels: performance and win.

## Holdout (chronological, match level)

- **Split.** A match is train iff it started before the split, so all members of one match are on one side.
- **Training evidence.** All evidence is built from train only; no future agent, map or rank data is used.
- **Splits:** 70 / 30 (241 train / 104 test matches) plus 4 forward-chaining blocks (about 43 test matches each).

### Individual level

Incremental r = correlation of (prediction − member baseline) with (actual − member baseline): agent / map signal
**beyond** the member's own level.

| Model (performance channel) | 70/30 | Block 1 | Block 2 | Block 3 | Block 4 |
|---|---|---|---|---|---|
| member × agent (role backoff, no map) | **0.348** | **0.177** | 0.149 | **0.497** | **0.365** |
| member × map (no agent) | 0.024 | −0.058 | 0.125 | 0.014 | 0.065 |
| full hierarchy, map K 8 | 0.238 | 0.145 | 0.152 | 0.329 | 0.268 |
| full hierarchy, map K 16 / 32 / 64 | 0.27 / 0.30 / 0.32 | 0.16 / 0.17 / 0.18 | 0.17 / 0.17 / 0.17 | 0.37 / 0.42 / 0.45 | 0.30 / 0.32 / 0.34 |

- **Agent-level fit carries real out-of-sample signal in 5 / 5 splits.**
- Adding map levels never meaningfully beats agent-only. At best it is +0.025 in one block, and it converges toward
  agent-only as map shrinkage grows.
- The win channel shows no signal (AUC 0.44–0.56, incremental r ≤ 0.11).

### Team level

Test units: 75 / 35 / 32 / 29 / 33 matches with at least 2 tracked members. Candidates are equal z-score consensus of
their parts (no fitted weights).

| Candidate | Win AUC (5 splits) | Round-diff ρ | Team-performance ρ |
|---|---|---|---|
| Member level only (baseline) | 0.55 / 0.58 / 0.45 / 0.62 / 0.56 | 0.13 / 0.02 / −0.06 / 0.28 / 0.01 | 0.40 / −0.10 / −0.14 / 0.41 / 0.27 |
| **A** individual fit | 0.52 / 0.53 / 0.30 / 0.61 / 0.51 | 0.13 / 0.04 / −0.24 / 0.26 / −0.03 | **0.42 / 0.16 / −0.06 / 0.49 / 0.36** (beats baseline 5 / 5) |
| B + global pair synergy | 0.55 / 0.50 / 0.32 / 0.62 / 0.61 | 0.14 / −0.02 / −0.35 / 0.24 / 0.12 | 0.42 / 0.07 / −0.03 / 0.44 / 0.40 |
| C + map pair synergy | 0.53 / 0.50 / 0.32 / 0.63 / 0.58 | 0.11 / −0.02 / −0.34 / 0.22 / 0.04 | 0.39 / 0.07 / −0.02 / 0.34 / 0.34 |
| D + role distribution | 0.52 / 0.53 / 0.39 / 0.53 / 0.54 | 0.04 / −0.02 / −0.29 / 0.05 / −0.06 | 0.12 / −0.03 / −0.21 / 0.18 / 0.14 |
| Synergy only (19–41 units) | 0.59 / 0.61 / 0.36 / 0.43 / 0.71 | — | — |
| Role distribution only | 0.46 / 0.57 / 0.56 / 0.43 / 0.44 | — | — |

**The most reliable validation target is member relative performance** (individual level). Win and round differential
are not predicted consistently by any candidate with this sample size. Pair synergy and role distribution add no
consistent signal; D is worst.

## Model selection — OUTCOME_B

The evidence supports **agent and role recommendations**: a validated individual signal. No weighted Team Fit model
predicts team outcomes, so v1 is a conservative ranking with no "optimal" claim.

- **Score:** the mean agent-level fit of the five (candidate A).
- **Map:** context only (`mapEvidence: 'context'`). It enters through candidate priority (agents played on that map),
  samples and explanations, not the score. `'scored'` keeps the full map hierarchy for research.
- **Not scored:** pair synergy and role distribution are reported only.
- **Ranking:** assignments within **0.2 σ** of the best are statistically comparable (σ = pooled within-member SD of
  one-match performance; the shared-match-rating-v1 neutral convention). Inside that band the highest-confidence
  assignment is recommended.
- **Optimizer:**
  - candidate pools: per member, the 6 best-fitting evidence-backed agents plus the 3 most played (on the map, then
    overall);
  - deterministic exhaustive search over distinct-agent assignments (about 11 000–18 000 per request);
  - no randomness; input order never matters.
- **Unseen agents:** offered only when no distinct assignment exists, labelled EXPERIMENTAL / LOW CONFIDENCE, with
  confidence capped at 25.

## Team Fit and confidence

- **TEAM_FIT** (0–100) is the mean over the five of the assigned agent's percentile among that member's own
  evidence-backed agents.
  - 100 means everyone is on their personally best historical fit.
  - Lower values show compromises forced by the distinct-agent rule or by preferring better-evidenced agents.
  - It is **not** a win probability.
- **CONFIDENCE** (0–100) is separate: the mean of 100·√min(n(member × agent)/20, 1).
  - A recommendation resting on a 1-match agent stays visibly low (for example 22).
  - Low confidence never lowers the fit score.

## Responsibilities (`team-responsibility-v1`)

Behaviour rates per member × role are shrunk (K 8) toward the group mean and compared with group medians. A label needs
at least 5 matches on that role. Agent class alone never decides, and there is no LURK (it needs positions).

| Responsibility | Evidence |
|---|---|
| PRIMARY_ENTRY (unique) | Highest first-duel rate (FK + FD per round) above the group median; opening win share shown |
| SECOND_ENTRY_TRADE (unique) | Highest trade involvement (trade kills + assists per round) above median |
| SPACE_SMOKE_CONTROL | Assigned Controller with KAST or survival above median |
| INFO_INITIATION | Assigned Initiator with assists per round above median |
| ANCHOR_CLUTCH | Clutch conversion above median with ≥ 5 attempts (and Sentinel, or survival above median) |
| UTILITY_SUPPORT | Assists or KAST above median |
| FLEX | ≥ 2 roles with ≥ 5 matches at or above own baseline |
| none | Otherwise; the reason is stated |

## Map-specific behavior

- **Default mode:** the score is map-invariant by evidence; map changes only the candidate pool. That gives 2 distinct
  top assignments across 12 maps for each tested lineup.
- **Research map-scored mode:** 4–6 distinct across 12 maps.
- Map-specific agent choices would follow noise rather than validated signal on current data. They can be re-tested as
  evidence grows.

## Sanitized examples (fixed rules: three lineups × two most-played maps + the least-played map)

All three lineups were also run on Summit (the second most-played map). Summit returned the same assignment as Ascent
each time, with slightly lower confidence.

| Lineup rule / map | Recommended assignment | Roles | Responsibilities | Team Fit | Confidence |
|---|---|---|---|---|---|
| Five most active (加分, jack, 小麻花, 滑鏟, 天堂) / Ascent | jack Reyna, 加分 Sage, 小麻花 Clove, 天堂 Miks, 滑鏟 Astra | D1 I0 C3 S1 | jack PRIMARY_ENTRY, 滑鏟 SECOND_ENTRY_TRADE, 小麻花 / 天堂 SPACE_SMOKE_CONTROL, 加分 UTILITY_SUPPORT | 91 | 84 |
| same / Icebox | 滑鏟 Neon instead of Astra (higher confidence inside the comparable band) | D2 C2 S1 | 滑鏟 PRIMARY_ENTRY, jack SECOND_ENTRY_TRADE | 83 | 85 |
| Most frequent five-stack (jack, 小麻花, 走路, 滑鏟, 滑板車) / Ascent | jack Reyna, 小麻花 Clove, 走路 Jett, 滑鏟 Astra, 滑板車 Miks | D2 C3 | 走路 PRIMARY_ENTRY, 滑鏟 SECOND_ENTRY_TRADE, 小麻花 / 滑板車 SPACE_SMOKE_CONTROL, jack UTILITY_SUPPORT | 87 | 92 |
| same / Icebox | 滑鏟 Neon instead of Astra | D3 C2 | 滑鏟 FLEX | 79 | 92 |
| First five by id (jack, 加分, 小麻花, 天堂, 魔王) / Ascent | jack Clove, 加分 Sage, 小麻花 **Astra (1 match, confidence 22)**, 天堂 Miks, 魔王 Reyna | D1 C3 S1 | 魔王 PRIMARY_ENTRY, 小麻花 SECOND_ENTRY_TRADE | 79 | 77 |
| same / Icebox | jack Chamber, 小麻花 Clove | D1 C2 S2 | 魔王 PRIMARY_ENTRY | 73 | 82 |

**Alternatives.** Each lineup has two alternatives within 0.1–2.2 fit points, all inside the comparable band, for
example 加分 Sova or Cypher instead of Sage, or Fade instead of Miks. Every alternative carries its tradeoff text.

**Top evidence** (examples): "Reyna: 34 Competitive matches; agent fit +3.2 vs this member's Duelist level"; "Miks: 25
matches"; "limited direct Agent×Map sample on Icebox; recommendation uses the agent / role level".

**Observation.** Lineups often land on 2–3 Controllers and 0 Initiators. That is what this group's validated
individual evidence says. v1 enforces no template, and the historical role-distribution evidence did not show such
lineups to be worse.

## Counterfactual limitation

We never observe the same five, same match, with a different assignment. Recommendations are **historical fit** (a
data-supported lineup), not causal proof of the best composition, and Team Fit is not a probability.

## Limitations and thin evidence

- **Thin cells:** agent × map (48 / 350 cells with ≥ 5), role × map, pair × map (24 / 242 with a value), pair synergy
  (14 / 36).
- **Validation sample:** about 30–75 team units per split, too small for win-rate validation.
- **Team synergy:** not modeled beyond context.
- **Data scope:** Competitive only, provider-visible history (`lifetimeComplete = false`).

## Next

1. TASK-DATA-POSITION-NORMALIZATION-01 (player locations, plant site, round side). It is required before any position
   or site recommendation.
2. Team Composition v2 with site and position evidence.
3. A local release checkpoint, rollout preflight and push. All need separate SDD gates.

## Reproduce

`npm run team-composition -- evaluate` (holdout, sensitivity, readiness) and `npm run team-composition -- demo`
(the fixed-rule examples above). Both are private, read-only and sanitized.
