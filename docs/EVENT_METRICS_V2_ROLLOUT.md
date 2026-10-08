# event-metrics-v2 local canonical rollout — TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01

**STATUS: LOCAL_V2_CANONICAL_READY = YES; LOCAL_DEFAULT_SWITCHED = YES (2026-10-08). AWAITING SDD REVIEW.**

**Public rollout remains BLOCKED.** Nothing was pushed, deployed or published. Vercel, Neon, GitHub Pages and the data
repository are unchanged. The production read path keeps running the pushed code (v1) until a separate SDD gate.

| Item | Value |
|---|---|
| Canonical (local) | `event-metrics-v2` (+ `round-topology-v1`) |
| Preserved | `event-metrics-v1`, callable and reproducible (the rollback engine) |
| Frozen on v1 | shared-match-evidence-v1 / shared-match-rating-v1 and the accepted Internal Strength Phase A evidence |

## Why v1 is outdated

event-metrics-v1 assumes one life per player per round and a living killer. Modern VALORANT rounds legitimately contain:
- Sage / Clove revives;
- Spike, fall and "Not Dead Yet" self deaths;
- recorded-dead kills;
- friendly-fire ability kills.

v1 fails closed on the **whole match** for any of these. On the 548 eligible real matches, only 45 had usable KAST,
Opening or Trade, and true ambiguity was effectively absent
([EVENT_RECONSTRUCTION_ROBUSTNESS.md](EVENT_RECONSTRUCTION_ROBUSTNESS.md)). This is a correctness and versioning problem,
not a request to loosen evidence standards.

## Accepted v2 semantics (unchanged by this task)

- Three-valued life timeline.
- KAST, Opening and Trade use opponent kills only.
- Self, environmental and team kills are deaths only.
- KAST "Traded" uses the final death.
- Clutch and Impact are decided only when every consistent interpretation agrees; otherwise PARTIAL, never 0.
- True ambiguity (exact duplicate event, reference outside the round, missing participants or kill feed) still fails
  closed.
- The evidence **shape** is identical to v1.

## Versioning strategy

| Place | Before | Now |
|---|---|---|
| Default engine | literal `event-metrics-v1` inside `EventMetricEngine` | `CANONICAL_EVENT_METRIC_RULE_VERSION` (`server/metrics/eventMetricEngine.ts`) — **the one switch**, now `event-metrics-v2` |
| v1 output label | `EVENT_METRIC_RULE_VERSION` | `EVENT_METRIC_RULE_VERSION_V1` (unchanged value) |
| Analysis facts | `engine_key = analysis-match-facts-v1:event-metrics-v1:durable-evidence-v2`, always written with that key whatever engine ran | `analysisFactsEngineKey(engine.ruleVersion)`: the key names the engine that **wrote** the fact; fresh only when it equals the canonical key (`…:event-metrics-v2:…`) |
| `ANALYSIS_FACTS_VERSION` | `analysis-match-facts-v1` | Unchanged: the fact shape did not change; the rule version inside the key is the version (no extra layer) |
| Public dataset contract (`datasetContract.ts`) | `ruleVersion === 'event-metrics-v1'` | `isEventMetricRuleVersion` (v1 or v2; unknown rejected); schema 6 unchanged — the shape is identical |
| Synergy contract + duo-synergy evidence checks | `=== 'event-metrics-v1'` | `isEventMetricRuleVersion`; duo-synergy-v1 formulas unchanged |
| Static export / public facts | Carries `ruleVersion` values via the allowlist | Unchanged allowlist; values now `event-metrics-v2` |
| Shared-match staging projection | Default engine | Pinned `SHARED_MATCH_EVIDENCE_EVENT_ENGINE = 'event-metrics-v1'` (frozen evidence) |
| UI metric definitions | Text names `event-metrics-v1` | Text names `event-metrics-v2` |

**Analytical facts migration.**
- No SQL migration.
- Raw evidence is untouched.
- Facts with the v1 key are simply not fresh for the v2 engine. The existing freshness guard reconstructs those matches
  from raw evidence, and `db:hydrate-facts` rebuilds them under the v2 key. It is the same deploy-time path as before.
- Old v1 facts are disposable: they are replaced, never read as v2.

## Real-data validation (offline, private staging, `npm run event-metrics:rollout`)

- 838 staged documents were projected through the canonical per-match pipeline, twice per engine.
- Raw payload hash, rank evidence hash and the provider-request count (689) are identical before and after.

### Basic stat parity

