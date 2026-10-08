# Local release checkpoint — LOCAL-RELEASE-CHECKPOINT-01

**CURRENT STATUS: RELEASE_CHECKPOINT_READY = YES (attempt 2, 2026-10-08).** The local annotated tag
`checkpoint-local-release-pre-public-01` is created and NOT pushed. Nothing was pushed, deployed or published.

| Attempt | Head audited | Result |
|---|---|---|
| CHECKPOINT_ATTEMPT_1 | `b260fb9` (68 commits) | **BLOCKED**: revocation spatial residue (§5); third-party Neon skill flagged (§2). No tag |
| CHECKPOINT_ATTEMPT_2 | `d9d37ca` + this record (73 commits + 1) | **READY**: both blockers closed by TASK-RELEASE-BLOCKER-FIX-01; every gate re-run (§13) |

This document audits the whole post-origin development wave before any public rollout. It links to the task documents
rather than repeating them. Sections 1–12 are the **attempt-1 evidence**, kept as history; §13 records attempt 2.

## 1. Source baseline

| Item | Value |
|---|---|
| Branch | `main` |
| Remote source `main` (live `git ls-remote`) | `7a9934e9408cb77eab21d6f31572512c2294b730` = local `origin/main` = merge base |
| Remote data repository `main` (live `git ls-remote`) | `ff661e18606a093d0049ab529db5b46f1d4ab1c7` (unchanged) |
| Audited local head | `b260fb98e8fe59b819180feda0d3c8c497acc19a` (the checkpoint commit adds this document on top) |
| Commits ahead | **68** audited (+1 checkpoint commit), 0 behind |
| Worktree | Clean; no merge, rebase, cherry-pick, bisect or revert in progress; no stash |
| Delta | 210 files, +18 707 / −588 |

## 2. Commit inventory (deterministic, path-based)

Each commit is classified by the paths it touches; a commit can carry several classes. The full per-commit table is in
§12.

| Class | Commits touching | Impact | Commits touching |
|---|---|---|---|
| CODE | 26 | PUBLIC_RUNTIME (`src/`, Vite, package) | 24 |
| TEST | 33 | SERVER_RUNTIME (`server/`, `api/`) | 16 |
| DOCS | 26 | DATABASE_SCHEMA | 1 (`ff6c8e9`, migration 0012) |
| MIGRATION | 1 | STATIC_EXPORT | 3 |
| PRIVATE_MAINTAINER_TOOL | 13 | PRIVATE_OFFLINE_ONLY (scripts, infra, staging) | 29 |
| RESEARCH_TOOL | 9 | TEST_ONLY | 33 |
| CONFIG | 19 | DOCS_ONLY | 26 |
| OTHER | 1 | | |

Every commit maps to an accepted or awaiting-review task in the AGENTS.md status table:
- stored index;
- database portability, the VPS/Node runtime and the local runtime;
- the static snapshot, query parity and publication channel;
- the PG18 target;
- private rebuild collection;
- history coverage;
- rank evidence;
- shared-match v1 and v2;
- event reconstruction and event-metrics-v2;
- internal strength;
- the agent catalog;
- team composition V1 and V2;
- position evidence;
- map spatial metadata.

**Unexpected / flagged (1):** `31d0210` vendors the third-party Neon agent skill (`.claude/skills/neon/**`,
`skills-lock.json`, source `neondatabase/agent-skills`).
- It is developer tooling only: it is not in any runtime, bundle or export, and it contains no secrets.
- No upstream licence file is vendored with it.
- SDD should decide whether to keep it in the source repository or move it to local-only configuration. This is not a
  release gate.

## 3. Security and hygiene

**SECRET_SCAN = PASS.**
- `scripts/assert-secret-boundary.mjs` passes in both repository and `--dist` modes.
- A pattern scan covered every added line of all 68 commits: Henrik key, Riot key, Postgres URL with password, Neon
  host, GitHub token, Vercel token, private key, assigned secret variables, 64-hex keys, UUIDs and PUUID-length tokens.
- Every hit was reviewed by hand. They are all templated or placeholder values (`${PASS}`, `CHANGE_ME`), a synthetic Neon
  hostname in a locality test, an npm integrity hash, the skill's content hash, Riot's public agent content ids, or
  synthetic test UUIDs.
- SECRET_CLASSES_FOUND = none.

**Hygiene.**
- No tracked env file (only `*.example`), dump, log, raw payload, `members.json`, database file or private dataset.
- Private files live under the ignored `.local/`.
- The largest added file is `package-lock.json` (182 kB).

