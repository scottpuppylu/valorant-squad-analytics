# Event reconstruction robustness — TASK-ANALYTICS-EVENT-RECONSTRUCTION-ROBUSTNESS-01

**STATUS: COMPLETE / OUTCOME_A / ACCEPTED (2026-10-08).** [UPDATE 2026-10-08: event-metrics-v2 is now the LOCAL canonical engine
(TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01, [EVENT_METRICS_V2_ROLLOUT.md](EVENT_METRICS_V2_ROLLOUT.md)); "v1 stays the default" below describes
the state when this task closed. Not pushed.]
- Event reconstruction was safely improved, and richer metrics now have materially better usable coverage.
- Everything ran offline over the private staging data: 0 provider requests, no Neon.

| Item | Value |
|---|---|
| Versions | `event-metrics-v2`, `round-topology-v1` |
| v1 (`event-metrics-v1`) | Unchanged; still the **default** of `EventMetricEngine` and of the canonical runtime (projection, analysis facts, static export, public payload) |
| v2 | Selected explicitly, `new EventMetricEngine({ ruleVersion: 'event-metrics-v2' })`; same class and helpers, not a duplicated engine |
| shared-match-rating-v1 | Unchanged (still built with v1) |

## Previous behavior (v1)

`eventComplete` was **match-global**:
- every round had to pass `validTopology`: every killer alive at the kill, every victim dying at most once, killer ≠
  victim;
- one failing round made Trade *unavailable* and KAST, Opening, Clutch and Impact *partial* for **every player of the
  match**.

Scoring then uses only fully reconstructed matches for event components. So Round Impact, Entry, Teamplay, Role Value
and KAST existed for about 3–5 % of real pair units.

## Failure taxonomy (548 eligible Competitive / Unrated matches)

| Class | Events | Matches | Explanation (from weapon / damage type and timing) | Scope |
|---|---|---|---|---|
| SELF_KILL | 783 | 352 | Spike detonation (`Bomb`, 552), Clove "Not Dead Yet" expiry (162), falls (58), a few self-damaging abilities | PLAYER_LOCAL (a death) |
| REVIVE (victim dies again) | 1 420 | 430 | Sage resurrection and Clove self-revive. The second deaths are mostly rifle kills 5–15 s+ later; consistent round offsets in all 10 869 rounds rule out mis-bucketed events | PLAYER_LOCAL |
| POSTHUMOUS_KILL (killer recorded dead) | 935 | 355 | Kills after a revive (mostly rifles) plus persistent-utility kills; the feed cannot tell which | PLAYER_LOCAL |
| TEAM_KILL | 20 | 14 | Friendly-fire ability kills | PLAYER_LOCAL |
| INVALID_PLAYER_REFERENCE / IMPOSSIBLE_EVENT_ORDER / MISSING_ROUND_PARTICIPANTS | 0 | 0 | — | ROUND_LOCAL (would fail closed) |
| MISSING_KILL_EVENT (round stats kills > credited events) | 0 | 0 | — | — |
| Missing kill feed | — | 1 | `killsStatus` not observed | MATCH_GLOBAL |

**TRUE AMBIGUITY: 0 matches.** 547 of 548 matches have fully trusted round topology. v1 failed them because its "one
life per round, killer alive" rule is false for modern VALORANT, not because the data is corrupt.

## v2 model

**Round topology (`server/metrics/roundTopology.ts`):**
- Every event is classified as an opponent kill, self kill or team kill, with flags "killer recorded dead" and
  "victim revived".
- **Three-valued life timeline** per player and event: `alive` / `dead` / `unknown`.
  - A death makes a player dead.
  - A **later death** proves a revive happened in between. The revive moment is unknown, so the span is `unknown`, and
    the player is proven `alive` just before the later death.
  - A **kill credited to a recorded-dead player** (posthumous or revived — undecidable) makes the span `unknown`.
- Nothing is inferred beyond what the feed proves. A revive followed by no event is invisible, the same blind spot as v1.
- **True ambiguity fails closed, exactly like v1:** a killer or victim outside the round's participants or with unknown
  team, an exact duplicate event, or a round without observed participants.

**Per-metric semantics (`server/metrics/eventMetricsV2.ts`).** Unknown never becomes 0.

