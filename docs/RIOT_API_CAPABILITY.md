# Riot VALORANT API capability matrix

Research date: 2026-09-29

This document maps the product's desired evidence to Riot's current official VALORANT documentation. It is a readiness study, not a live integration. No key, OAuth client, request code, or unofficial API dependency is included.

TASK-002A.1 separately evaluates one unofficial provider as a local evidence spike. It does not change the official status labels in this document; see `docs/THIRD_PARTY_API_SPIKE.md`.

Primary sources:

- [Official VALORANT developer policy and endpoint inventory](https://developer.riotgames.com/docs/valorant)
- [Official Riot API reference](https://developer.riotgames.com/apis#val-match-v1)
- [Official Developer Portal FAQ](https://developer.riotgames.com/docs/faqs)
- [Official general API policy](https://developer.riotgames.com/policies/general)

## Status language

- **CONFIRMED**: an official endpoint/DTO directly documents the evidence.
- **DERIVABLE**: official documented fields are sufficient for a transparent calculation after a product definition is fixed.
- **PARTIAL**: useful official evidence exists, but important semantics, edge cases, or context are absent.
- **NOT CONFIRMED**: the reviewed official schema does not document enough evidence to make the claim.
- **NOT AVAILABLE**: the reviewed official schema documents no practical source for this need.

## Capability matrix

| Feature / metric | Required raw evidence | Demo | Official endpoint and field / DTO | Mode | Status | Transformation and limitation | Future use |
|---|---|---:|---|---|---|---|---|
| Match ID | Stable match key | Yes | Match by ID → `MatchInfoDto.matchId`; matchlist entries | Direct | CONFIRMED | Preserve as source identity; do not expose it as a secret. | Imports, deduplication |
| Player PUUID | Stable player identity | No | `PlayerDto.puuid`, `PlayerRoundStatsDto.puuid` | Direct | CONFIRMED | Store behind opt-in identity mapping. | Joins, aggregation |
| Riot ID | Player-facing identity | No | `PlayerDto.gameName`, `PlayerDto.tagLine`; RSO account `/riot/account/v1/accounts/me` | Direct | CONFIRMED | Public display still requires player opt-in and privacy rules. | Profile linking |
| Map | Map identifier | Yes | `MatchInfoDto.mapId` | Direct | CONFIRMED | Resolve ID through VAL-CONTENT-V1 or an approved content catalog. | Map analysis |
| Match timestamp | Start time | Yes | `MatchInfoDto.gameStartMillis`; `MatchlistEntryDto.gameStartTimeMillis` | Direct | CONFIRMED | Convert once to ISO/UTC in the adapter. | Recent form |
| Queue / game mode | Comparable mode | Partial | `MatchInfoDto.queueId`, `gameMode`; matchlist `queueId` | Direct | CONFIRMED | Filter modes before aggregating; modes are not automatically comparable. | Cohorts, filters |
| Character / agent | Agent identifier | Yes | `PlayerDto.characterId` | Direct | CONFIRMED | Resolve content ID to localized agent metadata. | Agent and role views |
| Team | Team membership | Partial | `PlayerDto.teamId`, `TeamDto.teamId` | Direct | CONFIRMED | Team IDs are arbitrary strings; do not assume only Red/Blue in every mode. | Wins, events |
| Rounds played | Player/team round count | Yes | `PlayerStatsDto.roundsPlayed`, `TeamDto.roundsPlayed` | Direct | CONFIRMED | Reconcile player and team counts; handle incomplete games. | Rate denominators |
| Kills | Player kills | Yes | `PlayerStatsDto.kills`; per-round `PlayerRoundStatsDto.kills` | Direct | CONFIRMED | Aggregate raw integer events without pre-rounding. | Firepower, Entry |
| Deaths | Player deaths | Yes | `PlayerStatsDto.deaths`; `KillDto.victim` | Direct | CONFIRMED | Event reconstruction must consider unusual mode rules. | K/D, survival |
| Assists | Player assists | Yes | `PlayerStatsDto.assists`; `KillDto.assistants` | Direct | CONFIRMED | Official total and kill-event assistants can be reconciled. | APR, Teamplay |
| Player score | Match combat score total | No | `PlayerStatsDto.score`; per-round `PlayerRoundStatsDto.score` | Direct | CONFIRMED | Official reference exposes score but does not define it as this product's ACS. | Combat evidence |
| ACS | Average combat score | Yes | `PlayerStatsDto.score`, `roundsPlayed` | Derived candidate | PARTIAL | `score / roundsPlayed` is computable, but equivalence to the product's ACS label must be validated before claiming it. | Firepower, Consistency |
| ADR | Damage per round | Yes | `DamageDto.damage`; `roundsPlayed` | Derived | DERIVABLE | Sum damage at player-round grain, then divide by eligible rounds. | Firepower |
| Damage | Damage by receiver | Partial | `PlayerRoundStatsDto.damage[].damage` | Direct | CONFIRMED | Reconcile duplicate receiver rows and mode behavior. | ADR, Economy |
| Head/body/leg hits | Hit locations | HS% only | `DamageDto.headshots`, `bodyshots`, `legshots` | Direct | CONFIRMED | Define HS% denominator explicitly; hits and kills are different grains. | HS%, aim context |
| Ability casts | Cast counts | No | `PlayerStatsDto.abilityCasts` | Direct | CONFIRMED | Counts do not establish whether a cast created value. | Utility context |
| Ability effects | Per-round effect strings | No | `PlayerRoundStatsDto.ability` / `AbilityDto` effect fields | Direct evidence | PARTIAL | Schema exposes strings but not stable, documented semantic events for every ability. | Future utility research |
| Round results | Round records | No | `MatchDto.roundResults`, `RoundResultDto.roundResult`, `roundResultCode` | Direct | CONFIRMED | Normalize only known values; preserve unknown codes. | Round impact |
| Round winner | Winning team | No | `RoundResultDto.winningTeam` | Direct | CONFIRMED | Join to player `teamId`. | KAST, clutch |
| Spike plant | Planter, time, site, location | No | `bombPlanter`, `plantRoundTime`, `plantSite`, `plantLocation` | Direct | CONFIRMED | Fields may be absent on non-plant rounds. | Objective impact |
| Spike defuse | Defuser, time, location | No | `bombDefuser`, `defuseRoundTime`, `defuseLocation` | Direct | CONFIRMED | Fields may be absent; round result remains authority. | Objective impact |
| First kill | Earliest kill event in round | Yes | `PlayerRoundStatsDto.kills[].timeSinceRoundStartMillis` | Derived | DERIVABLE | Flatten each round's kills, select earliest timestamp, record killer. | FK, FKPR, Entry |
| First death | Victim of earliest kill | Yes | same `KillDto`, using `victim` | Derived | DERIVABLE | Same tie/invalid-timestamp policy as first kill. | FD, FDPR, Entry |
| Kill timestamps | In-game and round-relative time | No | `KillDto.timeSinceGameStartMillis`, `timeSinceRoundStartMillis` | Direct | CONFIRMED | Preserve both clocks; never mix their units. | Trade, clutch |
| Assistants | PUUIDs on kill | No | `KillDto.assistants` | Direct | CONFIRMED | Does not by itself label flash or utility assists. | Teamplay, KAST |
| Player locations | Locations around events | No | `KillDto.playerLocations`, `victimLocation`, plant/defuse player locations | Direct | CONFIRMED | Snapshots are event-specific, not a complete movement timeline. | Context research |
| Per-round economy | Player round economy object | No | `PlayerRoundStatsDto.economy` | Direct | CONFIRMED | Available at player-round grain. | Economy dimension |
| Loadout value | Equipment value | No | `EconomyDto.loadoutValue` | Direct | CONFIRMED | Define buy-state buckets transparently. | Eco impact |
| Credits spent | Spend in round | No | `EconomyDto.spent` | Direct | CONFIRMED | Treat zero/low denominators carefully. | Damage/kills per 1000 |
| Credits remaining | Remaining credits | No | `EconomyDto.remaining` | Direct | CONFIRMED | Does not alone explain save intent. | Economy context |
| Weapon | Weapon content ID | No | `EconomyDto.weapon`; `FinishingDamageDto.damageItem` | Direct | CONFIRMED | Resolve IDs and distinguish loadout from finishing weapon. | Weapon/economy views |
| Armor | Armor content ID | No | `EconomyDto.armor` | Direct | CONFIRMED | Resolve through content data. | Economy context |
| Clutch attempt | Last survivor while enemies remain | Yes | kill timeline + teams + round participants | Reconstruction | PARTIAL | Standard rounds can be reconstructed, but revives, unusual modes and missing explicit alive-state events require careful rules. | Clutch denominator |
| Clutch win | Attempt followed by team round win | Yes | reconstructed attempt + `winningTeam` | Reconstruction | PARTIAL | Accuracy inherits clutch-state limitations. | Clutch score |
| 1vN state | Alive counts at isolation moment | No | ordered `KillDto` events + team membership | Reconstruction | PARTIAL | Possible for many standard rounds; official schema has no direct 1vN field and ability-based revive edge cases need validation. | Difficulty weighting |
| Trade kill | Timely revenge kill | No | ordered killers/victims, teams, timestamps, locations | Reconstruction | PARTIAL | A product-defined time window is realistic; it is not an official trade label and same-fight semantics remain approximate. | Teamplay, Round Impact |
| Traded death | Death followed by teammate trade | No | same kill timeline | Reconstruction | PARTIAL | Depends on the selected trade window and edge-case policy. | KAST, Entry context |
| Trade window | Time between death and return kill | No | `timeSinceRoundStartMillis` | Derived | DERIVABLE | The duration is computable; the threshold itself is a product definition. | Trade quality |
| KAST | K, A, survival or traded round | Yes (supplied) | round kills/assistants, victim events, round participants | Reconstruction | PARTIAL | K/A/S are largely reconstructable; T depends on a custom trade rule and revive/mode handling. Must expose coverage and rule version. | Teamplay, Consistency |
| Economy efficiency | Output per spend/loadout | No | damage, kills, `spent`, `loadoutValue` | Derived | DERIVABLE | Define eligible rounds and minimum denominator; do not average ratios naively. | Economy |
| Impact Kill / Frag Quality | Context-weighted event value | No | timestamps, alive-state reconstruction, economy, objective events | Modelled | PARTIAL | Evidence exists, but weights and meaning are product-defined, not official Riot metrics. | Round Impact |
| Teammate interaction | Assists, trades, proximity/utility | No | assistants, teams, event locations, partial ability effects | Reconstruction | PARTIAL | No complete communication, space creation or stable utility-impact feed is documented. | Teamplay, Synergy |
| Attack / Defense side | Team side each round | No | `RoundResultDto.winningTeamRole` plus round order/team | Reconstruction | PARTIAL | Official schema exposes winning-team role, not a direct side field for every player/team. Validate side-switch and overtime rules per mode. | Side splits |
| Flash assist | Flash specifically enabled kill | No | no dedicated documented field | — | NOT AVAILABLE | Ability effect strings are insufficient to claim a stable official flash-assist event. | Utility |
| Communication / calls | Voice/text decisions | No | none in reviewed API | — | NOT AVAILABLE | Must never infer private communication from performance events. | Not planned |

## Endpoint inventory

| API | Official route | Relevance |
|---|---|---|
| VAL-CONTENT-V1 | `GET /val/content/v1/contents` | Resolve localized map, character, weapon and armor content identifiers. It is not player performance data. |
| VAL-MATCH-V1 | `GET /val/match/v1/matches/{matchId}` | Primary documented match, player, round, damage, kill-event and economy evidence. |
| VAL-MATCH-V1 | `GET /val/match/v1/matchlists/by-puuid/{puuid}` | Discover an opted-in player's match IDs, start times and queues before fetching full matches. |
| VAL-MATCH-V1 | `GET /val/match/v1/recent-matches/by-queue/{queue}` | Returns recent match IDs for a queue. It is not a substitute for opt-in identity rules or complete history. |
| VAL-RANKED-V1 | `GET /val/ranked/v1/leaderboards/by-act/{actId}` | Official competitive leaderboard data; not needed for the friend-group performance score and must not be presented as this app's ranking source. |
| VAL-STATUS-V1 | `GET /val/status/v1/platform-data` | Platform maintenance and incident context; not a performance input. |

## Required boundary

```text
Official Riot API DTO
  -> server-side Riot client
  -> Riot adapter and validation
  -> normalized internal match model
  -> aggregation with evidence coverage
  -> derived metrics
  -> scoring engine
  -> React UI
```

The scoring engine must never import Riot DTOs. The current `DemoDataSource` and future `RiotDataSource` share `NormalizedAnalyticsDataset`; the latter is deliberately non-operational until official access and a secure backend exist.
