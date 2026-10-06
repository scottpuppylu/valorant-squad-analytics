# Real data field audit

> **TASK-DATA-PERFORMANCE-SCORE-01 (2026-10-06): post-13.06 legacy score semantics.** Henrik `players[].stats.score` is still the legacy combat-score TOTAL. Post-patch stored totals have median 3,720, max 10,499, and 98.3% > 500, so they are not the 0–500 Performance Score. ACS = score ÷ rounds stays **ACS_SAFE**. A Performance Score field is NOT VERIFIED (public OpenAPI 4.6.0 has none; v4.10.0 BETA announces "performance scores" without a schema). See [PERFORMANCE_SCORE.md](PERFORMANCE_SCORE.md).

Audit date: 2026-09-30

Task: TASK-API-02.1

Provider: HenrikDev (unofficial)

Observed OpenAPI version: 4.6.0

## Scope and privacy boundary

This report records a single controlled audit against one explicitly consenting account. The audit used a three-match v4 history sample, one v4 match-detail response, two bounded history windows, two stored-match requests, current MMR and MMR history. It retained only field paths, JSON types, observation counts, missing counts and null frequencies. No Riot ID, PUUID, match ID, raw provider response, API key or event value was written to this repository.

The findings prove only that the fields were observed in this sample on this date. They do not prove lifetime completeness, universal queue coverage, future schema stability or official Riot support. HenrikDev is an unofficial provider.

Classification vocabulary:

- **DIRECT**: the provider exposes the value at the required grain.
- **DERIVABLE**: a deterministic arithmetic transformation of observed aggregate fields is sufficient.
- **RECONSTRUCTABLE**: ordered events are sufficient only after applying a documented product rule.
- **PARTIAL**: some evidence exists, but it cannot support the complete concept.
- **NOT AVAILABLE**: the required evidence was not observed.

## Endpoint evidence

| Endpoint family | Result | Sanitized evidence |
|---|---|---|
| v4 match history | OBSERVED | 3 matches; 30 player rows; 62 rounds; 478 kill events |
| v4 match detail | OBSERVED | 1 match; 10 player rows; 24 rounds; 177 kill events |
| v4 history windows | OBSERVED | `start=0,size=3` and `start=3,size=3` each returned 3 matches, with zero overlap |
| stored matches | OBSERVED | two bounded requests each returned 3 rows with zero overlap; pagination counters were present |
| current MMR | OBSERVED | current, peak and 13 seasonal summary rows were structurally present |
| MMR history | OBSERVED | 18 history rows were structurally present |

No identifier values are included above. Counts are aggregate audit evidence only.

## Observed field families

### Match metadata

Observed without nulls in the three-match sample:

- `metadata.match_id`
- `metadata.map.id`, `metadata.map.name`
- `metadata.queue.id`, `metadata.queue.name`
- `metadata.started_at`, `metadata.game_length_in_ms`, `metadata.game_version`
- `metadata.platform`, `metadata.region`, `metadata.cluster`
- `metadata.season.id`, `metadata.season.short`
- `metadata.is_completed`

### Player and team aggregates

Observed on all 30 player rows:

- `players[].puuid`, `players[].team_id`, `players[].agent.id`, `players[].agent.name`
- `players[].stats.kills`, `deaths`, `assists`, `score`
- `players[].stats.damage.dealt`, `damage.received`
- `players[].stats.headshots`, `bodyshots`, `legshots`
- `players[].ability_casts.ability1`, `ability2`, `grenade`, `ultimate`
- `players[].economy.loadout_value.overall`, `average`
- `players[].economy.spent.overall`, `average`

Observed on all six team rows:

- `teams[].team_id`, `teams[].won`
- `teams[].rounds.won`, `teams[].rounds.lost`

Name and tag fields existed, but the product must not persist or expose them as audit evidence. Server normalization uses identities transiently and returns opaque internal keys.

### Round evidence

Observed on all 62 rounds:

