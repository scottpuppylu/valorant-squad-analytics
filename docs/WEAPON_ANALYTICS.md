# Member weapon analytics (TASK-WEAPON-01)

Versions: **`weapon-analytics-v1`** (metrics, calibration, contract) and **`weapon-catalog-v1`**
(classification). SDD STRICT, 2026-10-06. Starting HEAD `e0ca2db83befa0984a92bad736013e77ba239a9f`;
checkpoint `checkpoint-before-weapon-01`.

It answers 「這個人平常用什麼槍、哪些槍殺人最多、使用習慣如何，在不同 Act / Map / Agent / 範圍有什麼差異？」.
It is descriptive and contextual only.
- No score, Progress, Synergy or rank input.
- `community-score-v2`, `community-benchmarks-v1`, `overall-profile-v1`, `duo-synergy-v1`,
  `improvement-index-v1`, `adaptive-window-v1` and `feature-scope-policy-v2` are unchanged.
- The feature registry was not modified; CURRENT reuses the existing currentStrength policy.

## Evidence audit

| Source | Fields | Production reality |
|---|---|---|
| `round_participants` | `weapon_evidence_status`, `weapon_id`, `weapon_name`; `loadout_*`; `stats_evidence_status`, `score`; `present` | Henrik v4 `rounds[].stats[].economy.weapon` (round economy snapshot). Field audit: 619/620 observed. |
| `kill_events` | `weapon_id`, `weapon_name` (no status column: labeled = id or name present), killer/victim participant, round | Henrik v4 `kills[].weapon`. Names occasionally null with an id present. |
| `rounds` | `winning_team` | Compared with the participant's `team_key` |

**Not present in durable evidence:**
- Per-kill headshot, bodyshot or legshot.
- Per-kill or per-weapon damage.
- Shots fired or hit.
- A persisted attacking or defending side.

Match-level `headshots`, `damage` and similar fields cannot be attributed to weapons.

## Two evidence domains (never merged)

- **觀測武器回合:** the weapon the provider associates with the player for that round (economy
  snapshot). It does not mean every weapon touched in the round.
- **武器擊殺:** the weapon or method recorded for a kill event, counting only the killer's own
  events. Never the victim's weapon, and never inferred from the round snapshot.

A cross-domain ratio (`weaponKills / observedWeaponRounds`) is **not published**: pickups and
weapon swaps mean the snapshot and the kill weapon do not share semantics.

## Member aggregation, visibility and identity

```
eligible accounts (shared activePlayers: current-policy consent, active membership, not anonymized, non-archived member)
  → account participations → member public id → scope/context filters → aggregation
```

- Accounts are merged at evidence grain, so a member's result is the union of their accounts'
  evidence. Scores are never averaged per account (tested).
- A revoked or deleted account disappears from usage, kills and every breakdown. Nothing durable is
  mutated; deletion already scrubs weapon fields.
- A same-match member collision withholds the whole match, as the dataset projection does.
- The optional `accounts[]` breakdown (public account id plus round and kill counts) is explanatory
  only.

## Canonical weapon identity (weapon-catalog-v1)

**Raw group:**
- A usable provider weapon id (a short opaque token) is the group.
- Otherwise the normalized name (NFC, trimmed, collapsed spaces, lower case).
- A name-only value joins the single id group carrying that name; otherwise it is its own group.

**Representative name:** the smallest non-null name (`COLLATE "C"`, mirrored in TypeScript).

**Public key:** the catalog slug (for example `vandal`) when unique, else an opaque `x-<hash>`.
Provider ids are never echoed.

**Catalog categories** classify observed evidence only:

| Category | Weapons |
|---|---|
| Sidearm | Classic, Shorty, Frenzy, Ghost, Sheriff, Bandit |
| SMG | Stinger, Spectre |
| Shotgun | Bucky, Judge |
| Rifle | Bulldog, Guardian, Phantom, Vandal |
| Sniper | Marshal, Outlaw, Operator |
| MachineGun | Ares, Odin |
| Melee | Melee, Knife |
| Other | Anything else: abilities and unknown methods. Kept visible, never renamed to a known weapon |

`isFirearm` is true for the six gun categories. An unnamed id shows as 未知武器.

## Metrics (per member, per weapon, per scope/context)