| Check | Result |
|---|---|
| Provider basics | Kills, deaths, assists, ACS, ADR, HS %, agent, team, team rounds and result, identity, plus match id / time / map / mode / score / Act: **0 differences** over 1 717 member-matches |
| Non-topology advanced evidence | Economy, objectives, ability casts: 0 differences |

**BASIC_STATS_PARITY = PASS.**

### Semantic diff (all 1 717 member-matches, every mode)

| Metric | UNCHANGED | EXPECTED_CORRECTION | UNEXPECTED_REGRESSION | UNKNOWN |
|---|---|---|---|---|
| KAST | 278 | 1 439 | **0** | **0** |
| Opening | 276 | 1 441 | 0 | 0 |
| Trade | 276 | 1 441 | 0 | 0 |
| Clutch | 713 | 1 004 | 0 | 0 |
| Impact context | 709 | 1 008 | 0 | 0 |

**Classification rules:**
- identical → UNCHANGED;
- partial → reconstructed in a match with raw complex topology (696 of 838 matches) → EXPECTED_CORRECTION
  (coverage restored, 6 324 metric cells);
- reconstructed → different reconstructed value in a team-kill match → EXPECTED_CORRECTION (team-kill semantics, 9 cells
  in the 18 team-kill matches);
- any other reconstructed → different, or reconstructed → not reconstructed → UNEXPECTED_REGRESSION: **none**;
- changes in a match without complex topology → UNKNOWN: **none**.

### Coverage (548 eligible Competitive + Unrated matches, 1 270 member-matches)

| Usable | v1 matches | v2 matches | v1 member-matches | v2 member-matches |
|---|---|---|---|---|
| KAST | 45 | 547 | 110 | 1 269 |
| Opening | 45 | 547 | 110 | 1 269 |
| Trade | 45 | 547 | 110 | 1 269 |
| Clutch | 45 | 341 | 110 | 984 |
| Round-impact context | 45 | 342 | 110 | 987 |
| One-match Entry / Teamplay / Role Value | — | — | 41 | 1 043 |
| One-match Round Impact | — | — | 41 | 784 |
| One-match Firepower (event-independent) | — | — | 1 184 | 1 184 |

### High-level analytics (unchanged functions and gates; Competitive only; 9 members)

| Analytic | v1 | v2 | Unavailable under v2 — exact gate |
|---|---|---|---|
| Community Score (Overall) | 0 / 9 | **5 / 9** | 3 members: Round Impact + Clutch dimensions unavailable → "Overall requires six dimensions and 75% configured weight". 1 member: Firepower and other components "below 70%" because 34 % of their Competitive matches are on agents missing from the role catalog (`Miks`, `Unknown`; separate catalog task) |
| Current Strength | 0 / 9 | **6 / 9** | The same 3 members: same Overall gate inside the adaptive window (28–30 matches, ~600 rounds; window itself available for all 9) |
| Recent Form | 0 / 9 | **2 / 9** | 7 members: Overall not numeric in the recent window (5–7 matches) or its baseline (6–9), so the existing formula returns "insufficient". The window is available for all 9 |
| Progress (improvement-index-v1) | 0 / 9 | **8 / 9** | 1 member: `insufficient_dimension_overlap`. Six of the eight values sit at ±100 or ±96, so the index saturates; it is trend context only |
| Role Value (role-aware) | 0 / 9 | **8 / 9** (partial) | The catalog-gap member |

Under v1, every member failed on the same root cause: the event dimensions are unavailable, so Overall fails its
six-dimension gate. No gate was relaxed.

The remaining v2 gaps come from two sources. Clutch and Impact stay undecidable where alive counts are ambiguous: 62 % of
matches are decided, and members whose matches more often contain ambiguous rounds miss two dimensions. The other gap is
the agent catalog.

### Facts, rebuild idempotency, rank, Shared-Match

**Facts.** Real-data fingerprints are SHA-256 over every participant fact with its engine key, in canonical order; the
same function feeds `analysis_participant_facts`.

| | v1 | v2 |
|---|---|---|
| Facts | 1 717 | 1 717 |
| Fingerprint | `6e3526ee…13bb` | `e01dc08f…49a7` |
| Second run | identical | identical |
| Bytes | 2 474 976 | 2 832 012 (+14.4 %) |

**Rank.** Rank evidence is unchanged (1 991 rows, hash equal before and after). Rank context is identical for all
1 341 pair units under both engines. 0 future-leak resolutions: every context is an exact in-match snapshot or strictly
earlier.

