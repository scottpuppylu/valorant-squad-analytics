# Repository instructions

## Product boundary

- Build VALORANT Squad Analytics as a transparent community performance dashboard for a private friend group.
- Never describe the score as MMR, Elo, official rank, or a replacement for Riot's ranked system.
- Preserve the GitHub Pages demo during TASK-API-02 migration. Production may use a thin Vercel backend, but no API key or Henrik DTO may enter the deployed frontend.
- TASK-API-02.1 is the completed evidence checkpoint. Normal players provide only Riot Game Name, Tag, affinity and explicit consent. The site operator holds one `HENRIK_API_KEY` server-side; never ask players for provider credentials or Riot authentication secrets.
- Do not copy Riot, VALORANT, VLR, or third-party visual assets or page designs.

## Infrastructure principles (TASK-INFRA-DATABASE-PORTABILITY-01, decided 2026-10-07)

- **Final Production architecture:** a single VPS running Docker Compose: Caddy → Node API → PostgreSQL on a
  private Docker network.
  [PARTIALLY SUPERSEDED 2026-10-07 for the PUBLIC READ PATH: the Compose stack runs on the self-hosted machine for sync +
  PostgreSQL + export; public reads are served as a static snapshot (TASK-INFRA-STATIC-DATA-PUBLISH-01), so no public
  Node API, inbound port or CGNAT resolution is required.]
  - GitHub Pages = Demo / static rollback only.
  - Vercel serverless and Neon = pending retirement.
  - Do not re-propose another DBaaS/serverless split. See docs/VPS_PRODUCTION_ARCHITECTURE.md.
- **Static public read path (TASK-INFRA-STATIC-DATA-PUBLISH-01, 2026-10-07):** PostgreSQL stays the only source of
  truth. Public read views may be served as a derived, immutable, privacy-gated static snapshot
  (`docs/STATIC_DATA_PUBLISH.md`).
  - Never serialize database rows; every exported path must be in `server/staticExport/publicAllowlist.ts`.
  - Never read public JSON back into PostgreSQL, and never publish real data without explicit authorization.
  - The manifest is always published last. The browser never calls a provider.
  - Publication (TASK-INFRA-STATIC-PUBLICATION-CHANNEL-01): only `npm run data:publish:github` writes the separate DATA
    repository, never the source repository. Never force-push, except a measured, SDD-authorized force-with-lease
    compaction of the data repository. `weaponId` = Riot static weapon content id, never a player/account/internal id.
  - Static query parity (TASK-INFRA-STATIC-QUERY-PARITY-01): the browser engine must call ONLY the shared core
    (`src/analytics/analysisCore.ts`, `src/analytics/weapons/weaponQuery.ts`). Never add browser-only formulas.
    Any change to the server analysis path keeps `tests/staticQueryParity.test.ts` byte-identical.
- **PostgreSQL portability:** PostgreSQL is the persistence contract.
  - Business logic MUST NOT depend on a proprietary database SDK.
  - Use only `server/db/runtime.ts` (`createDatabase` / `getSharedDatabase`, standard `pg`); `DATABASE_URL` is the
    only database configuration.
  - Guarded by tests/databaseArchitecture.test.ts.
- **Production locality:** the API and PostgreSQL communicate only over localhost or the private container network.
  PostgreSQL never publishes a port.
- **Bounded background work:** every sync, history, backfill, bulk and maintenance operation has deterministic
  request, pagination, concurrency and runtime bounds, and fails closed at its budget.
- **Restore-first backup:** a backup is not accepted without a deterministic, rehearsed restore
  (docs/DATABASE_OPERATIONS.md).
- **Hosting independence:** replacing the infrastructure host must not require rewriting domain logic.
  - The 12 API handlers run unchanged on Vercel and on `server/node/httpServer.ts`.
- **Main pushes still deploy Vercel:** do not push main in the middle of a migration sequence. Follow
  docs/PRODUCTION_MIGRATION_RUNBOOK.md in order (any parity mismatch → CUTOVER = ABORT).

## Technology

- Use React, TypeScript, Vite, Tailwind CSS, Recharts, Vitest, and npm.
- Keep data types, raw statistics, derived statistics, normalization, scoring weights, and UI in separate modules.
- Never place scoring logic directly inside React components.
- Prefer strict TypeScript and small, testable functions.

## Data and scoring

- Keep every derived metric transparent and document its formula in `docs/SCORING.md`.
- Treat sample-size confidence separately from performance scores.
- Handle missing advanced statistics without breaking scoring.
- Use role-aware comparisons so the system does not automatically favor Duelists.
- When scoring logic changes, update documentation and add or update tests in the same change.

## Required verification

- Before declaring work complete, run `npm run lint`, `npm test`, and `npm run build` when those scripts exist.
- Report the exact verification results and any skipped or unavailable checks.
- Do not claim a check passed unless it was run successfully in the current worktree.

## Git and security

- Use small, focused commits and preserve unrelated user changes.
- Never commit secrets, credentials, API keys, `.env` files, generated logs, or private player identifiers.
- Keep the rollback deployment compatible with the repository subpath on GitHub Pages while making the selected Vercel deployment work at `/`.
- Do not rewrite history or force-push unless the user explicitly asks.

## Current stage

### AUTHORITATIVE STATUS (updated 2026-10-05 — this table wins over every older line below)