**UNLICENSED_MAP_METADATA_INCLUDED = NO.**
- No valorant-api.com data, transform coefficients, callouts or polygons in the source tree or the `dist/` bundle.
- The only references are rejection notes in AGENTS.md / docs and the guard test in `tests/teamComposition.test.ts`.

**Provider provenance.** Henrik plant/site evidence is recorded as PROVIDER_OBSERVED_MATCH_EVIDENCE
([MAP_SPATIAL_METADATA.md](MAP_SPATIAL_METADATA.md)). No document calls Henrik match evidence RIOT_OFFICIAL or
RIOT_DERIVED_STATIC_CONTENT.

## 4. Private / public boundary

| Check | Result |
|---|---|
| RAW_PRIVATE_MATCHES_PUBLIC | NO |
| RAW_PLAYER_COORDINATES_PUBLIC | NO: spatial columns are written only by `server/repositories/postgres.ts`. No API handler, projection, analysis service or static exporter reads them, and nothing in `server/staticExport/publicAllowlist.ts` names them |
| PRIVATE_PUUID_PUBLIC | NO |
| PRIVATE_MATCH_IDS_PUBLIC | NO |
| PRIVATE_POSITION_EVENTS_PUBLIC | NO |
| Frontend bundle | No team-composition, site-reference, side-evidence, position-evidence, callout or transform code in `dist/assets` |
| Team Composition V2 | Private offline module plus script only; derived aggregates; no coordinates in output (tested) |

**PRIVATE_PUBLIC_BOUNDARY = PASS.** The deletion gap in §5 is a private-storage retention defect, not a public exposure.

## 5. BLOCKING FINDING: revocation leaves plant / defuse coordinates of a revoked participant (shared matches) [RESOLVED in attempt 2: `cb186c9` / `111b7ef`, see §13]

**What the policy requires.** [REVOCATION_AND_DELETION.md](REVOCATION_AND_DELETION.md) says that, for shared matches,
location evidence and kill location evidence involving the revoked participant are cleared.

**What happens instead.**
- Migration 0012 adds `rounds.plant_location_x/y` and `rounds.defuse_location_x/y`. These rows stay linked to the
  participant through the existing `plant_participant_id` / `defuse_participant_id`.
- `RevocationDeletionService.processMatches` was not updated for 0012. It clears `kill_events.location_*`, deletes
  `event_player_locations` (which covers the new `view_radians`) and deletes the participant's analysis facts. It never
  clears the round plant / defuse coordinates.

**Evidence.** A disposable PGlite probe (not committed) used the existing shared-match fixture with the revoked
participant as planter and defuser. The job completed, but `rounds` still held both coordinate pairs, linked to the
anonymized participant row.
- Exclusive matches are unaffected: the whole match is deleted by cascade.
- `plant_site` is a provider site label used as round topology, not a position.

**Why it blocks.** A source push deploys the new writer to Production (§7). Daily sync would then start storing these
coordinates, and the existing deletion would not fully clear them.

**Smallest correction (outside this task: it changes deletion / consent-lifecycle code).**
1. In the shared-match branch of `processMatches`, set `plant_location_x/y = NULL` on rounds where
   `plant_participant_id` is the revoked participant.
2. Do the same for `defuse_location_x/y` where `defuse_participant_id` is the revoked participant.
3. Extend the shared-match test in `tests/revocationDeletion.test.ts` to assert it.
4. Record it in REVOCATION_AND_DELETION.md and re-run this checkpoint.

## 6. Migrations and deployment order

**Migration 0012** (`migrations/0012_position_evidence.sql`, commit `ff6c8e9`):
- **Purpose:** position-evidence-v1. It has no consent content, and no other 0012 exists in any ref.
- **Schema changes:**
  - `event_player_locations.view_radians numeric`;
  - `rounds.plant_site text`, `plant_location_x/y numeric`, `defuse_location_x/y numeric`, `winning_team_role text`
    CHECK (Attacker | Defender), `attacking_team_key text` and `side_source text` CHECK (winning_team_role | plant | defuse);
  - constraint `rounds_side_source_present` CHECK ((attacking_team_key IS NULL) = (side_source IS NULL));
  - `source_matches.position_evidence_version text`.
- **ADDITIVE_ONLY = YES. NULLABLE_ONLY = YES.** Every CHECK constraint holds when its columns are NULL.
- **CONSENT_SEMANTICS_CHANGED = NO; ACTIVE_PLAYERS_CHANGED = NO.** No consent, membership, active-player or privacy-policy
  file changed in the wave. `server/deletion/runtime.ts` only swaps the Neon driver for `getSharedDatabase`
  (portability task `2cedf3d`).