**Shared-Match v1.** shared-match-rating-v1 reproduces the accepted baseline exactly:
- jack 80.9, 走路 78.0, 魔王 72.0, 滑鏟 55.6, 天堂 42.3, 加分 40.5, 夏天 38.2, 滑板車 25.8, 小麻花 25.5.
- It is pinned to v1. A control computed from v2 projections gives the same numbers, since Firepower is
  event-independent.

## Database / static path validation (synthetic, PGlite = real PostgreSQL)

Real staged data cannot enter an application-schema database without consent records (the consent path was abandoned by
SDD). So the persisted-facts and static-export path was validated on synthetic data with **legitimate complex topology
written through the real durable write path** (`tests/eventMetricsV2Rollout.test.ts`):

- **Revive, Spike self death, recorded-dead kill, team kill:** canonical facts reconstructed under v2; the explicit v1
  engine still fails closed (partial) on the same raw evidence.
- **Engine switch:** facts written by the other engine are never fresh (fact path 0). Hydration re-keys every match
  exactly once, without duplicate rows and byte-identical to the first build. A second hydration has nothing to do. A
  from-scratch rebuild gives the same table hash.
- **Fact path vs raw path:** byte-identical for lifetime, map, agent, synergy, current strength + form, recent-10 and
  progress.
- **Static query parity:** browser engine vs server, byte-identical for lifetime, current (± form), map, agent,
  recent-10, Act, synergy, Unrated filter and per-member progress.
- **Candidate export:**
  - deterministic (same snapshot id, identical integrity manifest);
  - no PUUID, non-consenting player name, raw match id or 64-hex identifier outside the manifest checksum fields;
  - consenting members' public Riot names are the existing allowed public fields;
  - export written to a temp directory and deleted (existing practice). No publication.
- **Existing parity oracle** (`tests/staticQueryParity.test.ts`, unchanged file): CI level passes under v2 canonical
  (full suite), and at the `full` evidence level: **1 301 / 1 301 analysis and 100 / 100 weapon cases byte-identical**
  (2 138 278 numeric leaves compared).

## Synergy compatibility

- duo-synergy-v1 reads `advancedMetrics.ruleVersion` and pair trade-edge `ruleVersion`; it now accepts either known
  version.
- The structure is identical. The only semantic input change is the accepted v2 trade definition: opponent kills only;
  self, team and environmental deaths are not trade-eligible.
- Formulas, benchmarks, gates and the public synergy contract shape are unchanged.
- **SYNERGY_COMPATIBILITY = PASS; SYNERGY_SEMANTICS_CHANGED = NO.**

## Performance

| | v1 | v2 |
|---|---|---|
| Full canonical projection of 838 real matches (normalize + reconstruct + assemble), two runs | 6.0 / 4.9 s | 5.4 / 5.2 s |

- Per-round topology analysis is linear in events × participants. No pathological scaling.
- Facts are +14.4 % bytes (more reconstructed values, not more rows).
- The 10k synthetic static benchmark was not re-run (expensive; no change to the aggregate statements).

## Rollout gates

| Gate | Result |
|---|---|
| BASIC_STATS_PARITY | PASS |
| V2_RECONSTRUCTION_CORRECTNESS | PASS (0 unexpected, 0 unknown) |
| FACT_VERSIONING | PASS |
| REBUILD_IDEMPOTENCY | PASS |
| STATIC_QUERY_PARITY | PASS |
| SHARED_MATCH_V1_REGRESSION | PASS |
| RANK_REGRESSION | PASS |
| SYNERGY_COMPATIBILITY | PASS |
| SECRET_BOUNDARY | PASS |

**LOCAL_V2_CANONICAL_READY = YES.**

## Rollback

1. Set `CANONICAL_EVENT_METRIC_RULE_VERSION` back to `EVENT_METRIC_RULE_VERSION_V1` in
   `server/metrics/eventMetricEngine.ts` (one line).
2. Run `npm run db:hydrate-facts` (or the normal deploy hydration). v2-keyed facts become stale and are rebuilt under
   the v1 key from raw evidence. Until then, the freshness guard reconstructs from raw evidence, so results are exact
   either way.

No raw-data migration and no schema change are involved. Contracts accept both versions, so either direction is safe.

## Public rollout (later, separate SDD gate)

- Push the source, then let the normal Vercel build run `db:hydrate-facts` against production. That re-keys about
  1 700+ participant facts.
- Re-export a candidate static snapshot, re-run the parity oracle at `full` level, and publish via
  `npm run data:publish:github` only with explicit authorization.
- None of this was done here.