| Task | Status |
|---|---|
| DATA-05A persistent scheduled sync | PRODUCTION ACTIVATED / ACCEPTED (cron enabled) |
| DATA-03B.1 history pagination | COMPLETE / ACCEPTED |
| DATA-03B.2A scope engine | COMPLETE / ACCEPTED |
| DATA-03B.2B server analytics (`view=analysis`) | COMPLETE / ACCEPTED |
| TASK-DATA-03B.2C no website match-count ceiling / scalable full-tracked analytics | COMPLETE / ACCEPTED (2026-10-06; server-analysis-v2, selection-summary-v1; 300 = transport-only; generic 2000 cap REMOVED; no migration) — see docs/FULL_TRACKED_ANALYTICS.md |
| TASK-DATA-SEASON-01 season evidence | COMPLETE / ACCEPTED (Act data available; coverage partial and dynamic) |
| TASK-PROGRESS-01 Adaptive Improvement Index | COMPLETE / ACCEPTED (2026-10-06; improvement-index-v1) — see docs/PROGRESS_INDEX.md |
| TASK-DATA-FASTSYNC-01 opportunistic recent refresh | COMPLETE / ACCEPTED (2026-10-06; recent-refresh-v1) — see docs/FAST_RECENT_SYNC.md |
| TASK-DATA-FASTSYNC-02 sub-daily scheduled recent sync | NOT STARTED / OPTIONAL FUTURE |
| TASK-DATA-FASTSYNC-01.1 known-boundary fast path | DEFERRED |
| TASK-IDENTITY-01 member / multi-account identity | COMPLETE / ACCEPTED (2026-10-06; member-identity-v1, schema 5, migration 0008) — production 9 members × 1 account, 0 merges; see docs/MEMBER_IDENTITY.md |
| TASK-IDENTITY-01B community names + nickname | COMPLETE / ACCEPTED (2026-10-06; member-identity-v2, schema 6; migrations 0009 + one-time data migration 0010) — production 9 members × 1 account, 9 approved community names, nicknames unset, 0 merges |
| TASK-ADMIN-01 authenticated browser administration | NOT STARTED (no public edit endpoint until then) |
| TASK-WEAPON-01 member-level weapon analytics | COMPLETE / ACCEPTED (2026-10-06; weapon-analytics-v1; no migration) — see docs/WEAPON_ANALYTICS.md |
| TASK-WEAPON-01.1 Warden catalog correction | COMPLETE / ACCEPTED (2026-10-06; weapon-catalog-v2: Warden → Rifle per Riot Patch 13.06; classification only) |
| TASK-DATA-FASTSYNC-01.2 FASTSYNC UI navigation regression test repair | NOT STARTED |
| TASK-SECURITY-02 dependency audit drift reassessment | COMPLETE / SECURITY DISPOSITION ACCEPTED (2026-10-06): full audit 7 (5 high GHSA-vfj7 → SEC-2026-001 original subset only; 2 moderate GHSA-rj75 → SEC-2026-002, review 2026-11-03); source-map-js GHSA-68fv FIXED; production audit 0 — see docs/SECURITY_EXCEPTIONS.md |
| TASK-SECURITY-03 Tailwind 4 / build toolchain security migration | NOT STARTED — needs explicit authorization |
| TASK-DATA-BULK-01 multi-account bulk historical backfill accelerator | IMPLEMENTED / CANARY PASSED (2026-10-06; bulk-history-v1; 12 charged / 10 actual provider requests; 2 lanes default) — see docs/BULK_HISTORY.md |
| TASK-DATA-BULK-01A production bulk crawl Phase 1 | EVIDENCE ACCEPTED / STOPPED ON PROVIDER 429 (2026-10-06): 84 charged / 77 actual provider requests; tracked 213 → 332 — see docs/BULK_HISTORY.md |
| TASK-INFRA-SELFHOST-READINESS-01 self-host readiness (SELF_HOSTED_FIRST; cloud VPS cancelled as primary) | OUTCOME B — HOST_READY_NETWORK_BLOCKED (2026-10-07) [inbound no longer blocks the public read path: static distribution, TASK-INFRA-STATIC-DATA-PUBLISH-01]: host suitable; direct inbound unproven (no IPv6, CGNAT POSSIBLE); backups share one SSD; host currently power-cycled daily — SDD decision on inbound path needed; see docs/TASKS.md |
| TASK-INFRA-REAL-POSTGRES-REHEARSAL-01 real PostgreSQL / Docker rehearsal | [SUPERSEDED: PASS in TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01] BLOCKED_BY_RUNTIME_ENVIRONMENT (2026-10-07): no Docker / PostgreSQL / Caddy on the authoring machine; static checks + restore negative paths PASS; 2 compose defects fixed (app-image build linkage; postgres least-privilege env); real rehearsal must run on Docker Desktop or the VPS before any data migration — see docs/DATABASE_OPERATIONS.md |
| TASK-INFRA-DATABASE-PORTABILITY-01 database portability + VPS runtime prep | LOCAL IMPLEMENTATION COMPLETE (2026-10-07): CODE_PROVIDER_DECOUPLING=COMPLETE (Neon SDK removed; standard pg), NODE_STANDALONE_RUNTIME=COMPLETE, VPS_DEPLOYMENT_ASSETS=COMPLETE, LOCAL_POSTGRES_VALIDATION=PGlite PASS / real PostgreSQL PASS (TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01), MIGRATION_REHEARSAL=parity gate PASS / pg_dump rehearsal PASS; PRODUCTION_VPS_READY / DATA_MIGRATION / CUTOVER = NOT STARTED; Vercel/Neon still current Production — see docs/DATABASE_PORTABILITY.md |
| TASK-DATA-HISTORY-COVERAGE-GAP-01 recover history beyond the provider-visible set | COMPLETE (SDD-corrected 2026-10-07): PRIMARY OUTCOME_D (no documented authorized source demonstrates recoverable lifetime history), supporting candidate OUTCOME_B (Riot Production + RSO, depth UNKNOWN; private personal-use scope not approvable); current Henrik recovery exhausted (documented accumulating subset); 滑鏟 reference-count gap ≈ 331 confirmed, match-level gap NOT verified; legacy Neon extra history UNKNOWN; no authorized third-party API found; lifetimeComplete = false — see docs/HISTORY_COVERAGE_GAP.md. Originally PLANNED / RESEARCH ONLY: 滑鏟 ≈ 433 observed vs 102 Henrik-visible Competitive in 2026; assess Riot official/RSO, ticket #139243830, provider retention, other authorized sources, product UX; no scraping or access-control bypass — see docs/REBUILD_STAGING.md |
| TASK-DATA-LOCAL-REBUILD-COLLECT-01 private provider-history staging collection | PASS_WITH_GOVERNANCE_EXCEPTION (SDD 2026-10-07; PRIVATE_REBUILD_COLLECTION_READY = YES; rate waiver for this task only, HISTORICAL_MAX_OBSERVED_RPM = 7, future limit stays 6 / 2 lanes; UPSTREAM_HISTORY_COVERAGE_LIMITATION; local backup verified) — originally COLLECTION COMPLETE / AWAITING SDD REVIEW (2026-10-07): rebuild-staging-v1 in the isolated PG18 valorant_rebuild_staging (127.0.0.1:55903); 9/9 accounts resolved; 671 provider requests (≤ 2 lanes; 6 per 60 s limiter, 7 seen in 6 log windows before two fixes); 838 unique matches = 838 reference, all hydrated, all 18 sources exhausted, integrity 0 defects; 滑鏟 Competitive 2026 = 102 (provider history starts 2026-02-15). Consent / public code unchanged, no migration 0012, not publication-eligible, lifetimeComplete = false — see docs/REBUILD_STAGING.md. Never import server/rebuildStaging from api/, src/ or the application runtime |
| TASK-DATA-LOCAL-REBUILD-01 Henrik → local PostgreSQL 18 rebuild (LOCAL_PRODUCTION_CANDIDATE) | SUPERSEDED by TASK-DATA-LOCAL-REBUILD-COLLECT-01 (SDD abandoned the consent-mode path) — originally PREPARED / BLOCKED_ON_MAINTAINER_INPUT (2026-10-07): empty PG18 target vsa-rebuild-pg18 / valorant_local_rebuild (127.0.0.1:55902, migrations 0001–0011, 0 rows); 0 provider requests. Needs HENRIK_API_KEY placed locally by the maintainer, the 9 Riot IDs + affinity, an SDD consent-record decision and an IDENTIFIER_HMAC_KEY decision. 6 RPM / 2 lanes max; lifetimeComplete stays false; no publication; Neon untouched — see docs/LOCAL_REBUILD.md |
| TASK-INFRA-PRODUCTION-PG18-TARGET-PREP-01 PostgreSQL 18 migration target | COMPLETE / AWAITING SDD REVIEW (2026-10-07): source PG18 = VERIFIED_METADATA; WSL pg_dump / pg_restore / psql 18.6 (PGDG client only); target vsa-prodmig-pg18 (127.0.0.1:55901, EMPTY); PG16 vsa-prodmig-pg = SUPERSEDED_EMPTY_MIGRATION_TARGET; PG18 migrations, contract suite 15/15, dump/restore parity, read API 15/15 and static export PASS on synthetic data — see docs/PRODUCTION_DATA_MIGRATION.md |
| TASK-INFRA-PRODUCTION-DATA-MIGRATION-01 Neon → local PostgreSQL | DEFERRED_BY_NEON_TRANSFER_QUOTA (SDD 2026-10-07; superseded for now by TASK-DATA-LOCAL-REBUILD-01; Neon preserved for TASK-DATA-NEON-RECONCILIATION-01) — originally BLOCKED_BY_NEON_TRANSFER_QUOTA (2026-10-07): Neon Free transfer ≈ 5.13 GB of ≈ 5 GB, resets 2026-11-01 (or explicit maintainer-confirmed upgrade); NO Production probe/read/dump; local target vsa-prodmig-pg / valorant_production_migration ready and EMPTY; Neon CLI 8.0.11 + project Neon skill installed, Neon MCP DEFERRED; LOCAL_PRODUCTION_DATABASE_READY = NO — resume via docs/PRODUCTION_DATA_MIGRATION.md checklist |
| TASK-INFRA-STATIC-PUBLICATION-CHANNEL-01 publication channel | ACCEPTED (SDD 2026-10-07; STATIC_PUBLICATION_CHANNEL_READY = YES) — originally LOCAL IMPLEMENTATION + SYNTHETIC REMOTE VALIDATION COMPLETE (2026-10-07): public data repo scottpuppylu/valorant-squad-analytics-data (Pages main:/, https://scottpuppylu.github.io/valorant-squad-analytics-data/); GitHubDataRepositoryPublisher (version → verify → manifest LAST, fast-forward lease, audit records, gh-session credential helper on the work clone only); synthetic A/B/partial-C/rollback remote tests PASS; propagation 23–55 s; history 364.6 KiB; SYNTHETIC DATA ONLY, REAL_PUBLIC_DATA_PUBLISHED = NO — see docs/STATIC_DATA_PUBLISH.md §11 |
| TASK-SYNERGY-SCALING-01 all-history Synergy at 10k (~7 s in the shared scoring aggregation) | DEFERRED / NON-BLOCKING (SDD 2026-10-07) |
| TASK-INFRA-STATIC-QUERY-PARITY-01 static query parity | ACCEPTED (SDD 2026-10-07; STATIC_DATA_ARCHITECTURE_READY = YES; weaponId approved as a public static content id) — originally LOCAL IMPLEMENTATION COMPLETE (2026-10-07): hybrid static read model — public-facts-v1 + the SHARED server analysis core (src/analytics/analysisCore.ts, used by ServerAnalysisService) and shared weapon query (src/analytics/weapons/weaponQuery.ts) run in the browser (StaticQueryEngine, Web Worker); `common` first-paint tier; every normal filter incl. multi-filter and custom dates preserved; parity 1 301 analysis + 100 weapon cases byte-identical, 0 fail; 10k export 118–139 s at default timeout; weapon SQL blocker removed by architecture; all-history Synergy ≈ 7 s at 10k inherited from the shared scoring code (TASK-SYNERGY-SCALING-01 proposed) — see docs/STATIC_DATA_PUBLISH.md §10 |
| TASK-INFRA-STATIC-DATA-PUBLISH-01 static public read model | LOCAL IMPLEMENTATION ACCEPTED / STATIC_DATA_ARCHITECTURE_READY NOT ACCEPTED (SDD 2026-10-07; superseded by STATIC-QUERY-PARITY-01) — originally LOCAL IMPLEMENTATION COMPLETE / AWAITING SDD REVIEW (2026-10-07): static-snapshot-v1 + static-catalog-v1 + public-export-gate-v1 (allowlist, forbidden-name, content, DB cross-check); exporter = same server services over one READ ONLY PostgreSQL snapshot (`npm run data:export`, local DB only); LocalFilesystemPublisher (manifest LAST); StaticSnapshotClient (`VITE_DATA_MODE=static`); synthetic data only; recommended channel B (separate public data repository + Pages); PUBLIC_DATA_PUBLISHED = NO — see docs/STATIC_DATA_PUBLISH.md |
| TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01 local runtime | ACCEPTED (SDD, 2026-10-07) — LOCAL_RUNTIME_READY = YES (2026-10-07): WSL vhdx moved to D: (recovery export kept until acceptance), Docker Engine in WSL (no Docker Desktop), PostgreSQL 16 on ext4; real-PG tests, migration rehearsal, backup/restore and local stack PASS on synthetic data; fixed database-parity-v2 + scheduler healthcheck; PRODUCTION_DATA_MIGRATION / CUTOVER / STATIC_JSON_PUBLISH NOT STARTED — see docs/DATABASE_OPERATIONS.md |
| TASK-DATA-STORED-INDEX-01 stored-index efficiency | IMPLEMENTATION IN PROGRESS / PRODUCTION ACCEPTANCE BLOCKED BY NEON TRANSFER QUOTA (2026-10-07): stored-index-efficiency-v1 / deep-history-v2 implemented locally (STORED_INDEX_PAGE_SIZE 20, ≤ 2 provider requests per chunk, v1 stored cursors restart at page 1; local index requests −85 % at Phase-3 density, exact discovery parity); NOT pushed; 0 canaries run — see docs/STORED_INDEX_EFFICIENCY.md |
| TASK-DATA-BULK-01E bulk crawl Phase 3 (2 lanes / 6 RPM) | COMPLETE / ACCEPTED (2026-10-06): full 120 min, 599 charged = 599 measured provider requests, 0 errors of any kind, max chunk 14.8 s; tracked 672 → 838, earliest 2024-01-13; 6 accounts source-exhausted (not lifetime-complete); 6 RPM SUSTAINED ACCEPTED; next decision C (stored_index re-reads known entries: 503 requests → 14 persisted) — see docs/BULK_HISTORY.md |
| TASK-DATA-BULK-01B bulk crawl Phase 2 (2 lanes / 6 RPM) | HISTORICAL RUN STOPPED; BOTH KNOWN BLOCKERS RESOLVED (HISTORICAL-IDENTITY-01 + DATA-03B.2D); continued as TASK-DATA-BULK-01E — originally STOPPED / BLOCKED (2026-10-06): first DATABASE_ERROR after 53.6 min, zero 429; 311 charged provider requests; tracked 332 → 671; oldest 2025-01-25; root cause NOT VERIFIED — see docs/BULK_HISTORY.md |
| Full-tracked analysis latency | RESOLVED by TASK-DATA-03B.2D (constant statements; local 10 k realistic lifetime 4.5 s, synergy 6.3 s); remaining O(n) is CPU aggregation and the phase-1 scan |
| TASK-SCORING-RANK-01 | NOT STARTED |
| TASK-DATA-PERFORMANCE-SCORE-01 official Performance Score evidence | AUDIT COMPLETE / PHASE B BLOCKED (2026-10-06): provider field NOT VERIFIED (outcome D); `stats.score` = legacy combat-score total → ACS_SAFE; nothing ingested — see docs/PERFORMANCE_SCORE.md |
| TASK-ANALYTICS-TEAM-COMPOSITION-01 team composition v1 | COMPLETE / OUTCOME_B / AWAITING SDD REVIEW (2026-10-08; local only): team-composition-v1 = recommendTeamComposition({ memberIds (exactly 5), map }); score = mean validated agent-level fit (team-fit-hierarchy-v1, n/(n+8)); chronological match-level holdout: member × agent signal beyond member baseline in 5/5 splits (r 0.15–0.50), map levels add none, no team candidate predicts win / round diff; map, pair synergy (14/36 pairs) and role distribution are context only; conservative ranking (0.2σ comparable band → highest confidence); TEAM_FIT = mean personal percentile (not a probability); responsibilities from role-scoped behaviour (≥ 5 matches, no LURK); shared-match catalog sensitivity ρ 0.983, max Δ 3.0, assignment sensitivity NONE; no position / site claims — see docs/TEAM_COMPOSITION.md |
| TASK-DATA-AGENT-CATALOG-01 agent → role catalog | COMPLETE / AWAITING SDD REVIEW (2026-10-08; local only): agent-catalog-v1 keyed by stable agent content id with name aliases (src/utils/agentRoles.ts, single source); Miks 7c8a4701-… = Controller (Riot official, SDD-resolved); 773f0c78-… (provider "Unknown") stays UNKNOWN (29 tracked rows, all non-Competitive); Controller fallback removed (no known role → undefined); AGENT_CATALOG_COMPLETE guard (validateAgentCatalog / checkAgentCatalog / `npm run agents:check`): Competitive 841/841; shared-match-evidence-v1 pinned to AGENT_ROLES_CATALOG_V0 (ratings exact); coverage Community Score 5 → 6/9, Current Strength 6 → 7/9, Recent Form 2 → 4/9, Progress 8 → 9/9; TEAM_COMPOSITION_V1_READY = YES (no position/site claims) — see docs/AGENT_CATALOG.md |
| LOCAL-RELEASE-CHECKPOINT-01 local pre-public checkpoint | ATTEMPT 2 READY (2026-10-08, TASK-RELEASE-BLOCKER-FIX-01): RELEASE_CHECKPOINT_READY = YES, local tag checkpoint-local-release-pre-public-01 (NOT pushed); revocation now clears the revoked planter/defuser plant/defuse coordinates (consent semantics and 0012 unchanged); third-party Neon skill removed from the release tree (Apache-2.0 upstream, no vendored licence; history kept); release = clean branch from origin/main 7a9934e + squash of the tagged tree; next PUBLIC-ROLLOUT-PREFLIGHT-01. [Attempt 1, superseded:] COMPLETE / RELEASE_CHECKPOINT_READY = NO (2026-10-08; no tag, nothing pushed): 68 commits ahead of origin/main 7a9934e audited; secret scan PASS; public boundary PASS; migration 0012 additive/nullable, deploy order safe; full suite 955 pass / 0 fail; static parity 1 301/1 301 + 100/100; real-data offline regression PASS. BLOCKER: revocation of a shared match leaves rounds.plant_location_x/y / defuse_location_x/y of the revoked planter/defuser (0012 columns not cleared by RevocationDeletionService) — fix needs separate authorization (deletion code); a source push also migrates/hydrates Neon in the Vercel build — see docs/LOCAL_RELEASE_CHECKPOINT.md |
| TASK-ANALYTICS-TEAM-COMPOSITION-02 side / site responsibilities | COMPLETE / OUTCOME_B / AWAITING SDD REVIEW (2026-10-08; local only, NOT pushed): site-reference-v1 (per-map provider plant-label centroids + empirical P95/P99 envelopes; chronological CV P95 accuracy 0.948, 0 wrong site, abstention 0.052, ambiguity 0), side-evidence-v1 (explicit side only; 8.8 % unknown-side member-rounds excluded), team-composition-v2 = explanation layer on the UNCHANGED V1 assignment (0/9 changes); holdout: first contact / trade / plant / post-plant (attack) and first contact / assists (defense) reproduce (ρ ≥ 0.6), site tendencies do not (1 of 6) → all site claims withheld; SITE_HOLD / CLUTCH / FLEX / INFO_SETUP / SPACE_CONTROL / UTILITY_SUPPORT NOT_VALIDATED; ROTATION / paths NOT_READY; V1 byte-identical; Shared-Match / rank / facts unchanged — see docs/TEAM_COMPOSITION_V2.md |
| TASK-DATA-MAP-ZONE-METADATA-01 map spatial metadata | STOPPED FOR SDD REVIEW / OUTCOME_D (2026-10-08; docs only): the only transform / callout source (valorant-api.com) is unofficial, All Rights Reserved, game-file extraction → not vendored, downloaded or used; callouts are single points (no polygons); MAP_TRANSFORM_READY = NO; validated license-free alternative: provider plant-site labels cluster 100 % (7 532 plants, 13 maps, p95 spread 3.4–11× below the site gap) → PROVIDER_SITE_REFERENCE possible if SDD authorizes; TEAM_COMPOSITION_V2_READY = NO by gate — see docs/MAP_SPATIAL_METADATA.md |
| TASK-DATA-POSITION-NORMALIZATION-01 player positions / plant site / round side | COMPLETE / AWAITING SDD REVIEW (2026-10-08; local only): position-evidence-v1 + migration 0012 (additive nullable columns); player_locations parsed per the observed nested contract (was a flat shape the provider never sends); view_radians, plant site (provider label) / plant & defuse coordinates, round side from explicit evidence only (role / planter / defuser; 0 conflicts); real data 721 914 snapshots (100 % with view), 7 532 plant sites, side 86.7 % of Competitive rounds; rebuild ×2 identical (fingerprint c94877ed…); metrics / facts / Shared-Match / Team Composition v1 unchanged; coordinates PROVIDER_RAW_UNKNOWN, event-time only, never exported; MAP_ZONE_METADATA_READY = NO → TEAM_COMPOSITION_V2_READY = NO — see docs/POSITION_EVIDENCE.md |
| TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01 event-metrics-v2 local canonical | LOCAL_V2_CANONICAL_READY = YES / LOCAL DEFAULT SWITCHED / AWAITING SDD REVIEW (2026-10-08; NOT pushed, public rollout BLOCKED): CANONICAL_EVENT_METRIC_RULE_VERSION = event-metrics-v2 (one switch; v1 preserved = rollback); facts engine_key names the writing engine (analysis-match-facts-v1:event-metrics-v2:durable-evidence-v2); contracts/synergy accept v1|v2 (shape identical, formulas unchanged); shared-match evidence pinned to v1; real data: 0 basic-stat diffs, 0 unexpected/unknown semantic diffs, fingerprints idempotent, shared-match v1 exact, rank unchanged; high-level availability v1 → v2: Community Score 0 → 5/9, Current Strength 0 → 6/9, Recent Form 0 → 2/9, Progress 0 → 8/9; static parity full 1 301/1 301 + 100/100; full suite 895 pass — see docs/EVENT_METRICS_V2_ROLLOUT.md |
| TASK-SCORING-INTERNAL-STRENGTH-01 community internal strength | COMPLETE / OUTCOME_B / ACCEPTED (SDD 2026-10-08) — originally PHASE A COMPLETE / OUTCOME_B / AWAITING SDD REVIEW (2026-10-08): canonical event-metrics-v1 evidence table + chronological match-level holdout (70/30 and 4 forward-chaining blocks; target = later shared-match-rating-v1 unit outcomes); Community Score / Current Strength / Recent Form / Progress unavailable for 9/9 members canonically (event dims fail closed); Shared-Match, Firepower, ACS, ADR, K/D are one signal at member level (ρ ≈ 0.9–1.0); all transparent candidates 0.74–0.78 pooled (SE ≈ 0.022); rank, Shared-Match and recency ablations not material (consensus+rank p = 0.052, n.s. after multiplicity); `community-internal-strength-v1` NOT implemented; interim: shared-match-rating-v1 alone is the most defensible representation — see docs/INTERNAL_STRENGTH.md |
| TASK-SCORING-SHARED-MATCH-02 shared-match v2 evaluation | COMPLETE / OUTCOME_B / ACCEPTED (SDD 2026-10-08) — originally PHASE A COMPLETE / OUTCOME_B / AWAITING SDD REVIEW (2026-10-08): one candidate-audit framework over event-metrics-v2 evidence (private/offline only); the pair-consistent single-match profile removes saturation (51 % → 0 %) and the within-member Duelist effect (−0.15 → −0.01 σ) and is slightly more stable, but noise/separation are not better, availability is 3 points lower and same-role sensitivity did not improve (12.0 vs 11.5, both 4.6 above the sampling floor); v1 "Duelist bias" is mostly member composition; shared-match-rating-v2 NOT implemented; v1 unchanged and reproduced exactly — see docs/SHARED_MATCH_RATING_V2.md |
| TASK-ANALYTICS-EVENT-RECONSTRUCTION-ROBUSTNESS-01 complex round topology | COMPLETE / OUTCOME_A / ACCEPTED (SDD 2026-10-08): event-metrics-v2 + round-topology-v1 on the same EventMetricEngine (v1 stays the default and canonical runtime; v2 is selected explicitly); self/environmental and team kills are deaths only; revives and recorded-dead kills use a three-valued life timeline; KAST/Opening/Trade from opponent kills; Clutch/Impact decided only when all interpretations agree; real data 45 → 547 KAST/Opening/Trade matches, 45 → 272 full-metric; true ambiguity 0; v1-complete member-matches 243/246 identical (3 = one friendly-fire match); canonical adoption of v2 is a separate rollout — see docs/EVENT_RECONSTRUCTION_ROBUSTNESS.md |
| TASK-SCORING-SHARED-MATCH-01 shared-match relative rating (Competitive + Unrated, within-match) | COMPLETE / ACCEPTED (SDD 2026-10-08; role-bias wording corrected: between-member 0.66 vs within-member −0.15, composition-confounded): shared-match-evidence-v1 + shared-match-rating-v1 (local, private staging; canonical projection reused; 0 provider requests); 36/36 pairs evidenced (min 14), 1 341 units (all same-team), 1 069 scorable; signal = one-match community-score-v2 Firepower (event-metric dimensions only ~3–5 % available: engine fails closed on revive/posthumous rounds); neutral 0.2σ, ±2σ winsorization, n/(n+8) shrinkage, Competitive/Unrated/recent-30 views; rank context only; residual role bias documented — see docs/SHARED_MATCH_RATING.md. Never multiply by rank; not the final Internal Strength |
| TASK-DATA-BULK-01C Phase-2 DATABASE_ERROR diagnosis | DIAGNOSIS BLOCKED BY OBSERVABILITY (superseded by 01D) |
| TASK-DATA-BULK-01D controlled reproduction | COMPLETE / ROOT CAUSE VERIFIED (2026-10-06): one POST → persist_sync_page / consenting_participant_absent; deterministic historical Riot-ID identity mismatch, not a DB fault — see docs/BULK_DATABASE_ERROR_DIAGNOSIS.md |
| TASK-DATA-HISTORICAL-IDENTITY-01 stable provider identity for historical matches | COMPLETE / ACCEPTED (2026-10-06; historical-identity-v1; no migration; durable-evidence-v2 unchanged; one acceptance POST → HTTP 200, cursor advanced, no sync_database_failure) — see docs/HISTORICAL_IDENTITY.md |
| TASK-DATA-03B.2D full-tracked analysis latency | COMPLETE / ACCEPTED (2026-10-06; full-tracked-aggregate-v1 over analysis-match-facts-v1, migration 0011, 672 matches hydrated; 6 constant statements; byte-identical output; production lifetime 5.28 → 2.78 s) — see docs/FULL_TRACKED_LATENCY.md |
| TASK-DATA-MODE-POLICY-01 mode eligibility | COMPLETE / ACCEPTED (2026-10-06): mode-eligibility-policy-v1; strength analytics Competitive only; Unrated = future same-match only; other modes browse-only; feature-scope-policy-v3, weapon-analytics-v2; formulas unchanged — see docs/MODE_ELIGIBILITY.md |
| TASK-DATA-RANK-01 rank ingestion | COMPLETE / ACCEPTED (SDD 2026-10-08) — (2026-10-07): private rank-staging-v1 (staging DB only; canonical rank_observations untouched); valorant-tier-order-v1 + rank-context-v1 resolveRankContextAt (in-match pre-match tier = exact; otherwise strictly-prior evidence; never peak/seasonal/future); 9/9 current + peak, 69 seasonal, 187 stored history (≈ 20/account, 2026-08-28+), 1 717 in-match snapshots (0 requests); 18 provider requests, 0 errors, max 6/60 s; Henrik `elo` = (tier_id−3)×100+RR (not MMR); rank is context, never a weight / multiplier / final score — see docs/RANK_EVIDENCE.md |
| DATA-04B Riot provider / RSO | DEFERRED |
| Riot ticket #139243830 | OPEN — informational / non-blocking |
| TASK-RELEASE-01 / V1 | PAUSED / NOT YET RELEASED (production SQL health check NOT VERIFIED is a release gate) |

The dated bullets below are a chronological log. Status words inside them describe the moment
they were written; lines marked **[SUPERSEDED]** must not be read as current state.

### Dated stage log

- TASK-DATA-POSITION-NORMALIZATION-01 (2026-10-08): spatial evidence is position-evidence-v1 (separate from durable-evidence-v2; never change metric inputs for it). Never export raw coordinates / view / side publicly, never interpolate snapshots into paths, never infer plant site or zones from coordinates, never derive side from the winner alone or half rules, never plot raw coordinates on map images (no validated transform). Read docs/POSITION_EVIDENCE.md first.

- TASK-RELEASE-BLOCKER-FIX-01 (2026-10-08): rules.
  - Every new player-attributable spatial column must be cleared by `RevocationDeletionService` (shared matches) in
    the same change, with a test in tests/revocationDeletion.test.ts.
  - Never vendor third-party agent skills (`.claude/skills/` and `skills-lock.json` are git-ignored).
  - Never push the development history directly. Release via a clean branch from origin/main plus a squash of the
    tagged tree.
  - Read docs/LOCAL_RELEASE_CHECKPOINT.md §13 first.
- TASK-ANALYTICS-TEAM-COMPOSITION-02 (2026-10-08): team-composition-v2 never changes the V1 assignment, Team Fit or V1 confidence.
  - Emit only labels allowed by `V2_VALIDATION` (holdout-validated rates).
  - Never emit a site tendency, callout, sub-region, path, exact position or real-time instruction.
  - Changing the gate needs new chronological holdout evidence.
  - Site references stay private (raw space, per map). Never assume `kill.location` is the victim's position.
  - Read docs/TEAM_COMPOSITION_V2.md first.
- TASK-ANALYTICS-TEAM-COMPOSITION-01 (2026-10-08): Team Composition output is HISTORICAL FIT, never a proven best composition, win probability, position / site / route claim or live opponent scouting. Never score map, pair synergy or role distribution in team-composition-v1 without new holdout evidence; never recommend an unseen or unknown agent except as a labelled EXPERIMENTAL fallback; never feed rank or Shared-Match into the assignment. Read docs/TEAM_COMPOSITION.md first.

- TASK-DATA-AGENT-CATALOG-01 (2026-10-08): agent roles come ONLY from `src/utils/agentRoles.ts` (agent-catalog-v1, stable agent content id first). Never guess or infer a role (add agents only from an authoritative Riot source), never alias the provider placeholder "Unknown", never add a fallback role, never extend `AGENT_ROLES_CATALOG_V0` (frozen for shared-match-evidence-v1). Run `npm run agents:check` / `checkAgentCatalog` after new data. Read docs/AGENT_CATALOG.md first.

- TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01 (2026-10-08): the canonical event engine is ONLY `CANONICAL_EVENT_METRIC_RULE_VERSION` (server/metrics/eventMetricEngine.ts). Never mutate event-metrics-v1 semantics (rollback engine). Facts are keyed by the engine that wrote them (`analysisFactsEngineKey`); never write facts under another engine's key. shared-match-evidence-v1 is pinned to v1. Public rollout (push → Vercel hydration → static re-export/publication) needs a separate SDD gate. Read docs/EVENT_METRICS_V2_ROLLOUT.md first.

- TASK-DATA-BULK-01E (2026-10-06): 2 lanes / 6 RPM is the validated bulk rate; never raise it without a separate rate experiment. Do not run more Bulk before a stored_index efficiency task (the stored index mostly re-reads already-durable matches). sourceExhausted is never lifetime completeness.
- TASK-DATA-03B.2D (2026-10-06): full-population analysis must stay constant-statement. Rules:
  - `analysis_participant_facts` (analysis-match-facts-v1) holds only the exact output of `reconstructMatchFacts`
    (server/dataset/matchAssembly.ts, THE per-match projection). Never store scores, identifiers or member aggregates there.
  - Every durable match write must refresh facts in the same transaction (`upsertMatch` → `refreshAnalysisFacts`).
  - Bump `ANALYSIS_FACTS_VERSION` on any fact-contract change; the engine key already includes event-metrics and normalization versions.
  - A non-fresh fact is never trusted: that match is reconstructed from raw evidence. Never fall back to a sample or a cap.
  - Read docs/FULL_TRACKED_LATENCY.md first.
- TASK-DATA-HISTORICAL-IDENTITY-01 (2026-10-06): identify the consenting participant ONLY by `providerIdentityHmac('HenrikDev', affinity, players[].puuid)` == the exact account's `provider_identities.lookup_hmac` (exactly one per match). Never use Riot name/tag as identity, never persist raw PUUIDs, never add rename aliases, and never use `participantHmac` for cross-match identity. Identity failures are MALFORMED_RESPONSE, never DATABASE_ERROR. Read docs/HISTORICAL_IDENTITY.md first.
- TASK-DATA-BULK-01D (2026-10-06): the Phase-2 DATABASE_ERROR is VERIFIED to be `consenting_participant_absent`, a historical Riot-ID identity mismatch. Never treat it as a DB fault, retry it, or resume bulk before TASK-DATA-HISTORICAL-IDENTITY-01.
- TASK-DATA-BULK-01C (2026-10-06): rules.
  - DATABASE_ERROR from sync is NOT necessarily a database fault. `persistSyncPage` failures, including
    `ConsentingParticipantAbsentError`, are relabelled, and the page commits per match.
  - Read `sync_database_failure` logs (database-failure-stage-v1, labels only) before diagnosing.
  - Never retry the failed run, reset its cursor or resume bulk without explicit authorization.

- TASK-DATA-MODE-POLICY-01 (2026-10-06, SDD STRICT): rules.
  - Queue rules live ONLY in `src/analytics/modeEligibility.ts` (mode-eligibility-policy-v1).
  - Every "how good is this person?" metric, score, ranking, map/agent/role/Act/weapon/progress/current/recent/trend value
    and duo-synergy-v1 uses **Competitive only**.
  - Unrated may only feed future within-the-same-match comparisons, never cross-match per-player aggregates.
  - Premier, Custom, entertainment and unknown modes are browse-only; fail closed, with no fuzzy rule.
  - An explicit ineligible mode never computes.
  - Never filter storage, acquisition or history browsing by mode.
  - New eligible modes need explicit product authorization. Read docs/MODE_ELIGIBILITY.md first.

- TASK-DATA-PERFORMANCE-SCORE-01 (2026-10-06, SDD STRICT): rules.
  - Never treat Henrik `stats.score` as Performance Score, and never reuse `match_participants.score` for it.
  - Never approximate or reconstruct the official score, and never set missing values to 0.
  - Never feed Performance Score into community-score-v2, Progress or Synergy without a separate scoring task.
  - The provider audit stays production-disabled; the `performance-score` mode is shape-only (≤ 2 logical requests).
  - Re-run the shape audit before trusting any provider release that changes match-player stats.
  - Read docs/PERFORMANCE_SCORE.md first.

- TASK-DATA-03B.2C (2026-10-06, SDD STRICT) — COMPLETE / ACCEPTED. Rules:
  - The REAL website has NO match-count product ceiling.
  - `datasetWindowSize=300` is a transport bootstrap only. Never use it, or `boundedMatchLimit`, as an
    analytics or history population.
  - `view=analysis` is `server-analysis-v2`. It aggregates the FULL feature population server-side in
    chunks, with the same src/ functions (`selection-summary-v1`, duo-synergy-v1), and ships only
    aggregates plus bounded-window matches.
  - Never reintroduce a population cap, sample 全部已追蹤, load all history into the browser, or mark
    `populationComplete` true without full evidence.
  - Filter options and Dashboard counts come from all-tracked `view=analytics` facets (identifier-free).
  - Read docs/FULL_TRACKED_ANALYTICS.md before changing analytics populations or payloads.

- TASK-DATA-BULK-01 (2026-10-06, SDD STRICT): `bulk-history-v1` = `npm run history:bulk` (scripts/bulk-history.ts,
  scripts/bulk/). Rules:
  - Local maintainer controller only. It calls only the existing public dataset and sync start/continue/status routes.
  - Never add secrets, DB access, provider calls, admin or bulk endpoints, new functions, or raised rate limits.
  - Never import it from src/api/server/shared.
  - Plan mode (0 POSTs) is the default. Execute needs a selector and a finite --max-provider-requests.
  - ≤ 2 lanes, never two requests per account, ≤ 8 provider requests per minute.
  - Never run the full crawl or leave a worker running without explicit authorization. Read docs/BULK_HISTORY.md first.

- TASK-SECURITY-02 (2026-10-06): never reuse a SEC record beyond its exact findings. Every advisory maps to FIXED,
  TEMPORARILY ACCEPTED (exact SEC id) or BLOCKING. Production audit must stay 0. Never force-fix, override, patch
  node_modules or suppress audit output. A Tailwind 4 migration needs TASK-SECURITY-03 authorization.

- TASK-WEAPON-01.1 COMPLETE / ACCEPTED (2026-10-06): `weapon-catalog-v2` adds Warden as a Rifle firearm (Riot
  VALORANT Patch Notes 13.06). Classification only: never change weapon-analytics-v1 formulas or durable evidence
  for catalog fixes, never guess provider weapon ids, and keep unknown names and abilities as Other. Bump the
  catalog version for any classification change.

- TASK-WEAPON-01 COMPLETE / ACCEPTED (2026-10-06, SDD STRICT): `view=analysis&feature=weaponAnalytics`
  (same function). Two separate evidence domains: round weapon observation (`round_participants.weapon_*`)
  and kill weapon (`kill_events.weapon_*`); never publish cross-domain efficiency or per-weapon
  HS%/ADR/damage/accuracy/attack-defense (no durable evidence). Member-level union across eligible accounts
  via the shared `activePlayers`; collisions withheld. ALL TRACKED/ACT = aggregate SQL over all eligible
  history (no snapshot, no 2000 cap); CURRENT = currentStrength selection. Descriptive only — never feed
  scores/Progress/Synergy without a separate authorized task. Read docs/WEAPON_ANALYTICS.md first.

- TASK-IDENTITY-01B COMPLETE / ACCEPTED (2026-10-06): the 9 approved community names were applied by the
  one-time fail-closed data migration 0010 through the normal Vercel migration path; DATABASE_URL was
  never retrieved. Never re-apply names in build logic; later edits use `member:admin`.
- TASK-IDENTITY-01B (2026-10-06, SDD STRICT): `members.display_name` = primary community name;
  `members.nickname` = optional second name of the PERSON (NULL = unset, never ''). The Riot
  `GameName#Tag` stays on the account. Names are presentation only: never ids, routes, analytics
  keys or sort keys.
  - Schema 6 / `member-identity-v2`, migration 0009.
  - All edits are maintainer-only via `npm run member:admin`; never add a public edit endpoint.
  - The approved name mapping lives in `ops/community-names-2026-10-06.json`; apply it only with
    `plan-names` then `apply-names --confirm`, using exact matching.
  - Never invent nicknames. Read docs/MEMBER_IDENTITY.md (naming model) first.

- TASK-IDENTITY-01 COMPLETE / ACCEPTED (2026-10-06, SDD STRICT): public `Player` = MEMBER (person);
  `players` rows are Riot ACCOUNTS. Human fact: the 9 current accounts are 9 different people.
  Never merge them and never infer alts; there is no heuristic linking.
  - Migration 0008 is append-only: deterministic 1:1 backfill reusing account ids/public ids, plus
    a BEFORE INSERT trigger that gives each new account its own member.
  - Consent, provider identities, sync (including FASTSYNC), deletion and match participants stay
    account-scoped; analytics merge member evidence before scoping/scoring.
  - Schema 5 / `member-identity-v1`. Same-match member collisions are withheld, never summed.
  - Account linking is maintainer-only (`npm run member:admin`, `--confirm`) and fails closed on
    coappearance. Never add a public admin API or a member picker on Connect.
  - Member names are `legacy_account` until the maintainer assigns community names
    (TASK-IDENTITY-01B); a Riot rename never changes a member name.
  Read docs/MEMBER_IDENTITY.md before changing identity, visibility or aggregation.

- TASK-DATA-FASTSYNC-01 COMPLETE / ACCEPTED (2026-10-06, SDD STRICT): `recent-refresh-v1`.
  `POST /api/valorant/sync/start` with `intent: refresh_if_stale` (incremental only; no new
  function). Freshness is the incremental cursor's `last_success_at`; the server-only 30-minute
  threshold is never client-supplied. Leases, backoff and consent stay authoritative, and the
  cursor version is re-checked under the lease row lock (race-safe). At most one chunk per action,
  page size 3; paused runs continue without the cooldown. The Profile auto-refreshes once per
  player per tab plus a manual 更新戰績 button; only Profile triggers it, never Dashboard,
  Leaderboard or Matches. Demo has no control and no API calls. Cron schedules are unchanged
  (daily). No migration; `trigger_kind` stays `manual`. Read docs/FAST_RECENT_SYNC.md before
  changing it.

- TASK-PROGRESS-01 COMPLETE / ACCEPTED (2026-10-06, SDD STRICT): `improvement-index-v1` /
  `improvement-benchmarks-v1` / `feature-scope-policy-v2`. Profile-only signed −100..+100
  progress metric via `view=analysis&feature=improvementIndex`; separate confidence; overall
  confidence < 0.25 shows no value or direction. Rank is optional and never fabricated. It never
  reorders the ranking, and Score/Synergy formulas are unchanged. No migration; nothing persisted.
  Cross-Act fallback is fixture-verified only. Read docs/PROGRESS_INDEX.md before changing it.

- TASK-DATA-03B.2B COMPLETE / ACCEPTED (2026-10-05, SDD STRICT): analytics pages consume
  `GET /api/valorant/dataset?view=analysis` (`server-analysis-v1`). Clients declare only a
  feature plus context. The server runs the SAME src/ scope engine over ALL eligible durable
  history (phase 1 lightweight observations, phase 2 full projection for selected matches only)
  and the browser runs the unchanged scoring/Synergy code. The newest-300 snapshot stays the
  bootstrap but is not an analytics boundary. Never let a failed analysis request substitute
  another scope. LIFETIME/ACT/PAIR phase 2 is capped at 2000 with a disclosed reason. Read
  docs/SERVER_ANALYTICS.md before changing analysis populations. TASK-PROGRESS-01 is DESIGN ONLY [SUPERSEDED: COMPLETE / ACCEPTED, see status table];
  TASK-DATA-RANK-01 is NOT STARTED.

- TASK-DATA-SEASON-01 COMPLETE / ACCEPTED (2026-10-05, SDD STRICT): match season evidence from Henrik v4
  `metadata.season` / Stored `meta.season` is normalized and persisted to existing
  `source_matches.season_id/season_short` (no migration). Missing/invalid never erases; a valid
  later value corrects. `season_id` is server-only; the browser gets only a recognized public
  `seasonKey`. Stored rows may fill season ONLY for already durable, participant, consented
  matches. Never claim the current official Act. Read docs/SEASON_EVIDENCE.md before changing
  season handling. [SUPERSEDED: at that time TASK-DATA-RANK-01, TASK-PROGRESS-01 and DATA-03B.2B were NOT STARTED; see status table.]

- TASK-DATA-03B.2 (2026-10-05, SDD STRICT) is redefined as the **Context-Aware
  Analytics Scope Engine**; the earlier "all-history analytics" definition is
  superseded. DATA-03B.2A is COMPLETE: `analysis-scope-v1`, `feature-scope-policy-v1`
  (single registry in `src/analytics/scope/policies.ts`), deterministic
  `adaptive-window-v1`, and `view=analytics` aggregate facts. Pages never select windows
  themselves: everything goes through `selectPerformances` -> `resolveScopeSelection`.
  Score pages default to 目前實力 (adaptive, Competitive); maps/agents/matches default to
  全部已追蹤. No fallback across horizons. [SUPERSEDED: Act evidence was UNAVAILABLE at that time; TASK-DATA-SEASON-01 now persists it.] Rank is UNAVAILABLE (never ingested). Do not guess Acts, hardcode season
  dates, claim the current official Act, or invent rank. [SUPERSEDED: DATA-03B.2B, TASK-DATA-SEASON-01 and TASK-PROGRESS-01 have since been authorized; see status table.]
  TASK-DATA-RANK-01 is NOT STARTED and needs explicit authorization. Score/Synergy formulas are unchanged. Read docs/ANALYTICS_SCOPES.md
  before changing any analytical population. DATA-03B.1 COMPLETE / ACCEPTED.

- TASK-DATA-03B.1 (2026-10-05, SDD STRICT): bounded keyset history runtime is
  implemented as `GET /api/valorant/dataset?view=history` (`dataset-history-v1`,
  same function — 12-function Hobby limit). Default schema 4 newest-300 snapshot is
  unchanged. Signed position-only cursor; every page re-evaluates current consent;
  `trackedMatchCount` = eligible durable matches, never Riot lifetime;
  lifetimeComplete=false. History is BROWSE-ONLY on the Matches page. [SUPERSEDED: analytics now use server
  history via DATA-03B.2B, not the newest-300 snapshot.] No migration. Read docs/TASK_DATA_03B_PLAN.md before changing
  history pagination. DATA-05A remains PRODUCTION ACTIVATED / ACCEPTED.

- DATA-05A activation continuation: existing Vercel CLI/project authentication
  verified; production-only sensitive CRON_SECRET configured. Nine public players
  are maintainer-confirmed expected activity. Daily cron registration/canaries
  are verified: both one-shot canaries passed; DATA-05A is PRODUCTION ACTIVATED /
  ACCEPTED. Recurring eligible consenting-player acquisition is authorized.
  Sources 50→56, provider requests +2; lifetimeComplete=false. No Riot/RSO or V1 release.
  [SUPERSEDED: "No DATA-03B" — DATA-03B.1/2A/2B have since completed.] See docs/PERSISTENT_SYNC.md for evidence/limitations.

- Superseding human decision (2026-10-05): TASK-DATA-05A is ACTIVE — Tracker-style persistent scheduled sync. Maximize and retain observable Henrik history subject to consent/deletion; lifetimeComplete remains false. The Riot-response acquisition freeze below is historical and superseded. Ticket #139243830 remains OPEN / informational / non-blocking; DATA-04B is DEFERRED / NOT REQUIRED FOR CURRENT PRODUCT PATH. DATA-03A resumes as acquisition infrastructure; DATA-03B NOT STARTED [SUPERSEDED: completed later]. RELEASE-01 PAUSED FOR DATA-05A / DATA-03B; V1 NOT YET RELEASED. See docs/PERSISTENT_SYNC.md and docs/TASK_DATA_05A_PLAN.md. Secure production CRON_SECRET plus one recent and one historical passing canary gate recurring operation; if safe secret setting is unavailable, stop before cron activation. No Riot/RSO/application, player recreation, deletion, scoring/Synergy change or release authorization.

### Superseded governance checkpoint

- Current governance decision (2026-10-04): TASK-DATA-04A is **WAITING ON RIOT — ticket #139243830**, status **OPEN — WAITING FOR RIOT RESPONSE**. TASK-DATA-04B is **BLOCKED ON DATA-04A**. TASK-RELEASE-01 is **PAUSED**; V1 is **NOT YET RELEASED**. Preserve the full lifetime-history requirement and existing evidence; research completion is not official clarification or access approval. See `docs/LIFETIME_HISTORY.md` and `docs/TASKS.md`.
- Until the Riot clarification and a new explicit human gate: do not resume Henrik deep crawl, implement DATA-03A.2, start DATA-03B, implement DATA-04B/Riot provider/RSO, submit another Production/RSO application, call Riot or Henrik APIs, or change production data. The support inquiry is not a Production/RSO application. This current freeze supersedes continuation permissions in historical checkpoints below.

### Historical checkpoints (not new execution authorization)

- DATA-03A implementation is complete, initial CI/Pages/Vercel deployment and normal-path migration 0007 verified. Final local gates: 339 tests, lint/build, 16 DB checks, production audit zero; full audit retains the five-high SEC-2026-001 disposition. This is NOT production deep-crawl acceptance: bounded/full provider execution remains gated and NOT STARTED. Deployment success never grants crawl approval.

- TASK-DATA-03A is authorized under SDD STRICT: implement/deploy `deep-history-v1`, separate `deep_backfill`, and append-only migration 0007 through the normal Vercel build path. Read `docs/DEEP_HISTORY.md` before changing this boundary. Preserve legacy cursors and migrations 0001–0006. Production deep start/continue, bounded provider validation and full P1/P2 crawl require a separate explicit human gate: DO NOT execute them on deployment. Production crawl NOT STARTED. Public schema 4/newest-300 read unchanged; TASK-DATA-03B NOT STARTED. RELEASE-01/01A PAUSED FOR DATA-03; V1 NOT YET RELEASED. Prior diagnosis and SEC-2026-001 are historical evidence, not release/repair/delete/crawl authorization. No scoring/Synergy change.

- TASK-RELEASE-01A.3 security disposition is complete under SEC-2026-001, but final production acceptance is ON HOLD: after its documentation push, read-only dataset GET showed two players / seventeen matches instead of the authorized one / ten. Cause NOT VERIFIED. This supersedes the historical one-player/ten-match state below. RELEASE-01A remains IN PROGRESS / ON HOLD until human confirmation and revised read-only acceptance scope. Do not repair, reimport, sync, delete or rerun production health SQL; no provider calls or data writes are authorized. No release level or v1.0.0. See `docs/RELEASE_V1.md`.

- TASK-SYNERGY-01 and TASK-UI-01 acceptance are COMPLETE. TASK-RELEASE-01A.2 Option A is COMPLETE: schema 4 / dataset-read-v4 / evidence-decoupled-projection-v1, historically Public REAL ready with one visible player and ten basic matches. KAST/Opening remained partial without values; event engine and scoring/Synergy formulas are unchanged. Read-only production relational, migration, consent, sync and deletion checks passed on 2026-10-03 for that historical fixture. TASK-RELEASE-01A.3 dispositions five unpatched dev/build-only high audit findings under SEC-2026-001; production audit is zero. Review expires 2026-11-03 or on an earlier upstream fix. See `docs/SECURITY_EXCEPTIONS.md` and TASK-SECURITY-01; re-evaluate changed advisory scope, imports, runtime promotion or input boundaries. Remote function-artifact bytes remain NOT VERIFIED; all application API closures show no affected dependency/input path. RELEASE-01 remains IN PROGRESS; V1 NOT YET RELEASED. Do not perform provider calls, writes, release levels or tags without new explicit authorization. Non-empty two-player Synergy remains NOT VERIFIED. Older checkpoint descriptions below are historical; see the acceptance hold above for the current fixture. See `docs/RELEASE_V1.md`.

- TASK-DATA-01A, TASK-DATA-01B, TASK-DATA-01C and TASK-DATA-02 are complete. TASK-METRICS-01 is complete; migration 0006, CI and deployments are verified. The non-empty production advanced-metric path remains NOT VERIFIED. Vercel is the PUBLIC REAL canonical runtime: exact server-only `REAL_DATASET_READ_MODE=public` exposes only the bounded sanitized dataset without viewer authentication; every other value fails closed. GitHub Pages remains Demo-only. Current public consent policy is `2026-10-02-public-v1` from `shared/privacyPolicy.ts`; only an active `self_asserted` consent on that exact version authorizes provider writes or public visibility. The explicitly approved DATA-01C validation revoked and deleted the former production test player on 2026-10-01; do not repeat that operation or infer approval for another player. Any future destructive revocation still requires the explicit human approval gate in `docs/REVOCATION_AND_DELETION.md`. TASK-METRICS-01 introduced `event-metrics-v1`, `durable-evidence-v2`, public schema 2 and migration `0006`, but no new score or weight. TASK-002B is explicitly authorized and implementation is complete: community-score-v2, community-benchmarks-v1, overall-profile-v1. Preserve evidence-aware missing/partial semantics and aggregate-only traces. TASK-SYNERGY-01 is explicitly authorized and implemented; release acceptance is recorded in docs/TASK_SYNERGY_01_PLAN.md. Public schema is now 3 / dataset-read-v3 / synergy-ready-projection-v1. duo-synergy-v1 and duo-synergy-benchmarks-v1 remain separate pair-level association, not a ninth dimension. Non-empty production Synergy is NOT YET EXERCISED; no new migration, provider call or player reconnect. Read docs/SYNERGY.md before changing pair boundaries. Do not begin TASK-UI-01 implicitly. Read `docs/DATABASE.md`, `docs/HISTORICAL_SYNC.md`, `docs/REVOCATION_AND_DELETION.md`, `docs/REAL_DATA_FIELD_AUDIT.md`, `docs/DATASET_RUNTIME.md`, `docs/METRICS_RECONSTRUCTION.md`, `docs/CODE_MAP.md`, `docs/PRODUCTION_ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/TASKS.md` before changing data, synchronization, provider, reconstruction or scoring boundaries.
- Keep `DATABASE_URL`, `IDENTIFIER_HMAC_KEY`, provider identifiers and raw match IDs server-only. Never run migrations from browser code or return database/provider identifiers through public APIs.
- A public player/job UUID never authorizes revocation or deletion. Keep consent-management plaintext only in the consenting browser, store only the domain-separated HMAC server-side, and never put the credential in URLs, logs, Git or completion reports.
- Never treat stored-match results as complete lifetime history. Persist coverage windows, evidence availability and derivation versions explicitly.
- Keep display rounding in `src/utils/format.ts` and `src/analytics/presentation.ts`; do not reduce calculation precision to format UI values.
- Stay within the requested task. Record later ideas under the roadmap instead of silently expanding scope.
