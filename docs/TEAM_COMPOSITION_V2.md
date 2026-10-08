# Team Composition V2 — TASK-ANALYTICS-TEAM-COMPOSITION-02

**STATUS: COMPLETE / OUTCOME_B / AWAITING SDD REVIEW (2026-10-08; local only, not pushed).**

V2 is an **explanation / responsibility layer** on top of the frozen [team-composition-v1](TEAM_COMPOSITION.md). It
adds conservative **attack / defense** responsibilities to the unchanged V1 assignment. Every **site-level** claim is
withheld, because site tendencies did not reproduce in the chronological holdout.

| Item | Value |
|---|---|
| Versions | `site-reference-v1`, `side-evidence-v1`, `team-composition-v2` |
| Modules | `src/analytics/teamComposition/{siteReference,sideEvidence,v2}.ts`; private, read-only evaluation `npx tsx scripts/team-composition.ts v2` (staging DB only) |
| V1 output | Byte-identical (TEAM_COMPOSITION_V1_CHANGED = NO) |
| Agent assignment | Always V1's recommended lineup (V2_AGENT_ASSIGNMENT_CHANGES = 0 of 9 examples) |
| Team Fit / V1 confidence | Unchanged; V2 adds separate per-side confidence fields |
| Evidence | position-evidence-v1, provider A/B/C plant labels, same-map raw coordinates, explicit round side, V1 evidence |
| Not used | Any external transform, valorant-api.com, callouts, invented polygons, rank, Shared-Match |
| Modes | Competitive only (mode-eligibility-policy-v1) |
| Provider / Riot requests | 0 |
| Public schema / export | Unchanged; raw coordinates never leave private computation |

## 1. site-reference-v1 (private, derived)

- **Input.** Every provider plant with an explicit site label (A / B / C) and a plant location, grouped by map × site.
  Nothing is hard-coded.
- **Centroid.** The mean of that site's plant coordinates, summed in a canonical order (input-order independent).
- **Envelope.** The P95 (default) or P99 quantile of plant distances to the centroid (index `ceil(q·n) − 1`).
- **Minimum sample.** A site needs at least 20 labelled plants. A map needs at least 2 referenced sites, otherwise
  `unknown_map`.
- **Classification of a point on the same map:**
  - `SITE_<X>_PROXIMAL` when it lies inside exactly one envelope;
  - `NON_SITE_OR_UNKNOWN` (abstain) when it lies inside no envelope;
  - ambiguous (abstain) when it lies inside several.
- **Map isolation.** Distances are only ever compared within one map, in raw provider units.

**Chronological validation.** The reference was built from plants in the first 70 % of matches (by time) and used to
classify the later 30 % of labelled plants (2 161).

| Gate | SITE_CLASSIFICATION_ACCURACY | Wrong site | SITE_ABSTENTION_RATE | SITE_AMBIGUITY_RATE |
|---|---|---|---|---|
| **P95 (used)** | **0.948** | 0 | 0.052 | 0 |
| P99 | 0.991 | 0 | 0.009 | 0 |

Precision when the model classifies is 1.000 at both gates. P95 is kept because abstaining is cheaper than a wrong site.

## 2. side-evidence-v1

There is one observation per tracked member per round.

- **Side** comes only from the explicit per-round attacking team (position-evidence-v1). Unknown-side rounds stay
  `null` and are excluded from every side metric.
  - Competitive member-rounds: 17 793 in total; 8 015 attack, 8 216 defense, and **1 562 unknown side (8.8 %)**,
    reported separately.
- **Combat facts** use opponent kills only (event-metrics-v2 semantics):
  - first duel = the round's earliest opponent kill;
  - trade = the member kills, within 5 s, the opponent who killed a teammate.
- **Trade proximity.** Trades are time-based only. `kill.location` is never assumed to be the victim's position, and the
  victim never appears in a kill's snapshot list.
- **Clutch** = the member is the last certain survivor with at least one opponent alive. Rounds with a revive or a
  recorded-dead killer are excluded (2 759 member-rounds).
- **Site context:**
  - Each event-time snapshot of the member is classified by site-reference-v1. Of 78 018 snapshots, 9 578 (12.3 %)
    were site-proximal and 68 440 abstained.
  - Post-plant at site = a snapshot after the plant time that is proximal to the planted site.
- **First-contact site context** (step 10) returns only A / B / C / OTHER / UNKNOWN:
  - A 67, B 98, C 9;
  - OTHER 1 366 (a snapshot exists but is not proximal to a site);
  - UNKNOWN 1 536 (no own snapshot at that kill, e.g. the victim).
- **Team spacing** (step 12) is not implemented. Event-time spacing exists only in raw units, it cannot be named, and no
  differentiating signal was established, so it stays RESEARCH_ONLY.

## 3. team-composition-v2 model

