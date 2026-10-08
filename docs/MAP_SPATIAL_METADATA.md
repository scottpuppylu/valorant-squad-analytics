# Map spatial metadata — TASK-DATA-MAP-ZONE-METADATA-01

**STATUS: STOPPED FOR SDD REVIEW (2026-10-08). PRIMARY OUTCOME_D.**

> **SDD decision (2026-10-08, TASK-ANALYTICS-TEAM-COMPOSITION-02):** option 1 accepted.
>
> | Decision | Value |
> |---|---|
> | PROVIDER_SITE_LEVEL_REFINEMENT_AUTHORIZED | **YES** (site letters A / B / C only; implemented as `site-reference-v1`, see [TEAM_COMPOSITION_V2.md](TEAM_COMPOSITION_V2.md)) |
> | MAP_TRANSFORM_REQUIRED_FOR_CALLOUT_LEVEL | **YES** (callouts, sub-regions, exact positions and map-image plots stay blocked until a transform source with acceptable provenance exists) |
>
> **Provenance correction.** Henrik match documents are **PROVIDER_OBSERVED_MATCH_EVIDENCE**, not
> RIOT_DERIVED_STATIC_CONTENT. The Sources table below is corrected accordingly.

The only source of a world→map transform and callouts (valorant-api.com) is unofficial, carries "All Rights Reserved"
with no license or terms, and is extracted from Riot game files. It is not vendored, downloaded or used at runtime.

A license-free, quantitatively validated alternative exists from the provider's own evidence (plant-site labels in raw
coordinates). It is recorded below for an SDD decision; nothing was implemented.

| Safety item | Value |
|---|---|
| Code changes | None |
| Provider / Riot gameplay requests | 0 |
| Public static metadata | Read only (no download, no vendoring) |
| Raw staging | Unchanged |
| RAW_COORDINATES_PUBLICLY_EXPORTED | NO |

## Repository audit

There was no existing map metadata of any kind:
- no minimap, transform multipliers or scalars;
- no callouts, region names, polygons or nav mesh.

Grep matches were unrelated (a radar-chart polygon, CSS, the Riot DTO `mapId` field).

Durable storage keeps `source_matches.map_id` and `map_name` from the provider.
`docs/RIOT_API_CAPABILITY.md` records that Riot's official VAL-CONTENT-V1 resolves map identifiers only and requires an
API key.

## Sources

| Source | Owner | URL | Fields | License / usage | Checked | Level | Decision |
|---|---|---|---|---|---|---|---|
| Henrik v4 match documents (stored privately) | Riot data via HenrikDev | — | `metadata.map.{id,name}`, `rounds[].plant.{site,location}` | Already in the project's accepted data path | 2026-10-08 | PROVIDER_OBSERVED_MATCH_EVIDENCE | **Usable** |
| Riot VAL-CONTENT-V1 | Riot Games | developer.riotgames.com | Map id, name, asset path (no transform, no callouts) | Requires an API key | 2026-10-08 (repository doc) | RIOT_OFFICIAL | Not used (key required; no transform fields) |
| Valorant-API | Unnamed operator; "non-official … not endorsed by Riot Games" | valorant-api.com/v1/maps | `xMultiplier`, `yMultiplier`, `xScalarToAdd`, `yScalarToAdd`, `callouts[] { regionName, superRegionName, location {x,y,z}, scale3D, rotation }` | "© Copyright Valorant-API. All Rights Reserved"; no license, terms or redistribution grant found | 2026-10-08 | THIRD_PARTY_DOCUMENTED (game-file extraction, unofficial) | **Not usable**: provenance and licensing unsuitable for vendoring or runtime |

**Read-only verification of the third-party data (Ascent only):**
- Map UUID `7eaecc1b-…3319` equals the provider map id.
- Transform fields: `7e-05` / `-7e-05` / `0.813895` / `0.573242`.
- 22 callouts, each a single **reference point**. `scale3D` and `rotation` are undocumented, and there are **no
  polygons**.

So a transform almost certainly exists technically. It is blocked by provenance, not by data.

LIVE_RUNTIME_DEPENDENCY = NO for every source.

## Map identity (provider evidence)

- 22 distinct map names map 1 : 1 to 22 provider map UUIDs. That covers the 13 standard maps plus Team Deathmatch and
  Skirmish maps.
- Display names never conflict with ids.
- A future identity layer should key by the provider map UUID and fail closed on unknown ids.

**Not implemented here** (stopped before zone work).

## Transform

| Item | Value |
|---|---|
| MAP_TRANSFORM_READY | **NO**: no transform source with acceptable provenance |
| COORDINATE_SYSTEM | Remains `PROVIDER_RAW_UNKNOWN` |
| Implementation | No transform implemented, no minimap coordinates, no plotting |

## Validated alternative: provider-labelled site references (raw space)

Plant coordinates with the provider's own site label (A / B / C) were grouped per map. Each site's centroid and spread
were computed, and each plant was checked against its nearest centroid. No external data and no transform are needed.
An affine transform would not change these relations.