**Backward compatibility.** OLD_ROWS_READABLE = YES and NULL_SPATIAL_FIELDS_SUPPORTED = YES.
- `tests/communityNameMigration.test.ts` asserts that pre-existing rows keep NULL spatial columns.
- No analytics path reads the spatial columns.
- Production matches normalized before 0012 have no spatial snapshots until they are rebuilt or resynced. Non-spatial
  analytics are unaffected.

**Deployment order.** MIGRATIONS_RUN_BEFORE_NEW_SERVER_WRITES = YES.
- `vercel.json` runs `npm run vercel-build` = `db:migrate:vercel` → `db:hydrate-facts:vercel` → `build`.
- Functions go live only after the whole build succeeds, so 0012 is applied before any new writer code runs.
- A migration failure fails the build, so nothing is deployed.
- Both steps are gated on `VERCEL_ENV === 'production'`.

## 7. Side effects of a plain source push to `main` (static inspection; nothing executed)

| Effect | Result |
|---|---|
| A. Vercel deploy | **YES**: Git-integrated Production build (AGENTS.md: "Main pushes still deploy Vercel") |
| B. Migrations | **YES**: 0012 applied to the Production database (Neon) during the build |
| C. Fact hydration | **YES**: `hydrateAnalysisFacts` over Production evidence under the new canonical key (`analysis-match-facts-v1:event-metrics-v2:…`). Failure is logged and non-blocking. It reads all evidence, which matters for the exhausted Neon transfer quota |
| D. Neon access | **YES** (B and C), plus the daily crons afterwards |
| E. Live API behaviour | **YES**: event-metrics-v2 becomes the live canonical engine (Community Score / Current Strength / Recent Form / Progress availability changes), agent-catalog-v1 changes roles (no Controller fallback; Miks = Controller), position evidence starts being written for newly synced matches. Team Composition, Shared-Match, rank context and internal strength are not exposed |
| GitHub Actions | `.github/workflows/ci.yml` (push and pull_request on `main`: lint, test, build) and `.github/workflows/deploy-pages.yml` (push on `main` + manual: lint, test, build, then deploys `dist/` to GitHub Pages). Pages builds without `VITE_DATA_MODE`, so it publishes the same demo/API client, reads nothing from the data repository and publishes no data |
| Static export / data publication | NO: only the manual `npm run data:export` / `data:publish:github` |

**DATA_REPO_CHANGE_REQUIRED_BEFORE_SOURCE_PUSH = NO.** Static data mode is opt-in. Re-exporting under event-metrics-v2 is
a separate, explicitly authorized publication step.

## 8. Version boundaries (verified)

| Boundary | Result |
|---|---|
| event-metrics-v1 | Preserved (`EVENT_METRIC_RULE_VERSION_V1`, the rollback engine). V1_REPRODUCIBLE = YES (fingerprint `6e3526ee`) |
| event-metrics-v2 | Local canonical (`CANONICAL_EVENT_METRIC_RULE_VERSION = 'event-metrics-v2'`, fingerprint `e01dc08f`) |
| Fact keys | `analysisFactsEngineKey(ruleVersion)` includes the engine. FACT_KEYS_DISTINCT = YES |
| shared-match-rating-v1 | Frozen: `SHARED_MATCH_EVIDENCE_EVENT_ENGINE = 'event-metrics-v1'` and `AGENT_ROLES_CATALOG_V0`. Exact baseline: jack 80.9, 走路 78.0, 魔王 72.0, 滑鏟 55.6, 天堂 42.3, 加分 40.5, 夏天 38.2, 滑板車 25.8, 小麻花 25.5 |
| agent-catalog-v1 | Stable id first. Miks `7c8a4701-4de6-9355-b254-e09bc2a34b72` = Controller (riot-official). `773f0c78-…` stays UNKNOWN (fail closed; 29 rows, all non-Competitive). Competitive 841 / 841 known |
| team-composition-v1 | Hierarchical member × agent → member × role → member fit. Map evidence is context only. TEAM_FIT_IS_WIN_PROBABILITY = NO, PROVEN_OPTIMAL_LINEUP = NO. Demo output byte-identical |
| team-composition-v2 | V1 assignment and Team Fit unchanged. Emittable labels: ATTACK_PRIMARY_ENTRY, ATTACK_SECOND_ENTRY_TRADE, ATTACK_PLANT_SUPPORT, ATTACK_POST_PLANT, DEFENSE_FIRST_CONTACT, DEFENSE_INFO_SUPPORT; all others suppressed. Site tendency / named callout / exact position / path output = NO. Output identical to the accepted run |
| `V2_VALIDATION` | `src/analytics/teamComposition/v2.ts`, gate version `team-composition-v2`. Rates with chronological 70/30 holdout ρ ≥ 0.6 (n = 9): attack first contact 0.80, trade 0.65, plant 0.90, post-plant 0.63; defense first contact 0.70, assists 0.78. `siteTendency = false` (1 of 6 affinities reproduced). The code now states that the gate MUST be revalidated when materially new history is added. Thresholds unchanged |
| position-evidence-v1 | Nested `player_locations` parser fix, snapshots, view direction, plant site, plant and defuse coordinates, round side. Raw coordinates private; no map transform shipped |

