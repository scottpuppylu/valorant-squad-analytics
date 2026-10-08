# Agent catalog — TASK-DATA-AGENT-CATALOG-01

**STATUS: COMPLETE / AWAITING SDD REVIEW (2026-10-08).** `agent-catalog-v1`.

| Item | Value |
|---|---|
| Source of truth | `src/utils/agentRoles.ts` (the existing catalog, upgraded; no second catalog) |
| AGENT_CATALOG_COMPLETE (Competitive, tracked members) | **YES**: 841 / 841 rows |
| AGENT_CATALOG_COMPLETE (all modes) | **NO**: one unresolved identity (below) |

Everything was done locally and offline: 0 provider requests, no Riot API request, no Neon, nothing published, raw staging
unchanged.

## Why

- During the event-metrics-v2 rollout, `Miks` (109 tracked member-matches) was missing from the name-keyed map.
- Rounds on an unmapped agent carry no role. That pushed 滑板車 (25 of 73 Competitive matches) below the 70 % component
  gate for Firepower and Community Score.
- A name-only lookup could also fail silently when the provider renames an agent or sends a placeholder name.

## Stable-ID-first design

```ts
interface AgentDefinition { canonicalId; displayName; role; aliases; source }   // role ∈ Duelist | Initiator | Controller | Sentinel
resolveAgent({ id, name }) → known (matchedBy id | name) | unknown (unknown_id | unknown_name | missing_identity)
```

- **Identity.** It is the public agent content UUID the provider sends as `players[].agent.id`. Durable storage already
  keeps it (`match_participants.agent_id`). Every `canonicalId` in the catalog was observed 1 : 1 with its display name
  across all 838 locally stored documents; there is no conflicting pair.
- **Resolution order.** A known id wins over any display name (stale, localized or provider "Unknown"). A present but
  unknown id is UNKNOWN even if its name collides with a catalog name. Without an id, the exact display name or alias
  decides.
- **Aliases.** Display names and aliases resolve exactly; none is defined beyond the display names today. The provider
  placeholder `Unknown` is never an alias.
- **Name-keyed consumers stay safe.**
  - The public dataset and the four SQL read paths (projection, phase-1 observations, facets, weapons) carry agent
    **names**; `agentRoles` keeps serving them.
  - They are exactly id-correct whenever the completeness guard passes. The guard fails on any unknown id **and** on any
    known id stored with a drifted name (`name_mismatch`).
  - Canonicalizing names by id inside each read path would be a broader change and was not needed for current data.
- **Frozen evidence.** `AGENT_ROLES_CATALOG_V0` is the pre-v1 map: 28 agents, no Miks. It is used **only** by
  shared-match-evidence-v1 (and `calculatePlayerScores(…, { roles })`), so the accepted shared-match ratings stay
  exact. Never extend it.

## Miks resolution

| Field | Value |
|---|---|
| canonicalId | `7c8a4701-4de6-9355-b254-e09bc2a34b72` |
| displayName | Miks |
| role | **Controller** |
| source | Riot official VALORANT agent page (playvalorant.com, agents/miks), supplied by SDD on 2026-10-08 (`source: 'riot-official'`) |
| guessed | **No.** The first pass stopped because local evidence carries no role field |

## Unknown handling

- **Unresolved identity:** `773f0c78-4486-752b-68ef-4585d7f4b848`.
  - The provider names it `Unknown`; it appears from 2026-09-23.
  - 29 tracked member-matches, **all non-Competitive**; 336 participant rows overall.
  - There is no catalog definition, name or role until an authoritative source exists.
- **Reason breakdown:** 29 / 29 rows have a stable id with an unresolved provider name (unsupported or new agent). There
  are 0 missing ids, 0 normalization defects and 0 malformed payloads.
- **Fail-closed behavior:**
  - Unknown agents never get a role.
  - Role-dependent components omit their rounds ("Unknown selected agent role").
  - Role-free statistics (kills, deaths, assists, ACS, ADR, HS %) still count them.
- **Removed fallback.**
  - `primaryRoleForAgents` returned **Controller** when no played agent had a known role. It now returns `undefined`.
  - `Player.role` is optional and the UI shows 未知角色.
  - In scoring, when no role is known, there is no dominant role, Role Value has no components, and traces use a
    role-free `unknown_role` benchmark placeholder. No value is computed. No member in real data has zero known roles,
    so no real result changed through this path.

## Completeness guard

| Entry point | Scope |
|---|---|
| `validateAgentCatalog(rows)` | Pure, deterministic, input-order independent. Returns `complete`, known / unknown / missing / name-mismatch rows, coverage and every unresolved identity |
| `checkAgentCatalog(executor)` (`server/dataset/agentCatalogCheck.ts`) | The same guard over linked participants of the durable store (one read-only statement). For future sync and data validation |
| `npm run agents:check [-- --strict]` | Private staging check; `--strict` exits 2 when incomplete |

Current result:

| Population | Rows | Known | Unknown | Missing | Name drift | Coverage |
|---|---|---|---|---|---|---|
| Tracked, all modes | 1 717 | 1 688 | 29 | 0 | 0 | 98.31 % |
| Tracked, Competitive | 841 | 841 | 0 | 0 | 0 | **100 %** |
| All participants | 8 375 | 8 039 | 336 | 0 | 0 | 95.99 % |

## New-agent procedure