| Map | Site points (A / B / C) | Nearest-centroid agreement | Spread p95 (raw units) | Min centroid gap | Validation |
|---|---|---|---|---|---|
| Abyss | 335 / 339 / — | 100 % | 1 085 / 1 095 | 9 911 | PASS |
| Ascent | 464 / 336 / — | 100 % | 899 / 996 | 8 824 | PASS |
| Bind | 78 / 68 / — | 100 % | 964 / 541 | 7 074 | PASS (small sample) |
| Breeze | 215 / 184 / — | 100 % | 1 141 / 568 | 11 071 | PASS |
| Corrode | 93 / 94 / — | 100 % | 856 / 590 | 7 897 | PASS |
| Fracture | 193 / 151 / — | 100 % | 1 053 / 1 128 | 9 807 | PASS |
| Haven | 379 / 142 / 343 | 100 % | 897 / 771 / 552 | 4 301 | PASS |
| Icebox | 188 / 121 / — | 100 % | 1 027 / 839 | 8 779 | PASS |
| Lotus | 381 / 187 / 315 | 100 % | 676 / 1 018 / 864 | 4 919 | PASS |
| Pearl | 219 / 167 / — | 100 % | 1 008 / 880 | 8 727 | PASS |
| Split | 391 / 392 / — | 100 % | 802 / 1 248 | 9 499 | PASS |
| Summit | 508 / 385 / — | 100 % | 795 / 942 | 10 282 | PASS |
| Sunset | 340 / 524 / — | 100 % | 904 / 725 | 8 530 | PASS |

Across all 7 532 labelled plants, agreement is 100 %. The p95 spread is 3.4–11× smaller than the closest gap between
two sites on the same map.

**What this supports.** A coarse, evidence-derived **site-proximity** context in raw provider space: distance from an
event snapshot to each provider-labelled plant-site reference. This is not a named callout or a polygon, and it is not
map-image space. It is LEVEL_2-equivalent context built from first-party evidence, labelled
`PROVIDER_SITE_REFERENCE`, never `AUTHORITATIVE_ZONE`.

The references would be computed from private evidence (aggregates only) and never committed or exported.

## Capability levels

| Level | Meaning | Status |
|---|---|---|
| LEVEL_0 | Raw provider x/y | **Reached** (position-evidence-v1) |
| LEVEL_1 | Validated normalized map coordinate | Blocked by provenance |
| LEVEL_2 | Nearest reference / coarse region context | Only via provider-labelled site references (validated above; not implemented). Third-party callout points not usable |
| LEVEL_3 | Validated zone polygons | Not available anywhere; would have to be invented, so not done |
| LEVEL_4 | Paths / routes | Not available (event-time snapshots only) |

CAPABILITY_LEVEL (implemented) = **LEVEL_2 at site granularity only** (`site-reference-v1`, private, raw space; SDD-authorized
2026-10-08). Named sub-regions within LEVEL_2, and LEVEL_1 / 3 / 4, remain blocked.

## Spatial readiness

[Updated 2026-10-08 by TASK-ANALYTICS-TEAM-COMPOSITION-02: site-reference-v1 and side-evidence-v1 implemented. Site
classification validated (P95 accuracy 0.948, 0 wrong-site, 0 ambiguous). Member-level site TENDENCIES did not
reproduce in the chronological holdout and are withheld. See [TEAM_COMPOSITION_V2.md](TEAM_COMPOSITION_V2.md).]

| Feature | Status | Reason |
|---|---|---|
| DEFENSE_SITE_AFFINITY | PARTIAL | Side (86.7 % Competitive) plus site proximity to provider-labelled references; no named sub-regions |
| ATTACK_FIRST_CONTACT_REGION | PARTIAL | First-kill snapshot can be expressed as nearer-A / B / C or "between sites"; no callout names |
| POST_PLANT_REGION | READY (site level) | The plant site is a provider label, plus post-plant snapshots and side |
| ANCHOR_TENDENCY | PARTIAL | Defensive event-time snapshots near a site reference; biased to fight moments |
| TRADE_PROXIMITY_REGION | PARTIAL | Teammate distances at kill moments; the victim position is only inferred (`kill.location`) |
| TEAM_SPACING_REGION | PARTIAL | Event-time spacing in raw units; region naming unavailable |
| ENTRY_PATH / LURK_PATH / ROTATION_PATH | NOT_READY | No continuous movement |

**Exact position claims** ("should stand at A Heaven") are **not authorized**: there are no callout names or polygons
with acceptable provenance. At most, wording like "often appears near A-site event snapshots" is possible, and only with
the provider-site-reference feature.

## Team Composition V2 gate

| Item | Value |
|---|---|
| POSITION_TRANSFORM_READY | NO |
| ATTACK_DEFENSE_READY | YES |
| SITE_LABEL_READY | YES |
| SPATIAL_REFINEMENT_READY | PARTIAL (provider site references validated; not implemented) |
| **TEAM_COMPOSITION_V2_READY** | **NO**, by the gate definition (it requires POSITION_TRANSFORM_READY = YES) [SUPERSEDED 2026-10-08: SDD redefined the gate to accept provider site references; team-composition-v2 implemented as OUTCOME_B] |

**Options for SDD:**
1. **Accept provider-site references as the transform-free spatial basis.** Redefine the V2 gate to accept them for side
   and site-level refinements only (no callouts, no exact positions).
2. **Obtain a licensed or official transform source** (for example, explicit permission from Valorant-API or an official
   Riot content source with transform fields).
3. **Skip spatial V2** and proceed to the local release checkpoint with side-aware evidence only.

## Privacy

Map metadata itself could be public. Player positions stay private, the public allowlist is unchanged, and the site
references would be computed from private evidence and never exported.
