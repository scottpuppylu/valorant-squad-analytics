# Position evidence — TASK-DATA-POSITION-NORMALIZATION-01

**STATUS: COMPLETE / AWAITING SDD REVIEW (2026-10-08).** `position-evidence-v1` (migration 0012).

| Item | Value |
|---|---|
| Scope | Private derived evidence only |
| RAW_COORDINATES_PUBLICLY_EXPORTED | **NO** |
| CONTINUOUS_MOVEMENT_AVAILABLE | **NO**: snapshots exist only at discrete events |
| Safety | Everything local and offline: 0 provider requests, raw staging unchanged, no Neon, nothing published or pushed |

## Raw source contract (observed in all 838 staged Henrik v4 documents)

| Field | Shape | Present |
|---|---|---|
| Kill event location | `kills[].location { x, y }` | 117 005 / 117 005 kills |
| Player snapshots at a kill | `kills[].player_locations[] { player: { puuid, name, tag, team }, location: { x, y }, view_radians }` | 112 755 kills (96.4 %); 722 049 items, **0 flat**, 0 duplicate players per event |
| Victim in snapshots | — | **never** (0) |
| Killer in snapshots | — | 111 996 of 112 755 |
| View direction | `player_locations[].view_radians` | 100 % of snapshots; range 0 … 6.283 (radians, 0–2π) |
| Plant | `rounds[].plant { site, location { x, y }, player, round_time_in_ms, player_locations[] }` | 7 532 plants; site A 3 784 / B 3 090 / C 658; coordinates 100 % |
| Defuse | `rounds[].defuse { location { x, y }, player, round_time_in_ms, player_locations[] }` | 2 103; coordinates 100 % |
| Round side | `rounds[].winning_team_role` | Attacker 4 164, Defender 4 316, null 5 190, None 344, FreeForAll 38 |
| Winning team | `rounds[].winning_team` | `Red` / `Blue` (per-player team ids in Deathmatch) |
| Event time | `kills[].time_in_round_in_ms`, `time_in_match_in_ms` | present |

**Field status:**
- RAW_FIELD_PRESENT: all fields above.
- RAW_FIELD_OPTIONAL: snapshots (missing on 3.6 % of kills), `winning_team_role`.
- RAW_FIELD_MISSING: continuous positions, killer location as its own field, map geometry and zone names.
- Plant and defuse `player_locations` exist in raw data but are **not** normalized in v1.

**Cross-check of side semantics:**
- The planter's team is always the attacker: 3 232 planter-won rounds have role Attacker, and 1 300 planter-lost
  rounds have role Defender.
- The defuser's team is always the defender: 1 287 rounds.
- There are 0 contradictions.

## The defect and the fix

- **Defect.** The normalizer read `player_locations[]` as a flat `{ puuid, x, y }`, which the provider never sends. So
  `event_player_locations` was always empty.
- **Why it went unnoticed.** The foundation test fixture used the same invented flat shape; it now mirrors the real
  shape.
- **Fix.**
  - Identity is read from `player.puuid` and position from `location.{x, y}`; `view_radians` is kept.
  - Rows without identity or finite coordinates are dropped.
  - The first snapshot per player per event wins.
  - A snapshot never creates a participant, and a reference outside the roster is dropped (0 in real data).

## Evidence types (never collapsed into one "position")

| Type | Storage |
|---|---|
| KILL_EVENT_LOCATION | `kill_events.location_x/y` (unchanged). Never equals any snapshot and sits a median 1 703 units from the killer: consistent with the victim's position, but **not documented** by the provider |
| PLAYER_SNAPSHOT_LOCATION | `event_player_locations (kill_event_id, match_participant_id, location_x/y)` |
| VIEW_DIRECTION | `event_player_locations.view_radians` (new) |
| PLANT_EVENT_LOCATION | `rounds.plant_location_x/y` (new) |
| PLANT_SITE | `rounds.plant_site` (new): provider label as given; **never inferred from coordinates** |
| DEFUSE_EVENT_LOCATION | `rounds.defuse_location_x/y` (new) |
| ROUND_SIDE | `rounds.winning_team_role` (as given), plus `attacking_team_key` and `side_source` (new) |

**Version stamp.** `source_matches.position_evidence_version` records the version (NULL = written before the fix). It
is deliberately separate from `durable-evidence-v2`:
- no metric input changed;
- the analysis-facts engine key and every score stay identical;
- the facts fingerprints are unchanged (`6e3526ee…` v1, `e01dc08f…` v2).

## Round side derivation

`attacking_team_key` comes only from explicit per-round evidence, in priority order:
1. `winning_team_role` (Attacker means the winner attacks; Defender means the other team attacks);
2. the planter's team;
3. the defuser's team (the other team attacks).