1. `npm run agents:check` (or `checkAgentCatalog` in a validation job) reports a new `unknown_id`.
2. Confirm the official name and role from an **authoritative source** (Riot's official agent page or patch notes).
   Never infer it from gameplay statistics or ability names.
3. Add one `define(name, id, role, 'riot-official')` line. Bump the catalog version only if an existing classification
   changes. Never touch `AGENT_ROLES_CATALOG_V0`.
4. Re-run `agents:check`, the focused tests and the full suite.

## Analytics impact (real data, offline; canonical event-metrics-v2; unchanged formulas and gates)

**滑板車:**

| Item | Before | After |
|---|---|---|
| Competitive matches | 73 | 73 |
| Unknown-role matches | 25 | **0** |
| Firepower | unavailable (component evidence < 70 %) | **available** |
| Community Score | unavailable | **available** (status partial; all 8 dimensions present) |
| Current Strength | available (partial) | available (partial) |
| Recent Form | insufficient | **up** |

**Group coverage (9 members):**

| Analytic | Before | After | Still blocked |
|---|---|---|---|
| Community Score | 5 / 9 | **6 / 9** | jack, 加分, 滑鏟: Round Impact + Clutch unavailable (undecidable alive counts; not catalog) |
| Current Strength | 6 / 9 | **7 / 9** (加分 restored) | jack, 滑鏟: same Overall gate |
| Recent Form | 2 / 9 | **4 / 9** | 5 members: Overall not numeric in the recent or baseline window |
| Progress | 8 / 9 | **9 / 9** | — (most values still saturate; trend context only) |
| Role Value (role-aware) | 8 / 9 | **9 / 9** | — |

**Regressions:**
- **Shared-Match v1:** reproduces exactly (jack 80.9, 走路 78.0, 魔王 72.0, 滑鏟 55.6, 天堂 42.3, 加分 40.5, 夏天 38.2,
  滑板車 25.8, 小麻花 25.5).
  - Control: without the v0 pin, 190 Miks pair-sides would gain Firepower and every rating would move (for example
    jack 82.0, 天堂 45.2, 滑板車 24.2). That is why the pin exists; a catalog-v1 shared-match evidence version is a future
    SDD decision.
- **Basic stats:** 0 differences.
- **event-metrics-v2:** semantic diff 0 unexpected / unknown; facts fingerprints unchanged (catalog-independent).
- **Rank:** evidence unchanged (1 991 rows), 0 future leaks.
- **Provider requests:** still 689.

## Team Composition readiness (TASK-ANALYTICS-TEAM-COMPOSITION-01)

Competitive evidence, 9 members, 12 maps.

| Input | Status | Evidence |
|---|---|---|
| MEMBER_STRENGTH | READY | shared-match-rating-v1 (group primary) |
| MAP_PERFORMANCE | READY | member × map 77 cells; 65 with ≥ 5 matches, 49 with ≥ 10; win rate in map summaries |
| AGENT_PERFORMANCE | READY | member × agent 115 cells; 48 with ≥ 5, 28 with ≥ 10 |
| ROLE_PERFORMANCE | READY | member × role 36 / 36 cells (every member has all 4 roles); 31 with ≥ 5, 29 with ≥ 10; 0 unknown-role Competitive rows |
| AGENT_MAP_SAMPLE | PARTIAL | member × agent × map 350 cells; only 48 with ≥ 5 and 9 with ≥ 10 → needs shrinkage toward role / map evidence and disclosed confidence |
| ROLE × MAP | PARTIAL | 220 cells; 62 with ≥ 5, 17 with ≥ 10 |
| PAIR_SYNERGY | READY | duo-synergy-v1 + shared-match units for 36 / 36 pairs |
| MAP_SYNERGY | PARTIAL | pair × map 242 cells; 91 with ≥ 5, 2 with ≥ 10 |
| Agent- / role-scoped synergy | NOT_AVAILABLE / NOT_REQUIRED_FOR_V1 | synergy filters are date / map / mode / Act only |
| ROLE_COVERAGE | READY | catalog complete for Competitive |
| SHARED_MATCH | READY | — |
| RANK_CONTEXT | READY | context only, never a weight |
| RECENT_FORM | PARTIAL | 4 / 9 |
| POSITION_DATA | NOT_REQUIRED_FOR_V1 | blocked for position claims; see below |

**TEAM_COMPOSITION_V1_READY = YES**, within this boundary:
- **May recommend:** for 5 selected members on a selected map, agent and role assignment, responsibilities (Primary
  Entry, Second Entry, Info / setup, Smoke / space control, Anchor, Lurk, Trade / support), Team Fit and confidence.
- **Evidence it rests on:** member × role and member × map / agent evidence, with explicit shrinkage and confidence for
  thin agent × map and pair × map cells.
- **Must not claim historical evidence for:** exact site, coordinates, anchor location or attack route.

The unresolved `773f0c78-…` agent affects no Competitive row, so it does not block v1.

## Position data — formal blocker

**POSITION_NORMALIZATION_REQUIRED_FOR_POSITION_RECOMMENDATIONS = YES.** Next task: **TASK-DATA-POSITION-NORMALIZATION-01.**

**Accepted audit evidence (raw staging):**
- kill coordinates on 100 % of 117 005 kills;
- player location and view angle at about 96 % of kill moments;
- plant site on 7 532 plant rounds;
- round side derivable (`winning_team_role`).

**What is missing:**
- Durable `event_player_locations` is **empty**: the normalizer reads `puuid` / `x` / `y` at the item level, but the raw
  shape is `{ player: { puuid }, location: { x, y }, view_radians }`.
- Plant site and round side are not normalized.

| Item | Value |
|---|---|
| POSITION_DATA_RAW_AVAILABLE | YES |
| POSITION_DATA_CANONICAL_READY | NO |
| POSITION_RECOMMENDATION_READY | NO |