| Metric | Definition |
|---|---|
| `observedWeaponRounds` | present rounds with `weapon_evidence_status='observed'` and a usable identity |
| `observedWeaponRoundShare` | weapon rounds ÷ all observed-weapon rounds of the member |
| `matchesWithWeaponObservation` | distinct matches with ≥ 1 such round |
| `roundWins/LossesWhenWeaponObserved`, `roundWinRateWhenObserved` | decided rounds only (`winning_team` present); correlation, not causation (觀測該武器回合勝率) |
| `avgRoundScoreWhenObserved` | mean round score over rounds with observed stats only |
| `avgLoadoutValueWhenObserved` | mean loadout over rounds with observed loadout only |
| `weaponKills` | the member's kill events labeled with the weapon |
| `weaponKillShare` | weapon kills ÷ all weapon-labeled kills of the member |
| `matchesWithWeaponKill` | distinct matches with ≥ 1 such kill |
| `weaponKillsPer100PlayedRounds` | weapon kills ÷ rounds the member was present in the scope × 100. Measures contribution/frequency, not efficiency. Rounds are deduplicated by member + match + round |

- Missing evidence is never zero usage, and a missing kill label is never a zero kill.
- A metric with an empty denominator is absent, never NaN.

**Unsupported (returned explicitly in `unsupported` with reasons):**
- `weaponHeadshotPercentage`, `weaponADR`, `weaponDamage`, `weaponAccuracy`, `attackDefenseSplit`;
- `weaponKillsPerObservedWeaponRound`.

## Coverage

| Field | Contents |
|---|---|
| `roundWeapon` | `observed`, `eligible` (present rounds), `coverage`, `status` |
| `killWeapon` | `weaponLabeledKills`, `eligibleKillEvents`, `coverage`, `status` |
| `loadout` | `observed`, `eligible`, `coverage`, `status` |
| `lifetimeComplete` | always `false` |

Status: `available` at coverage ≥ 0.9; `partial` when coverage is above 0 but lower; `unavailable`
when nothing is observed.

## Calibration (product design, not population percentiles)

| Constant | Value |
|---|---|
| 最常使用 | weapon ≥ 20 observed rounds AND member ≥ 50 observed-weapon rounds |
| 最多擊殺 | weapon ≥ 10 kills AND member ≥ 30 weapon-labeled kills |
| Weapon row `available` | ≥ 10 observed rounds or ≥ 5 kills (otherwise `partial` / `small_sample`) |
| Map/agent/Act breakdown row `available` | ≥ 24 played rounds |
| Coverage `available` | ≥ 0.9 |

There is no "最強武器": usage is not skill and kills are not efficiency.

## Scopes and filters

| Scope | Population |
|---|---|
| **ALL TRACKED** (全部已追蹤) | All eligible durable evidence. Never the newest-300 snapshot and never the 2000-match phase-2 cap |
| **ACT** | All eligible evidence whose recognized season normalizes to the Act key. Unknown seasons are never guessed; an unobserved Act is `unavailable` / `act_not_observed` with no fallback |
| **CURRENT** | The server's own `currentStrength` adaptive selection (same context; unchanged policy), then the same aggregation over exactly those member/match pairs. Older matches outside the window cannot change it (tested) |

- Context filters: member, map, agent, mode. The mode is **Competitive by default**; `all` or
  another explicit mode can be selected.
- Clients choose only semantic scope and context, never counts, thresholds or limits.

## Server API and SQL

`GET /api/valorant/dataset?view=analysis&feature=weaponAnalytics&player=<member>&scope=all|current|act[&act=][&map=][&agent=][&mode=]`
runs on the same function (still 12).
- `parseWeaponRequest` rejects `recent`, `from`, `to`, `role`, `form`, `limit` and `size`.

**Statements:** 4, in 2 round trips, plus the reused currentStrength analysis for CURRENT.
1. Distinct `(queue, season)` values, so mode and Act are resolved with the shared JS normalizers.
2. The visible members.
3. One round statement: a shared materialized `rr` CTE with `GROUPING SETS` over total, map,
   agent, Act and account, covering both coverage and per-weapon usage.
4. One kill statement with the same grouping sets.

Response size is proportional to members × weapons × breakdown values, independent of history
length (measured flat at about 65 KB from 1,000 to 10,000 matches in the benchmark).

The SQL path and the facts path (`aggregateWeaponFacts`, used by Demo and tests) produce
**identical** results on the same fixture (tested).

## Performance (local PGlite, single-threaded; 9 members, 2 seats × 20 rounds × 4 kills per match)

| Matches | round participants | ALL TRACKED | ACT | CURRENT | bytes (all) |
|---:|---:|---:|---:|---:|---:|
| 100 | 4,000 | 120 ms | 57 ms | 108 ms | 63.7 KB |
| 300 | 12,000 | 331 ms | 154 ms | 94 ms | 64.6 KB |
| 1,000 | 40,000 | 1.6 s | 0.74 s | 0.21 s | 64.6 KB |
| 5,000 | 200,000 | 5.4 s | 2.6 s | 0.88 s | 66.0 KB |
| 10,000 | 400,000 | 11.7 s | 5.7 s | 1.95 s | 65.3 KB |