- `rounds[].id`, `rounds[].winning_team`, `rounds[].result`
- `rounds[].stats[].player.puuid`
- `rounds[].stats[].stats.kills`, `stats.score`
- `rounds[].stats[].economy.loadout_value`, `economy.remaining`

Plant occurred in 39 of 62 rounds and defuse in 16 of 62 rounds. Their nested player and round-time fields were present when the event existed. This conditional absence is expected, not a data-quality failure.

Weapon name/id was present on 619 of 620 round-player observations. Armor name/id was present on 533 of 620. Round-level `ability_casts.ability_1`, `ability_2`, `grenade` and `ultimate` were present as keys but null on all 620 observations. Match-level ability-cast totals were populated, so round-timed utility evidence is **NOT AVAILABLE** in this sample.

### Kill events

Observed across all 478 kill events:

- `kills[].round`
- `kills[].time_in_round_in_ms`, `kills[].time_in_match_in_ms`
- `kills[].killer.puuid`, `kills[].victim.puuid`
- `kills[].assistants[].puuid` when assistants existed
- `kills[].weapon.id`
- `kills[].location.x`, `kills[].location.y`
- `kills[].player_locations[].player.puuid` and location coordinates

`kills[].weapon.name` was null on 4 of 478 events while weapon ID remained present. Calculations must use the stable ID or tolerate an absent display name.

### MMR and rank

Current MMR exposed `data.current.tier.id/name`, `rr`, `elo`, `last_change`, peak tier/RR/season and seasonal games/wins/end tier/end RR. MMR history exposed date, match ID, map, season, tier, RR, Elo and last change. These are provider-supplied ranked-system observations, not inputs to the community performance score.

## Capability matrix

| Product metric | Class | Exact required fields | Finding |
|---|---|---|---|
| Matches, wins, rounds | DIRECT | `metadata.match_id`, `teams[].won`, `teams[].rounds.won/lost`, player `team_id` | Available for observed matches. |
| Kills, deaths, assists | DIRECT | `players[].stats.kills/deaths/assists` | Available at player-match grain. |
| ACS | DERIVABLE | `players[].stats.score` / team rounds played | Provider total score is direct; ACS is calculated without rounding until presentation. |
| ADR | DERIVABLE | `players[].stats.damage.dealt` / team rounds played | Deterministic for observed completed matches. |
| K/D, KPR, APR | DERIVABLE | K/D/A totals plus rounds | Zero denominators require the existing safe-division rule. |
| HS% | DERIVABLE | headshots / (`headshots + bodyshots + legshots`) | Shot-location denominator is observed. |
| First kills/deaths, FK/FD | RECONSTRUCTABLE | kill round, round time, killer, victim | Earliest kill per round is the product rule; ties need deterministic ordering. |
| Trade participation | RECONSTRUCTABLE | ordered kills, killer, victim, assistants, teams | Implemented as `event-metrics-v1` with an explicit 5-second rule; it is not a provider label. |
| KAST | RECONSTRUCTABLE | kills, assistants, ordered deaths/trades, round participants | Implemented as `event-metrics-v1`; provider does not label KAST directly. |
| Clutch attempts/wins | RECONSTRUCTABLE | ordered kills, teams, round winner, round participants | 1v1–1v5 evidence is reconstructed in `event-metrics-v1`; no Clutch score or weighting exists yet. |
| Economy | PARTIAL | match economy totals; round loadout, remaining, weapon, armor; round outcome | Match damage/kills per 1,000 spent is derived; exact purchase/sale/drop ledger, buy-state bands and utility costs remain unavailable. |
| Impact Kill / Frag Quality | RECONSTRUCTABLE | ordered kills, round state, team state, plant/defuse, economy snapshot | Context components are reconstructed, but no provider-authoritative or product-weighted Impact Score exists. |
| Role Value | PARTIAL | agent, aggregate ability-cast counts, assists, damage, plants/defuses, round result | Input availability is prepared; utility-effect evidence and Role Value scoring remain unavailable. |
| Consistency | DERIVABLE | multiple player-match observations of ACS/KAST and timestamps | Meaningful only with a minimum sample and evidence-aware uncertainty. |
| Current/peak rank and RR | DIRECT | MMR current/peak/seasonal fields | Displayable as provider observation; must remain separate from community scores. |