## 9. Release feature matrix

| Feature | Implemented locally | Tested | Publicly visible after source push | Data rebuild | DB migration | Separate UI | Separate publication |
|---|---|---|---|---|---|---|---|
| event-metrics-v2 | YES | YES | YES (live API scores; the static snapshot only after re-export) | Fact hydration (in the build) | No | No | Yes (static) |
| Rank context | YES (private staging) | YES | NO | Production rank ingestion not done | No | Yes | Yes |
| shared-match-rating-v1 | YES (private) | YES | NO | Private staging only | No | Yes | Yes |
| agent-catalog-v1 | YES | YES | YES (roles and filters in the UI and scoring) | No | No | No | Yes (static) |
| Community Score restored coverage | YES (5/9 → 6/9 locally) | YES | YES (live API) | Production evidence decides | No | No | Yes (static) |
| Current Strength restored coverage | YES (6/9 → 7/9 locally) | YES | YES (live API) | Production evidence decides | No | No | Yes (static) |
| Team Composition V1 | YES (private module + script) | YES | NO | Private staging | No | Yes | Yes |
| Team Composition V2 | YES (private module + script) | YES | NO | Private staging | No | Yes | Yes |
| Position evidence | YES | YES | NO (write-only, private) | Old matches need a resync | **0012** | n/a | Never raw |
| Site reference (internal) | YES (private, raw space) | YES | NO | Derived on demand | No | n/a | Never raw |

**Exposure classes:**
- event-metrics-v2: PUBLIC_CONTRACT_AVAILABLE + UI_AVAILABLE (contracts accept v1 or v2; present in the bundle).
- agent-catalog-v1: UI_AVAILABLE.
- Team Composition V1 and V2: INTERNAL_ONLY.
- Position evidence: SERVER write-only / INTERNAL_ONLY.

## 10. Regression evidence (2026-10-08, this worktree)

| Gate | Result |
|---|---|
| Focused regressions (event reconstruction, metrics v2 rollout, analysis facts, shared-match v1/v2, rank, agent catalog, team composition V1/V2, position evidence, static parity CI, migrations, database foundation/architecture/portability/parity, revocation) | 18 files, 227 pass, 5 skipped (real-PostgreSQL contract suite, established policy), 0 fail |
| Full suite (`npm test`) | 69 files, 955 pass, 5 skipped, 0 fail; secret boundary passed |
| Static parity (`STATIC_PARITY_LEVEL=full`) | 1 301 / 1 301 analysis, 100 / 100 weapon, 0 fail |
| lint / build / build:server / db:validate / `git diff --check` | PASS / PASS / PASS / 17 of 17 PASS / PASS |
| Real-data offline regression (private staging, read-only) | Provider requests 689 (unchanged); raw payloads and rank evidence unchanged; rank context identical across engines, 0 future leaks; basic-stat violations 0, unexpected semantic diffs 0; Shared-Match exact; facts `6e3526ee` / `e01dc08f`; V1 demo byte-identical; V2 output identical to the accepted run; Competitive agent catalog complete (841 / 841) |

## 11. Known limitations, rollback and next steps