| Metric | v2 rule | When it becomes PARTIAL |
|---|---|---|
| Opening | Earliest **opponent** kill of the round. Self, team and environmental deaths never open a duel; a later revive cannot rewrite it | Untrusted round only |
| KAST | Each letter separately. **K** = opponent kill credited to the player (posthumous kills count — the provider credits them). **A** = provider assist on an opponent's death. **S** = alive at round end (a recorded death is never "survived"). **T** = the player's **final** death of the round was an opponent kill traded within 5 s | When K, A and T are false and the end-of-round state is undecidable |
| Trade | v1 rule (5 s retaliation by the victim's teammate on the killer) over **opponent kills only**; every death is evaluated on its own (multiple life segments). Self / team / environmental deaths are not trade-eligible | Untrusted round only |
| Clutch | v1 attempt rule (player alive, last of team, 1–5 opponents) evaluated on alive-count **bounds**; counted only when certain | When an attempt is possible but not certain |
| Impact | Multi-kill, won-round and trade kills count opponent kills only. Man-disadvantage and clutch-state kills are decided on alive-count bounds, i.e. only when every consistent interpretation gives the same answer | When either is undecidable |
| Economy / objectives / ability casts | Unchanged (not topology-dependent) | — |

Provider facts (kills, deaths, assists, ACS, ADR) are never changed; raw staged documents are untouched. Scoring
accepts v1 or v2 evidence through `isEventMetricRuleVersion` (same contract, formulas and gates). Synergy and the public
dataset contract still accept only v1.

## Tests

- `tests/eventReconstructionV2.test.ts`, 12 tests:
  - NORMAL_ROUND (v2 ≡ v1 on every metric);
  - SELF_KILL_ROUND, VALID_POSTHUMOUS_KILL, REVIVE_THEN_SECOND_DEATH, REVIVE_THEN_SURVIVE, POSTHUMOUS_KILL_AFTER_DEATH,
    MULTIPLE_KILLS_ACROSS_LIFE_SEGMENTS;
  - TRUE_IMPOSSIBLE_EVENT_ORDER, MISSING_EVENT_REFERENCE and AMBIGUOUS_REVIVE (fail closed);
  - a missing kill feed;
  - "decided only when all interpretations agree".
- All existing v1 metric-reconstruction, scoring, synergy and analysis-fact tests pass unchanged.

## Real-data before / after (offline, same 548 eligible matches, 1 270 member-matches)

| Usable (all tracked members, reconstructed) | v1 matches | v2 matches | v1 member-matches | v2 member-matches |
|---|---|---|---|---|
| KAST | 45 | **547** | 110 | **1 269** |
| Opening | 45 | **547** | 110 | **1 269** |
| Trade | 45 | **547** | 110 | **1 269** |
| Clutch | 45 | **341** | 110 | **984** |
| Round-impact context | 45 | **342** | 110 | **987** |
| All five (full-metric matches) | 45 | **272** | — | — |
| Partial matches | 503 | 276 | — | — |
| True ambiguous matches | — | **0** (1 lacks a kill feed) | — | — |

**Non-regression on real data:**
- Of the 246 member-matches that v1 fully reconstructed, **243 are byte-identical in v2**.
- The 3 that differ are all in **one match with 7 friendly-fire ability kills** (e.g. Phoenix "Hot Hands"). v1 counted
  team kills as kills and openings; v2 does not (an intentional correction).

### Pair-unit coverage (1 341 units; shared-match-rating-v1 unchanged)

| Available on both sides | v1 | v2 |
|---|---|---|
| Firepower | 1 151 | 1 151 |
| KAST | 130 | **1 341** |
| Round Impact | 42 | **582** |
| Teamplay | 42 | **1 028** |
| Entry / Role Value / single-match profile | 42 | **1 028** |
| Engine Overall (one match) | 42 | **582** |

### Candidate-signal review (Phase A audit only; no rating changed)

Role bias = mean Duelist − non-Duelist margin in within-member SD units. Stability = first-half vs second-half sign
agreement over 36 pairs. Saturation = share of one-match values at 0 or 100.

| Candidate (v2 evidence) | Availability | Role bias | Stability | Within-SD | Saturation |
|---|---|---|---|---|---|
| **Firepower (v1 baseline)** | 85.4 % | 0.66 | 0.86 | 35.3 | **51 %** |
| Single-match profile (5 one-match dimensions, overall-profile-v1 weights) | **82.1 %** | 0.73 | **0.92** | **20.5** | **0 %** |
| Firepower + Round Impact | 46.5 % | 0.74 | 0.81 | 25.2 | 5 % |
| Engine Overall | 46.5 % | 0.80 | 0.74 | 19.1 | 0 % |
| Round Impact | 46.5 % | 0.65 | 0.71 | 19.4 | 4 % |
| Teamplay | 82.1 % | 0.44 | 0.72 | 23.3 | 2 % |
| Entry | 82.1 % | **0.15** | 0.83 | 24.7 | 6 % |
| Role Value | 82.1 % | 1.03 | 0.86 | 23.2 | 2 % |
| KAST (raw rate) | **100 %** | **0.17** | 0.86 | 0.1 | — |

**Conclusion.** Richer evidence removes Firepower's single-match saturation (51 % → 0 %), cuts match noise (SD 35 → 20)
and raises stability (0.86 → 0.92) at similar availability (82 %). It does **not** by itself reduce Duelist bias: the
profile carries 0.73. Low-bias signals now exist at high coverage, notably KAST (0.17, 100 %), Entry (0.15) and Teamplay
(0.44). Combining them is a model-design decision, so it was not done here.

**SHARED_MATCH_V2_RECOMMENDED = YES.** It is a design task (TASK-SCORING-SHARED-MATCH-02) for SDD. Shared-match v1 stays
frozen and was not changed.

## Unresolved / follow-ups

- **Canonical adoption of v2 is a separate rollout:**
  - switch the runtime default;
  - bump the analysis-facts engine key so stored facts re-hydrate;
  - widen the public `datasetContract` / synergy rule-version checks;
  - re-verify static query parity and analysis-fact parity.
  - It is not done here. The production read path stays v1.
- **Undecidable alive counts** keep Clutch / Impact partial in about 38 % of matches. A **firearm** kill by a
  recorded-dead player would prove a revive (only utility kills can be posthumous), but the metric input carries no
  weapon class. Adding it is a possible future precision step.
- **Silent revives** (revived, then no kill or death) are invisible in the kill feed, as in v1.