Rules:
- It requires exactly two teams.
- All available sources must agree; any conflict leaves the side unknown (0 conflicts in real data).
- It is **never** derived from the winner alone or from half / overtime rules.
- A member's side is ATTACK when their team key equals `attacking_team_key`, DEFENSE otherwise.

## Coordinate semantics

| Item | Value |
|---|---|
| COORDINATE_SYSTEM | `PROVIDER_RAW_UNKNOWN` (undocumented) |
| Observed range (snapshots) | x −51 123 … 15 241 (p01 −6 916, p99 11 921); y −13 536 … 12 557 (p01 −10 754, p99 10 691). Consistent with game-world units, not verified |
| UNIT / ORIGIN / AXIS_DIRECTION | Unknown (not documented) |
| Storage | Lossless; no bounds, no transform |
| Map images | No world→minimap transform exists in the repository; coordinates must **not** be plotted on map images |

Snapshots are event-time only: they are never interpolated into paths, routes or movement.

## Coverage (all values from `npm run position-evidence`)

| | Overall | Competitive | Unrated |
|---|---|---|---|
| Matches | 838 | 345 | 203 |
| Rounds | 14 052 | 7 298 | 3 977 |
| Kills (normalized) | 116 951 | 54 207 | 26 664 |
| Kills with coordinates | 116 951 (100 %) | 54 207 (100 %) | 26 664 (100 %) |
| Kill events with snapshots | 112 701 (96.4 %) | 54 064 (99.7 %) | 26 609 (99.8 %) |
| Snapshot rows | 721 914 | 310 834 | 152 262 |
| Snapshots with view direction | 100 % | 100 % | 100 % |
| Rounds with plant / with site / with coordinate | 7 532 / 7 532 / 7 532 | 4 751 / 4 751 / 4 751 | 2 136 / 2 136 / 2 136 |
| Defuses with coordinate | 2 103 | 1 346 | 595 |
| Rounds with side / unknown | 11 478 / 2 574 (81.7 %) | 6 325 / 973 (86.7 %) | 3 139 / 838 (78.9 %) |
| Side source: role / plant | 8 478 / 3 000 | 4 589 / 1 736 | 2 176 / 963 |

**Drops.**
- 54 raw kills were already dropped by the existing normalizer (missing killer, victim or time); their 135 snapshot
  items go with them.
- 0 Competitive snapshots are dropped.
- 26 kills appear out of time order in provider order; the order is preserved with timestamps.

### Member coverage (Competitive + Unrated)

| Member | Matches | Rounds | Snapshots | Attack / Defense snapshots | Plant rounds present |
|---|---|---|---|---|---|
| jack | 123 | 2 412 | 12 624 | 5 318 / 4 741 | 1 695 |
| 加分 | 176 | 3 384 | 17 005 | 8 186 / 8 182 | 2 365 |
| 夏天 | 107 | 1 967 | 9 186 | 4 259 / 4 243 | 1 433 |
| 天堂 | 149 | 2 558 | 11 643 | 5 202 / 5 296 | 1 799 |
| 小麻花 | 164 | 3 011 | 13 778 | 6 453 / 5 639 | 2 077 |
| 滑板車 | 129 | 2 382 | 10 311 | 4 810 / 4 324 | 1 644 |
| 滑鏟 | 194 | 3 435 | 16 457 | 7 112 / 7 048 | 2 456 |
| 走路 | 123 | 2 052 | 9 563 | 4 068 / 4 747 | 1 507 |
| 魔王 | 105 | 1 809 | 8 999 | 4 027 / 4 149 | 1 304 |

### Map coverage (Competitive + Unrated)

| Map | Matches | Rounds | Snapshots | Kill coordinates | Plant sites (A / B / C) | Side coverage |
|---|---|---|---|---|---|---|
| Ascent | 67 | 1 365 | 56 867 | 9 895 | 435 / 324 / — | 84.8 % |
| Split | 67 | 1 346 | 54 661 | 9 520 | 377 / 379 / — | 78.4 % |
| Lotus | 62 | 1 282 | 52 310 | 9 099 | 351 / 175 / 295 | 83.2 % |
| Haven | 60 | 1 216 | 50 720 | 8 837 | 339 / 133 / 317 | 83.9 % |
| Sunset | 60 | 1 254 | 52 857 | 9 270 | 319 / 491 / — | 89.9 % |
| Summit | 60 | 1 266 | 52 999 | 9 252 | 467 / 357 / — | 92.3 % |
| Abyss | 46 | 961 | 39 839 | 6 943 | 312 / 321 / — | 94.3 % |
| Breeze | 27 | 550 | 21 999 | 3 862 | 188 / 165 / — | 79.6 % |
| Pearl | 26 | 535 | 21 965 | 3 823 | 184 / 138 / — | 73.8 % |
| Fracture | 24 | 494 | 19 103 | 3 356 | 167 / 132 / — | 70.6 % |
| Icebox | 23 | 488 | 20 071 | 3 540 | 162 / 105 / — | 78.7 % |
| Corrode | 15 | 301 | 11 853 | 2 091 | 76 / 76 / — | 84.1 % |
| Bind | 11 | 217 | 7 852 | 1 383 | 50 / 52 / — | 65.9 % |