**Limitations.**
- LIFETIME_COMPLETE = NO: history is provider-visible tracked history, not full careers.
- CANONICAL_CONSENT_RECONCILED = NO and CANONICAL_HISTORY_RECONCILED = NO.
- The Neon transfer quota is exhausted (resets 2026-11-01). Production migration readiness is not claimed.
- Riot / RSO readiness is not resumed (ticket #139243830 is separate).

**Rollback points.**
- Remote `main` `7a9934e`.
- Existing local tags such as `checkpoint-stored-index-local-01` and `checkpoint-private-rebuild-collection-01`.
- The event-metrics-v1 engine switch (one constant).
- Migration 0012 is additive. Old code ignores the new columns.

**Next.** [SUPERSEDED by §13: steps 1–2 done in attempt 2.]
1. A separately authorized deletion fix for §5.
2. Re-run LOCAL-RELEASE-CHECKPOINT-01 and create the local tag `checkpoint-local-release-pre-public-01`.
3. PUBLIC-ROLLOUT-PREFLIGHT-01, which must decide the Neon-touching build steps in §7 before any push.

## 12. Per-commit inventory

| # | Commit | Subject | Class | Impact |
|---|---|---|---|---|
| 1 | `530f1bd` | perf: reduce stored-index overlap scans | CODE, TEST | PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 2 | `7fa4738` | test: prove stored-index cursor and discovery parity | TEST | TEST_ONLY |
| 3 | `8576fb7` | docs: record stored-index efficiency architecture (acceptance blocked by Neon quota) | DOCS | DOCS_ONLY |
| 4 | `2cedf3d` | refactor(db): decouple production runtime from Neon | CODE, CONFIG, PRIVATE_MAINTAINER_TOOL | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, SERVER_RUNTIME |
| 5 | `f1b38a9` | test(db): add postgres portability and architecture guards | TEST | TEST_ONLY |
| 6 | `afd91ea` | feat(server): add standalone Node production runtime | CODE, CONFIG, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 7 | `676e20d` | infra(vps): add Docker PostgreSQL, application and Caddy stack | CONFIG | PRIVATE_OFFLINE_ONLY |
| 8 | `6fe424e` | ops(db): add backup, restore, parity gate and migration rehearsal | CODE, CONFIG, PRIVATE_MAINTAINER_TOOL, TEST | PRIVATE_OFFLINE_ONLY, SERVER_RUNTIME, TEST_ONLY |
| 9 | `7bf981e` | docs(infra): document VPS production architecture and migration | DOCS | DOCS_ONLY |
| 10 | `4c3b1d0` | chore: pin LF for shell, container and SQL files | CONFIG | PRIVATE_OFFLINE_ONLY |
| 11 | `129cef3` | fix(infra): build the app image for every service and keep app secrets out of postgres | CONFIG, TEST | PRIVATE_OFFLINE_ONLY, TEST_ONLY |
| 12 | `dc12b95` | docs(infra): record real-postgres rehearsal status (blocked by runtime environment) | DOCS | DOCS_ONLY |
| 13 | `5620921` | docs(infra): record self-host readiness outcome B (network inbound unproven) | DOCS | DOCS_ONLY |
| 14 | `72aa1e0` | fix(db): make the parity constraint list independent of table OIDs and CHECK deparse | CODE, TEST | SERVER_RUNTIME, TEST_ONLY |
| 15 | `84c2517` | fix(infra): disable the inherited HTTP healthcheck on the scheduler service | CONFIG, TEST | PRIVATE_OFFLINE_ONLY, TEST_ONLY |
| 16 | `b1a15e1` | docs(infra): record local runtime bootstrap evidence (LOCAL_RUNTIME_READY=YES) | DOCS | DOCS_ONLY |
| 17 | `c68b9d0` | feat(static): versioned public snapshot exporter with privacy gate and local publisher | CODE, CONFIG, PRIVATE_MAINTAINER_TOOL | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, STATIC_EXPORT |
| 18 | `0e947d5` | feat(frontend): static snapshot data provider behind the existing DatasetApiClient | CODE | PUBLIC_RUNTIME |
| 19 | `0ad5be1` | test(static): export, privacy gate, publication, snapshot switch and static UI coverage | PRIVATE_MAINTAINER_TOOL, TEST | PRIVATE_OFFLINE_ONLY, TEST_ONLY |
| 20 | `a522653` | docs(static): static public read model, measurements and publication channel | DOCS | DOCS_ONLY |
| 21 | `ff446a1` | refactor(analysis): extract the DB-free analysis core and weapon query for sharing | CODE | PUBLIC_RUNTIME, SERVER_RUNTIME |
| 22 | `71aea96` | feat(static): public facts and a browser query engine for full filter parity | CODE, CONFIG, PRIVATE_MAINTAINER_TOOL | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, STATIC_EXPORT |
| 23 | `71fd610` | test(static): byte-identical query parity oracle against the live services | TEST | TEST_ONLY |
| 24 | `1a7d77e` | docs(static): query parity architecture, evidence and follow-ups | DOCS | DOCS_ONLY |
| 25 | `65a7990` | feat(static): Git/GitHub data-repository publisher; weaponId content-id guard | CODE, CONFIG, PRIVATE_MAINTAINER_TOOL | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, SERVER_RUNTIME, STATIC_EXPORT |
| 26 | `00ab0a6` | test(static): publisher atomicity, lease, rollback, retention and weaponId guard | TEST | TEST_ONLY |
| 27 | `511e13e` | docs(static): publication channel evidence (synthetic, real Internet) | DOCS | DOCS_ONLY |
| 28 | `31d0210` | docs(migration): Neon quota blocker, resume checklist; add Neon skill | DOCS, OTHER | DOCS_ONLY, PRIVATE_OFFLINE_ONLY |
| 29 | `3e4a2df` | infra(pg18): PostgreSQL 18 migration target and rehearsal evidence | CONFIG, DOCS | DOCS_ONLY, PRIVATE_OFFLINE_ONLY |
| 30 | `bc7cb15` | docs(rebuild): TASK-DATA-LOCAL-REBUILD-01 prepared target and blockers | DOCS | DOCS_ONLY |
| 31 | `c8fb8b8` | feat(rebuild): add private staging history collector | CODE, CONFIG, PRIVATE_MAINTAINER_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 32 | `f2c1901` | fix(rebuild): start the request timeout after the limiter wait | PRIVATE_MAINTAINER_TOOL, TEST | PRIVATE_OFFLINE_ONLY, TEST_ONLY |
| 33 | `9306425` | fix(rebuild): enforce the rate ceiling across restarts; record rate headers | PRIVATE_MAINTAINER_TOOL, TEST | PRIVATE_OFFLINE_ONLY, TEST_ONLY |
| 34 | `757b572` | fix(rebuild): stay inside the provider's weighted budget | PRIVATE_MAINTAINER_TOOL, TEST | PRIVATE_OFFLINE_ONLY, TEST_ONLY |
| 35 | `03242f8` | fix(rebuild): record the reserved slot time and space slots by 61 s | PRIVATE_MAINTAINER_TOOL, TEST | PRIVATE_OFFLINE_ONLY, TEST_ONLY |
| 36 | `80ece40` | docs(rebuild): private staging collection evidence and status | DOCS | DOCS_ONLY |
| 37 | `0b4324f` | docs(rebuild): close private staging collection | DOCS | DOCS_ONLY |
| 38 | `df160dd` | docs(data): research historical coverage gap | DOCS | DOCS_ONLY |
| 39 | `2b47cdb` | docs(data): finalize history coverage research | DOCS | DOCS_ONLY |
| 40 | `c1ec728` | feat(rank): add private rank evidence ingestion | CODE, CONFIG, PRIVATE_MAINTAINER_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 41 | `02753ec` | docs(rank): record rank evidence coverage | DOCS | DOCS_ONLY |
| 42 | `10fae9f` | feat(scoring): add shared-match evidence model | CODE, TEST | PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 43 | `39ad1f8` | feat(scoring): add shared-match relative rating | CODE, CONFIG, RESEARCH_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, TEST_ONLY |
| 44 | `22c0773` | docs(scoring): record shared-match rating evidence | DOCS | DOCS_ONLY |
| 45 | `9a09294` | fix(analytics): handle complex round event topology | CODE, RESEARCH_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 46 | `b4d722b` | docs(analytics): record event reconstruction coverage | DOCS | DOCS_ONLY |
| 47 | `f74fccc` | analysis(scoring): evaluate shared-match v2 candidates | CODE, RESEARCH_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, TEST_ONLY |
| 48 | `87f4bdd` | docs(scoring): record shared-match v2 evidence | DOCS | DOCS_ONLY |
| 49 | `f5af18d` | analysis(scoring): evaluate internal strength candidates | CODE, CONFIG, RESEARCH_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, TEST_ONLY |
| 50 | `be301f1` | docs(scoring): record internal strength evidence | DOCS | DOCS_ONLY |
| 51 | `ba81404` | feat(analytics): version event metrics v2 facts | CODE, RESEARCH_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 52 | `bbec70f` | feat(analytics): make event metrics v2 local canonical | CODE, CONFIG, RESEARCH_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 53 | `88038f6` | docs(analytics): record event metrics v2 rollout evidence | DOCS | DOCS_ONLY |
| 54 | `063b273` | fix(data): resolve agent catalog by stable identity | CODE, TEST | PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 55 | `740dc1e` | test(data): guard unknown agent identities | CODE, CONFIG, PRIVATE_MAINTAINER_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, SERVER_RUNTIME, TEST_ONLY |
| 56 | `144b0a6` | docs(data): record agent catalog and team readiness | DOCS | DOCS_ONLY |
| 57 | `68d8e40` | test(staging): remove clock-dependent sanitization assertion | TEST | TEST_ONLY |
| 58 | `c9f42f3` | analysis(team): evaluate composition candidates | CODE, CONFIG, RESEARCH_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, TEST_ONLY |
| 59 | `b1e52ab` | feat(team): add evidence-based composition recommendation | CODE, TEST | PUBLIC_RUNTIME, TEST_ONLY |
| 60 | `a2b5081` | docs(team): record composition evidence and limitations | DOCS | DOCS_ONLY |
| 61 | `ff6c8e9` | fix(data): normalize player position evidence | CODE, MIGRATION, TEST | DATABASE_SCHEMA, SERVER_RUNTIME, TEST_ONLY |
| 62 | `effef44` | feat(data): add spatial evidence reconstruction | CONFIG, RESEARCH_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, TEST_ONLY |
| 63 | `727d655` | test(data): account for additive migration 0012 in migration snapshots | TEST | TEST_ONLY |
| 64 | `88819f6` | docs(data): record position evidence coverage | DOCS | DOCS_ONLY |
| 65 | `4815c4a` | docs(data): record map spatial metadata evidence | DOCS | DOCS_ONLY |
| 66 | `5907797` | feat(team): add side and site evidence model | CODE | PUBLIC_RUNTIME |
| 67 | `9a45245` | feat(team): add team composition v2 responsibilities | CODE, RESEARCH_TOOL, TEST | PRIVATE_OFFLINE_ONLY, PUBLIC_RUNTIME, TEST_ONLY |
| 68 | `b260fb9` | docs(team): record team composition v2 evidence | DOCS | DOCS_ONLY |

## 13. Attempt 2 — TASK-RELEASE-BLOCKER-FIX-01 (2026-10-08)

**Result: RELEASE_CHECKPOINT_READY = YES.** Tag `checkpoint-local-release-pre-public-01` (local, annotated, not pushed)
points at the commit that adds this section.

### 13.1 Commits added since attempt 1

| Commit | Subject | Class / impact |
|---|---|---|
| `95839b0` | docs(team): require revalidation of the V2 validation gate | CODE (comment only) / PRIVATE_OFFLINE_ONLY |
| `22df92f` | docs(release): record local pre-public checkpoint | DOCS |
| `cb186c9` | fix(privacy): erase revoked spatial event coordinates | CODE + DOCS / SERVER_RUNTIME (revocation deletion) |
| `111b7ef` | test(privacy): cover position evidence revocation | TEST |
| `d9d37ca` | chore(dev): remove unlicensed neon skill from release tree | OTHER + CONFIG (`.gitignore`) |
| (this commit) | docs(release): close pre-public release blockers | DOCS |

### 13.2 Revocation spatial privacy (blocker 1)

**Root cause.** Migration 0012 added `rounds.plant_location_x/y` and `rounds.defuse_location_x/y`, but the shared-match
branch of `RevocationDeletionService.processMatches` was never extended to clear them.

**Fix (`cb186c9`).** Inside the existing per-participant anonymization transaction, the service now clears the plant
coordinates on rounds where the revoked participant is `plant_participant_id`, and the defuse coordinates where it is
`defuse_participant_id`.

**Unchanged:**
- consent semantics, eligibility, authorization and active players;
- migration 0012;
- exclusive-match cascade deletion;
- kill-position and snapshot rules (already correct).

**Field audit.** The table lives in [REVOCATION_AND_DELETION.md](REVOCATION_AND_DELETION.md).
- Player snapshots (with `view_radians`): deleted (already).
- Kill positions where the participant is killer or victim: cleared (already).
- Plant and defuse coordinates of the participant: **now cleared**.
- Planter / defuser references: kept as anonymous topology, pointing only to the anonymized row with `player_id` NULL
  and a random HMAC.
- Site label, side, status and time: kept as shared, non-personal round facts.
- Version marker: kept.

**Tests (`111b7ef`, `tests/revocationDeletion.test.ts`).** Four permanent tests, all of which **failed before the fix**
with the revoked plant 7101/7102 and defuse 7201/7202 left in place, and pass after it:
1. No attributable snapshot, view, kill, plant or defuse coordinate remains.
2. The shared match, round topology, site / side labels and the retained participant's identity, stats, own snapshot
   with view, own plant / defuse coordinates and own kill position are all preserved.
3. A repeated `continue` and a repeated revoke (which returns the same job) change or resurrect nothing.
4. `hydrateAnalysisFacts` afterwards recreates no facts and no residue for the revoked participant.

### 13.3 Third-party Neon skill (blocker 2)

**Commit `31d0210` contents.**
- `.claude/skills/neon/SKILL.md` plus 6 reference files, and `skills-lock.json`.
- Mixed with legitimate project docs: AGENTS.md, PRODUCTION_DATA_MIGRATION.md and TASKS.md. Those docs are kept.

**Provenance and licence.**
- `SKILL.md` is byte-identical to `neondatabase/agent-skills` `skills/neon/SKILL.md`.
- Upstream is public and licensed **Apache-2.0** (GitHub licence metadata; no NOTICE file).
- The vendored copy carried no licence text, which Apache-2.0 redistribution requires.

**Dependencies.** None: no runtime, build or test code references the skill.

**Decision (`d9d37ca`).**
- The skill is removed from the release tree, because it is unnecessary vendor tooling (Neon is pending retirement and
  Neon MCP is deferred).
- `.claude/skills/` and `skills-lock.json` are now git-ignored, so per-developer installs are never vendored again.
- It was not installed elsewhere; a developer who needs it can install it locally from upstream.
- NEON_SKILL_IN_RELEASE_TREE = NO. UNLICENSED_THIRD_PARTY_SKILL_IN_RELEASE_TREE = NO.
- DEVELOPMENT_HISTORY_REWRITTEN = NO: `31d0210` stays in local history only.

### 13.4 Release branch strategy (recorded; not executed)

The development history (which contains `31d0210`) will **not** be pushed directly. The steps are:
1. A clean release branch is created from `origin/main` `7a9934e9408cb77eab21d6f31572512c2294b730`.
2. The final approved tree delta (tag `checkpoint-local-release-pre-public-01`) is applied to it as a squash.
3. That branch is validated, then goes through PUBLIC-ROLLOUT-PREFLIGHT-01.
4. It is pushed only after SDD approval.

This way, the product code is included, the Neon skill files are absent, the unpublished history never reaches the
remote, and remote `main` stays a normal fast-forward from its current baseline.

### 13.5 Gate re-run (all on head `d9d37ca`, before this docs-only commit)

| Gate | Result |
|---|---|
| WORKTREE_CLEAN | YES (73 commits ahead of `origin/main`, 0 behind; merge base = `origin/main`) |
| SECRET_SCAN | PASS: secret-boundary script in repository and `--dist` modes; added-line pattern scan of all 73 commits; same benign classes as attempt 1 |
| PRIVATE_PUBLIC_BOUNDARY | PASS (no new public path; the bundle has no team-composition / site / position / transform code) |
| REVOCATION_SPATIAL_PRIVACY | PASS |
| UNLICENSED_MAP_METADATA_INCLUDED | NO |
| UNLICENSED_THIRD_PARTY_SKILL_IN_RELEASE_TREE | NO (0 tracked `.claude/` or `skills-lock.json` files) |
| MIGRATION_AUDIT / DEPLOYMENT_ORDER_SAFE | PASS / YES (unchanged since attempt 1; MIGRATION_0012_CHANGED = NO) |
| Version boundaries, Shared-Match, Team Composition V1 / V2, position privacy | PASS |
| Focused privacy (revocation, browser deletion, position evidence, database foundation, migrations, architecture, static snapshot / export) | 8 files, 126 pass, 0 fail |
| Focused analytics (event reconstruction v2, metrics v2 rollout, metrics reconstruction, analysis facts, shared-match, agent catalog, team composition V1 / V2, rank) | 9 files, 128 pass, 0 fail |
| FULL_SUITE | 69 files, 959 pass, 5 skipped (real-PostgreSQL contract suite, established policy), 0 fail |
| STATIC_PARITY (full) | 1 301 / 1 301 analysis, 100 / 100 weapon |
| LINT / BUILD / BUILD_SERVER / DB_VALIDATE / GIT_DIFF_CHECK | PASS / PASS / PASS / 17 of 17 / PASS |
| REAL_DATA_OFFLINE_REGRESSION | PASS: provider requests 689; raw and rank evidence unchanged, 0 future leaks; basic-stat violations 0, unexpected diffs 0; Shared-Match exact; facts `6e3526ee` / `e01dc08f`; V1 demo byte-identical; V2 identical; Competitive agent catalog 841 / 841 |

**Unchanged limitations.**
- LIFETIME_COMPLETE = NO, CANONICAL_CONSENT_RECONCILED = NO, CANONICAL_HISTORY_RECONCILED = NO.
- §7 still applies: a plain `main` push deploys Vercel, runs 0012 on Neon, hydrates facts on Neon and redeploys Pages.

**Next:** PUBLIC-ROLLOUT-PREFLIGHT-01. It must solve the §7 push side effects while the Neon transfer quota remains
constrained. Nothing is pushed before SDD approval.