- **Rates.** Computed per member × side and refined to member × role × side when that role has ≥ 5 matches. The rates
  are first contact, trade, assists, survival, plant, post-plant at site, site presence and clutch (`(wins+1)/(attempts+5)`).
- **Shrinkage.** Every rate is shrunk toward the **group** mean with n/(n+8), where n = distinct matches. The role scope
  shrinks toward the group mean too, so it is never less shrunk than the group median it is compared with.
- **Threshold.** A member is "above" when their shrunk rate exceeds the group median. Claims need ≥ 5 distinct matches
  on that side.
- **Unique labels**, assigned best member first: ATTACK_PRIMARY_ENTRY (first contact), ATTACK_SECOND_ENTRY_TRADE
  (trade), DEFENSE_FIRST_CONTACT (first contact).
- **Per-member labels**, first match wins:
  - Attack: INFO_SETUP (Initiator + assists), SPACE_CONTROL (Controller + survival), PLANT_SUPPORT, POST_PLANT,
    UTILITY_SUPPORT (assists).
  - Defense: SITE_HOLD (site affinity + site presence), CLUTCH (≥ 5 attempts), INFO_SUPPORT (Initiator + assists),
    FLEX (no affinity with ≥ 10 voting matches).
  - ROTATION_SUPPORT is never emitted: there are no paths.
  - An agent class alone never decides a label.
- **Site affinity** (member × map × side):
  - Each **match** casts one vote: its majority site, with ties casting no vote. Attack votes come from the plant site
    when the member planted or was post-plant at that site; defense votes come from site presence.
  - An affinity needs ≥ 5 voting matches and a one-sided exact binomial p ≤ 0.05 against the **group's own** base rate
    for that map × side.
  - So one match cannot inflate an affinity, and an even site mix never produces one.
- **Confidence per side** = 100·√min(matches/20, 1). It is separate from V1's Team Fit and confidence.
- **Boundary** `{ namedCallouts: false, exactPositions: false, paths: false, realTime: false }`.

## 4. Holdout (chronological 70/30 by Competitive match)

The site reference was rebuilt from training plants only, and no held-out match event contributed to training
(12 204 train member-rounds, 5 589 test). Spearman values are member-level (9 members, ≥ 5 matches on both sides of the
split).

**A. Side behaviour consistency**

| Rate | Attack ρ | Defense ρ |
|---|---|---|
| First contact | **0.80** | **0.70** |
| Trade | **0.65** | 0.43 |
| Assists | 0.15 | **0.78** |
| Survival | 0.32 | 0.25 |
| Plant | **0.90** | — (attackers only) |
| Post-plant at site | **0.63** | 0.22 |
| Site presence | 0.35 | 0.17 |
| Clutch | 0.62 (not used on attack) | **−0.43** |

The within-member attack − defense difference kept its sign for first contact 8/9, trade 6/9, assists 6/9 and
survival 2/9.

**B. Site tendency consistency: FAIL.** Of 6 affinities established in training, only **1** was found again in the
test period. On full data, 5 of 216 member × map × side cells show an affinity, and 97 have fewer than 5 voting matches.

**C. Responsibility stability: above chance.** Above-median flags agreed between train and test for 70.8 % of 144
member × side × rate flags, against 51.4 % expected by chance.

**D. Agent change check.** V2 never changes agents, so assignment changes = 0/9.

**E. Incremental performance.** Not applicable: the assignment is unchanged, so no outcome claim is made.

**Validation gate (`V2_VALIDATION`).**
- A label is **emittable** only if the rate that decides it reached ρ ≥ 0.6. For n = 9, that is roughly the one-sided
  5 % critical value.
- **Emittable:** ATTACK_PRIMARY_ENTRY, ATTACK_SECOND_ENTRY_TRADE, ATTACK_PLANT_SUPPORT, ATTACK_POST_PLANT,
  DEFENSE_FIRST_CONTACT, DEFENSE_INFO_SUPPORT.
- **NOT_VALIDATED (never shown):** ATTACK_INFO_SETUP, ATTACK_SPACE_CONTROL, ATTACK_UTILITY_SUPPORT, DEFENSE_SITE_HOLD,
  DEFENSE_CLUTCH, DEFENSE_FLEX, ROTATION_SUPPORT.
- **siteTendency = false:** every site tendency is reported as withheld.

## 5. Outcome

**OUTCOME_B: side-aware responsibilities, no site claims.**
- Side behaviour partly reproduces; site tendencies do not.
- Site **classification** itself is reliable. That is useful infrastructure, but not yet a member-level claim.
- Labels that did not reproduce are withheld rather than shown with low confidence.

## 6. Real examples

These use the same deterministic selection as V1 (five most active, most frequent five-stack, first five by public id ×
the two most-played maps and the least-played map). V2's assignment equals V1's in all 9. "—" means no validated label:
an abstention, not a weakness.