## Integrity, idempotency, rebuild

- **Integrity:** all stored x, y and view values are finite. Every snapshot references a roster player. Event order and
  timestamps are preserved.
- **Idempotency:**
  - Row identity is the source event (kill event + participant, round number), never the ingestion time.
  - Re-importing a match rewrites the same logical rows (tested).
  - The real-data rebuild ran twice: 852 917 canonical rows each, fingerprint `c94877ed7c87…` both times, about 5 s per
    pass.
- **Size:** about 136 MB of canonical text for the private dataset, linear per match. The offline tool holds all
  documents in memory (1.8 GB RSS); the production write path stays per match.
- **Production note.** Production stores normalized rows, not raw documents. Its existing matches keep empty snapshots
  until they are re-synced or rebuilt from raw evidence; only matches written after a future rollout get
  position-evidence-v1. Rollout is a separate SDD gate.

## Regressions (all exact)

| Check | Result |
|---|---|
| Basic stats | 0 differences |
| event-metrics v1 / v2 semantic diff | 0 unexpected / unknown |
| Analysis facts fingerprints | Unchanged |
| Shared-Match v1 | jack 80.9 … 小麻花 25.5 |
| Team Composition v1 | Demo output **byte-identical** to the accepted run |
| High-level coverage | Unchanged (6 / 7 / 4 / 9 of 9) |
| Rank | Unchanged, 0 future leaks |
| Provider requests | Still 689 |
| Raw payload hash | Unchanged |

## Privacy

- **Identity.** Player identity in position rows is the existing match-scoped participant HMAC (`match_participants`).
  Non-community players carry no cross-match identity, and no PUUID is stored.
- **Deletion.** Revocation and deletion remove a participant's snapshots (existing rule).
- **Export.** Nothing spatial is in `publicAllowlist`. The static export test proves no coordinate, view, site or side
  field leaves the database.
- **Future public features** should publish derived aggregates, never raw per-event coordinates, unless separately
  reviewed.

## Feature readiness (assessment only; nothing implemented)

| Feature | Status | Reason |
|---|---|---|
| SITE_AFFINITY | PARTIAL | Every plant has a provider site label, plus side and member presence, so post-plant / retake behavior by labelled site is measurable. "Around a site" outside plant rounds needs zone metadata. Member × map × site cells are thin |
| ATTACK_DEFENSE_ROLE | **READY** | Side known on 86.7 % of Competitive rounds from explicit evidence; 4 000–8 000 attack and defense snapshots per member |
| FIRST_CONTACT_AREA | PARTIAL | The first kill of a round has coordinates and snapshots; naming an area needs zone metadata (coordinates alone are unnamed) |
| ANCHOR_EVIDENCE | PARTIAL | Defensive snapshots exist, but only at kill moments (biased toward fights). Plant coordinates labelled by site could give empirical site anchors per map, but there are no zone polygons |
| ENTRY_PATH | NOT_READY | No continuous movement |
| LURK_EVIDENCE | NOT_READY | Needs paths and timing, not event snapshots |
| TRADE_PROXIMITY | PARTIAL | Killer-side teammates' positions exist at every kill. The victim position is only *consistent with* `kill.location` (undocumented) |
| TEAM_SPACING | READY (event-time only) | Up to 9 positions per kill moment in raw units; never continuous spacing |

- **MAP_ZONE_METADATA_REQUIRED = YES** for any named site, region or anchor-zone claim.
- **MAP_ZONE_METADATA_READY = NO.** The repository has no map geometry, region polygons or validated world→map
  transform, and none were invented.

## Team Composition V2 readiness

| Item | Value |
|---|---|
| POSITION_EVIDENCE_READY | YES (private, validated, idempotent) |
| SITE_EVIDENCE_READY | YES for provider plant-site labels; NO for zones |
| ATTACK_DEFENSE_READY | YES |
| MAP_ZONE_METADATA_READY | NO |
| **TEAM_COMPOSITION_V2_READY** | **NO** for site / position / zone recommendations |

The smallest next step is a map-zone metadata task (authoritative region definitions or a validated coordinate
mapping). A side-aware (attack / defense) responsibility refinement would already be feasible without zones; that is an
SDD scope decision.

**Unsupported claims (still):**
- player paths or routes;
- lurk or anchor labels from coordinates;
- named zones;
- causal or tactical conclusions from event snapshots.

## Reproduce

`npm run position-evidence` (private, read-only, sanitized).
