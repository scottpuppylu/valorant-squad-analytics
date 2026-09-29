# Real data field audit

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
| Trade participation | RECONSTRUCTABLE | ordered kills, killer, victim, assistants, teams | Requires an explicit time window and teammate rule; the current prototype uses 5 seconds. |
| KAST | RECONSTRUCTABLE | kills, assistants, ordered deaths/trades, round participants | K/A/S are observable; T depends on the documented trade rule. Provider does not label KAST directly. |
| Clutch attempts/wins | RECONSTRUCTABLE | ordered kills, teams, round winner, plant/defuse timing, round participants | Must define 1vX entry state, alive reconstruction and win condition. Not yet normalized or scored. |
| Economy | PARTIAL | match economy totals; round loadout, remaining, weapon, armor; round outcome | Supports loadout efficiency and buy-state bands. Exact purchase/sale/drop ledger and utility purchase details were not observed. |
| Impact Kill / Frag Quality | RECONSTRUCTABLE | ordered kills, round state, team state, plant/defuse, economy snapshot | A transparent product weighting can be built; no provider field is an authoritative impact score. |
| Role Value | PARTIAL | agent, aggregate ability-cast counts, assists, damage, plants/defuses, round result | Cast counts exist, but round utility casts were 100% null and effect events such as flashes, reveals, smokes blocked or healing value were not observed. |
| Consistency | DERIVABLE | multiple player-match observations of ACS/KAST and timestamps | Meaningful only with a minimum sample and evidence-aware uncertainty. |
| Current/peak rank and RR | DIRECT | MMR current/peak/seasonal fields | Displayable as provider observation; must remain separate from community scores. |

## Trade finding

Trade evidence is **RECONSTRUCTABLE**, not direct. The event stream includes ordered kills, team membership and participant identifiers. A trade requires a product definition such as: a teammate kills the original killer within five seconds in the same round. That window is not an official label and must be configurable, tested and included in calculation traces.

## KAST finding

KAST is **RECONSTRUCTABLE**. Kill and assist events are available; survival follows from whether a player died in the round; traded death follows from the explicit trade rule. The score must carry an evidence flag because the provider does not supply KAST as a direct field.

## Clutch finding

Clutch is **RECONSTRUCTABLE** from the ordered event stream, team rosters, round winner and plant/defuse events. The future engine must specify when a clutch attempt begins, how simultaneous events are ordered, whether disconnected/missing participants invalidate a round and how 1v1 through 1v5 are weighted. The current normalized model does not retain enough evidence, so the public clutch value remains unavailable for real datasets until DATA-01/metric work is completed.

## Economy finding

Economy is **PARTIAL**. Per-match spend/loadout aggregates and per-round loadout, remaining credits, weapon and armor are observed. This supports transparent buy-state and output-per-loadout analyses. It does not prove complete purchase history, dropped-weapon ownership, refunds or utility expenditure; those claims must remain unavailable.

## Impact kill finding

Impact Kill / Frag Quality is **RECONSTRUCTABLE** as a community definition using opening kills, trades, multi-kills, player-count state, round result, plant/defuse timing and round economy. It is not a direct Henrik or Riot metric and must expose every component weight.

## Role value finding

Role Value is **PARTIAL**. Agent identity, assists, damage, objective events and aggregate ability-cast counts are usable. Round-timed ability-cast fields were null throughout the sample, and no effect-quality events were observed. The first production version may use only evidenced components and must mark unavailable utility-effect components rather than replacing them with zero or neutral 50.

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