| Group / map | Assignment (V1 = V2) | Attack responsibilities | Defense responsibilities | Side confidence |
|---|---|---|---|---|
| Five most active / Ascent | jack Reyna, 加分 Sage, 小麻花 Clove, 天堂 Miks, 滑鏟 Astra | jack PRIMARY_ENTRY, 滑鏟 SECOND_ENTRY_TRADE, 天堂 PLANT_SUPPORT, 加分 —, 小麻花 — | jack FIRST_CONTACT, others — | 77–100 |
| same / Icebox | 滑鏟 Neon instead of Astra | 滑鏟 PRIMARY_ENTRY, jack SECOND_ENTRY_TRADE, 天堂 PLANT_SUPPORT | jack FIRST_CONTACT | 77–100 |
| Most frequent five-stack / Ascent | jack Reyna, 小麻花 Clove, 走路 Jett, 滑鏟 Astra, 滑板車 Miks | 走路 PRIMARY_ENTRY, jack SECOND_ENTRY_TRADE, 滑板車 PLANT_SUPPORT | 走路 FIRST_CONTACT | 92–100 |
| First five by id / Ascent | jack Clove, 加分 Sage, 小麻花 Astra, 天堂 Miks, 魔王 Reyna | 魔王 PRIMARY_ENTRY, jack SECOND_ENTRY_TRADE, 天堂 PLANT_SUPPORT | 魔王 FIRST_CONTACT | 77–100 |
| same / Icebox | jack Chamber, 小麻花 Clove | 魔王 PRIMARY_ENTRY, jack SECOND_ENTRY_TRADE, 天堂 PLANT_SUPPORT | 魔王 FIRST_CONTACT | 77–100 |

- **Summit** reproduces the Ascent rows exactly.
- **Site tendency:** withheld for every member. With the gate off, for research only, the Ascent defense evidence
  showed 加分 B in 18 of 19 matches and 天堂 A in 10 of 11. This is exactly the kind of in-sample tendency that the
  holdout failed to confirm.
- **DEFENSE_INFO_SUPPORT** does not appear because none of these lineups assigns an Initiator.

## 7. Language boundary

| Allowed (only when a validated claim exists) | Forbidden |
|---|---|
| 「進攻時歷史上較常取得首殺接觸」 | Callouts: A Heaven, A Long, Garage, Market, CT, Default, Back Site |
| 「歷史上較常出現在 A 區植包附近事件」 (**currently withheld**: site tendency not validated) | 「你應該站在 x,y」, 「走這條路」, 「固定守這個角」 |
| "SITE HOLD TENDENCY" wording (never "anchor"; currently withheld) | Any route, path, exact position or real-time instruction |

**Path readiness:** ENTRY_PATH, LURK_PATH and ROTATION_PATH stay **NOT_READY** (event-time snapshots only).

## 8. Regressions (verified 2026-10-08)

- **V1 demo output byte-identical** (`cmp` against the pre-task output).
- **shared-match-rating-v1 exact:** jack 80.9, 走路 78.0, 魔王 72.0, 滑鏟 55.6, 天堂 42.3, 加分 40.5, 夏天 38.2,
  滑板車 25.8, 小麻花 25.5.
- **Facts and evidence unchanged:**
  - analysis facts fingerprints unchanged (event-metrics-v1 `6e3526ee`, event-metrics-v2 `e01dc08f`);
  - 0 basic-stat violations and 0 unexpected semantic diffs;
  - rank context identical across engines, with 0 future leaks.
- **Inputs not modified by this task:** the agent catalog and position-evidence-v1 normalizer were not touched.
  Provider requests stayed 689 and raw payloads are unchanged.

## 9. Tests

`tests/teamCompositionV2.test.ts`, synthetic only, 19 tests:

- **Site model:**
  - labels and centroid; nearest proximal site;
  - P95 vs P99;
  - abstention and ambiguity;
  - map isolation and the minimum sample per site;
  - chronological reference (uses only the plants given);
  - input-order determinism.
- **Side evidence:** explicit side and unknown side; first duel, the 5 s trade window, plant and post-plant;
  first-contact context (letter / OTHER / UNKNOWN, never the victim's position); clutch, including topology exclusion.
- **Responsibilities:**
  - V1 assignment unchanged;
  - every label under full validation;
  - the default gate withholding labels and sites;
  - side separation and unknown side excluded;
  - no forced affinity, and one match not inflating evidence;
  - confidence vs sample size and map isolation;
  - determinism and no raw coordinates in output;
  - the exact binomial tail.
- **Boundary scope change:** `tests/teamComposition.test.ts` now applies its no-position rule to the V1 modules only. A
  new test bans callout vocabulary and external transform fields from the V2 modules.