The weapon statement count is fixed at 4. CURRENT also runs the existing currentStrength analysis.

**Index decision: no migration.** `EXPLAIN ANALYZE` at 5k shows index scans everywhere:
- `match_participants_player_idx`;
- `rounds (source_match_id, round_number)`;
- `round_participants (round_id, match_participant_id)`;
- `kill_events (source_match_id, …)` through the `source_match_id` join.

The cost is per-row aggregation over all eligible evidence (inherent to cache-free all-tracked
aggregation), not a missing index. Merging the coverage and usage statements cut ALL TRACKED by
about 26–30% (10k: 15.9 → 11.7 s).

Production at about 190 matches sits in the 100–300 band. A persisted aggregate cache was
deliberately not added; it would retain revoked evidence and needs separate authorization.

## UI

**武器分析 page (`#/weapons`):**
- Filters: member (community names, nickname secondary), scope, Act, map, agent, mode.
- Summary: 最常使用, 最多擊殺, 證據覆蓋率.
- Weapon table: 武器, 類別, 觀測武器回合, 使用占比, 武器擊殺, 擊殺占比, 每100回合武器擊殺,
  觀測該武器回合勝率, 證據.
- Selected-weapon detail: map, agent and Act breakdowns, account sources, and a member cohort
  comparison. The cohort comparison is descriptive, not a ranking.
- A 「數據怎麼算？」 explanation.

**Profile:** a compact 武器 card (all tracked, Competitive) showing 最常使用, 最多擊殺, the top 5
weapons and coverage, with a link to the full page.

**Loading behaviour:**
- REAL always uses the server and shows an explicit error instead of any fallback.
- The per-tab cache is cleared on every snapshot reload, so new FASTSYNC matches refetch.
- REAL without a loader never fabricates local data.

**Demo:** deterministic fictional facts. The two-account NovaHex member has a Vandal-heavy main
account and an Operator-heavy alt, merged in every view. Pages makes 0 `/api` calls.

## Production acceptance (2026-10-06, read-only, 0 provider calls)

- **Deploy:** commits `c4ce7cc` (engine), `c214636` (server), `16dfeec` (UI) and `693999a` (tests).
  CI, Pages and Vercel passed.
- **Requests:** 27 (9 members × ALL TRACKED, CURRENT and Act e11a5). All 200 and contract-valid;
  0 leak patterns; 0 NaN or Infinity. Largest response 196 KB; slowest 5.5 s client-observed
  (CURRENT includes the currentStrength analysis).
- **Evidence status:** all 9 members `available` in all three scopes.
  - Round-weapon coverage: 99.4–100%.
  - Kill-weapon coverage: 98.6–99.7%, consistent with the audit's occasional unlabeled or unnamed
    kill weapons.
  - Every observed Act is e11a5. Three members also have `unknown`-season evidence, shown as
    未知 Act and never guessed.
- **Observed categories:** Rifle, Sniper, Sidearm, SMG, Shotgun, MachineGun and Other.
  - Other includes ability kill methods (Blade Storm, Hot Hands, Paint Shells), 未知武器 (ids
    without names) and **Warden**.
  - Warden is not in `weapon-catalog-v1`, so it is honestly classified Other / Unknown rather than
    guessed. Adding it would be a catalog version bump.
- **Consistency:** each member's eligible kill events versus Competitive snapshot kills differ by
  0–6. The weapon domain counts every present participation; the snapshot counts only projectable
  performances. This is reconciled through coverage, not forced to equality.
- **UI:** the weapon page works for all 9 members, with map, agent and Act breakdowns and the
  cohort table, no NaN and no console errors.
  - At 375 px there is no horizontal page overflow; tables scroll inside their containers.
  - The Profile 武器 card works. `/sync/start` was stubbed during acceptance, so 0 real sync
    requests were made.
  - Community names are preserved.
- **Regression:** all 191 matches are byte-identical. Numeric parity holds for lifetime,
  currentStrength, recent10, recent30, Act, recentForm, Progress, maps, agents and Synergy.
  Server-vs-local `view=analysis` parity reports 28/28 checks true.

## Known limitations

- There is no per-weapon HS%, ADR, damage, accuracy or attack/defense split: the evidence does not
  exist durably.
- Matches with exactly one account of the member are fine. Future same-member collisions are
  withheld, not split.
- ALL TRACKED latency grows linearly with evidence volume. Precomputed aggregates would be a future
  task, consistent with DATA-03B.2C.
- The catalog covers standard weapons known at v1. New weapons stay Other / Unknown until the
  catalog is versioned.