## Trade finding

Trade evidence is **RECONSTRUCTABLE**, not direct. `event-metrics-v1` now applies the documented five-second teammate-retaliation rule with time/sequence ordering, one classification per death and one Trade Kill per physical retaliation event. That window is not an official provider label. Server-only traces and public evidence status retain the rule version.

## KAST finding

KAST is **RECONSTRUCTABLE**. `event-metrics-v1` implements K/A/S/T at eligible-round grain and exposes evidence coverage because the provider does not supply KAST as a direct field. Missing topology yields partial/unavailable rather than a numeric substitute.

## Clutch finding

Clutch is **RECONSTRUCTABLE** from the ordered event stream, full anonymous round presence and round winner. `event-metrics-v1` defines an attempt as the first post-event state where the player is the sole living teammate against 1–5 living opponents; invalid topology omits the round, and a missing winner preserves the attempt while making win evidence partial. No opponent-count weighting, shrinkage or Clutch score is implemented.

## Economy finding

Economy is **PARTIAL**. Per-match spend/loadout aggregates and per-round loadout, remaining credits, weapon and armor are observed. TASK-METRICS-01 derives damage and kills per 1,000 spent only when total spend is positive. It does not prove complete purchase history, buy-state bands, dropped-weapon ownership, refunds or utility expenditure; those claims remain unavailable.

## Impact kill finding

Impact Kill / Frag Quality is **RECONSTRUCTABLE** as a future community definition. TASK-METRICS-01 exposes opening, trade, man-disadvantage, clutch-state, won-round and multi-kill context counts, but deliberately assigns no component weight and creates no Impact Score. It is not a direct Henrik or Riot metric.

## Role value finding

Role Value is **PARTIAL**. Agent identity, assists, damage, objective events, Trade Assists, KAST/survival and aggregate ability-cast counts are usable inputs. Round-timed ability-cast fields were null throughout the sample, and no effect-quality events were observed. TASK-METRICS-01 records this availability but does not calculate Role Value; TASK-002B must keep unavailable utility-effect components distinct from zero or neutral 50.

## History, pagination and lifetime completeness

The current v4 history route accepted `size` and `start`; two adjacent windows returned six distinct matches. The response did not include total-count or next-cursor metadata, so incremental sync must stop on an empty/short page or a known match boundary and must deduplicate by provider match ID server-side.

Stored matches exposed `results.total`, `returned`, `before` and `after`. A `page` parameter changed the observed results, but `page` is not documented in the current OpenAPI contract. It must not be a production dependency without provider confirmation and a contract test.

Stored matches are provider-cached records previously retrieved by the API, not a guaranteed complete player lifetime archive. Neither endpoint supports a truthful claim of complete lifetime history. The product must display import coverage dates and last-sync status instead.

## Evidence handling requirements

- Preserve raw provider responses only in a protected, short-retention server workflow if a future task explicitly approves it; never in Git or browser localStorage.
- Persist provider match IDs and PUUIDs only as encrypted or keyed server identifiers needed for deduplication/deletion; public APIs return opaque internal IDs.
- Version the provider schema, normalizer, reconstruction rules and scoring formula independently.
- Treat absent, null, unavailable and observed zero as different states.
- Re-run a bounded sanitized audit when OpenAPI or provider payload versions change.

## Sources

- [HenrikDev unofficial VALORANT API repository](https://github.com/Henrik-3/unofficial-valorant-api)
- [HenrikDev v4.6.0 release notes](https://docs.henrikdev.xyz/valorant/changes/v4.6.0)
- [HenrikDev OpenAPI 4.6.0](https://api.henrikdev.xyz/openapi.json)
