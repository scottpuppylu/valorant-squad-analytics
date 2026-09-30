# Development tasks

## Task 000 — repository and Codex setup

- [x] Initialize a Git repository with `main` as the default branch.
- [x] Add README, Node ignore rules, line-ending rules, project brief, and roadmap.
- [x] Add repository-level Codex instructions.
- [x] Add conservative project-scoped Codex defaults.
- [x] Create and connect the public GitHub repository.
- [x] Push the initial commit.

## Task 001 — application scaffold

Create the V1 application skeleton with React, TypeScript, Vite, Tailwind CSS, Recharts, Vitest, and npm.

Required outcomes:

- [x] Establish the folder structure described in `docs/PROJECT_BRIEF.md`.
- [x] Create realistic demo data for eight fictional players and at least thirty matches.
- [x] Implement responsive navigation, a first dashboard, and a first leaderboard.
- [x] Add placeholder routes for all planned V1 pages.
- [x] Add `docs/SCORING.md` and `docs/DATA_MODEL.md`.
- [x] Configure linting, unit tests, CI, and GitHub Pages deployment.
- [x] Ensure the Vite base path works under `/valorant-squad-analytics/`.
- [x] Verify `npm run lint`, `npm test`, and `npm run build`.

Do not implement the full scoring engine during this task. Use clearly labeled initial calculations or fixtures and leave advanced scoring for Task 002.

## Task 002A — usability and official API readiness

Status: **COMPLETE**

- [x] Convert user-facing application text to Taiwan Traditional Chinese.
- [x] Prototype browser-local image avatar behavior (subsequently retired and replaced by emoji identity in TASK-002A.1).
- [x] Add a typed, searchable and filterable metric dictionary.
- [x] Research official VALORANT endpoints and DTO capabilities.
- [x] Add About, Privacy and documented Connect Riot readiness flows; the unfinished connection page is now hidden from the public product.
- [x] Add Demo/Riot data-source boundaries without network requests or credentials.

## Task 002A.1 — emoji identity and real-data evidence spike

Status: **PARTIALLY COMPLETE / CLOSED FOR NOW**

- [x] Replace uploaded image avatars with one default emoji per player and one browser-local override.
- [x] Add an accessible Chinese emoji picker with immediate app-wide updates, refresh persistence and reset.
- [x] Remove image validation, resizing, blob display and IndexedDB dependencies from the active product path.
- [x] Add a typed HenrikDev v4 schema summarizer and a local consent/key-gated probe command.
- [x] Prepare the provider/proxy boundary without connecting it to the deployed application.
- [x] Record provider policy, documented schema possibilities and privacy limits without treating them as live verification.

Real account validation, match retrieval, field auditing and capability comparison moved forward into `TASK-API-02`. The deployed GitHub Pages application remains on deterministic fictional data while the Vercel production path is being established.

## Task API-01 — real third-party data validation

Status: **SUPERSEDED BY TASK-API-02**

- [ ] Obtain a Henrik API key through the provider's approved process.
- [ ] Use one explicitly consenting account and retrieve a small latest-match sample.
- [ ] Normalize the real response without committing identifiers, credentials or raw private payloads.
- [ ] Audit observed field coverage, nullability, queues, incomplete matches and reconstruction limits.
- [ ] Compare documented capability with observed capability and record unsupported analytics honestly.

The local `.env` probe remains useful only as historical diagnostic scaffolding. It is not the intended player experience and does not satisfy production integration.

## Task API-02 — production data connection architecture

Status: **COMPLETE**

- [x] Select Vercel full deployment and document alternatives, rollback, privacy and secret boundaries.
- [x] Create and push the `checkpoint-pages-before-api-02` rollback tag.
- [x] Add same-origin provider status, account resolution and bounded match-import server routes.
- [x] Add Taiwan Traditional Chinese `#/connect` UX with explicit consent and no credential fields.
- [x] Normalize provider responses without returning PUUIDs, raw match IDs or raw payloads.
- [x] Keep demo and real datasets explicitly separate and removable.
- [x] Add security, API, normalization and storage tests using mocks only.
- [x] Deploy the full application to Vercel while retaining GitHub Pages.
- [x] Configure a server-only production credential through Vercel environment settings.
- [x] Resolve one consenting account and complete a bounded real-data import.
- [x] Keep provider credentials, PUUIDs, raw match IDs and raw payloads out of browser responses and Git.

TASK-API-02 does not include TASK-002B, Synergy, a scoring rewrite, a database, or provider credential issuance.

## Task API-02.1 — live evidence audit, presentation fix and architecture rebase

Status: **COMPLETE — SDD STRICT**

- [x] Create and push `checkpoint-before-api-02-1-audit` before implementation.
- [x] Run one consent-gated, bounded and sanitized provider audit without retaining player or match identifiers.
- [x] Observe v4 history, match detail, stored matches, current MMR, MMR history and adjacent history windows.
- [x] Classify direct, derivable, reconstructable, partial and unavailable analytics in `docs/REAL_DATA_FIELD_AUDIT.md`.
- [x] Record the stored-match and lifetime-completeness limitations.
- [x] Centralize display rounding for scores, ACS, ADR, ratios, percentages, counts and credits without changing internal precision.
- [x] Add missing/null, sanitized summarizer and numeric-presentation tests.
- [x] Document the current runtime, future Neon schema, backfill, incremental sync, revocation and dataset-runtime boundaries.

TASK-API-02.1 does not implement a database, scheduled sync, new scoring formulas, TASK-002B or Synergy.

## Task DATA-01A — durable database and consent foundation

Status: **IMPLEMENTED LOCALLY / PRODUCTION VALIDATION PENDING**

- [x] Add deterministic Neon-compatible migrations for squad, player, membership, consent, match, participant, round, event, economy, rank, sync and deletion foundations.
- [x] Add server-only keyed identifier protection, match-scoped non-member pseudonyms and independent public application IDs.
- [x] Add accurate `self_asserted` consent semantics and a schema path for future `riot_rso_verified` consent.
- [x] Add normalized, idempotent, one-match transactional persistence with database constraints and disposable Postgres tests.
- [x] Disable the provider evidence audit endpoint in production and extend the client secret-boundary scan.
- [ ] Configure Neon in the production Vercel project, apply migration `0001`, and complete the bounded production row-count test.

The browser-local REAL envelope remains the active frontend runtime. The foundation does not calculate final event metrics or change scoring.

## Task DATA-01B — bounded historical backfill

Status: **NOT STARTED**

Implement bounded newest-to-oldest pagination, coverage windows, retry/cursor semantics and distributed coordination. Do not infer lifetime completeness from stored matches.

## Task DATA-01C — revocation and deletion execution

Status: **NOT STARTED**

Implement consent revocation, sync blocking, idempotent deletion jobs, unlinking/anonymization, retention enforcement and auditable completion counts.

## Task DATA-02 — dataset runtime rebase

Status: **NOT STARTED**

Replace browser-local REAL as the production source of truth only after the durable read API, authorization and deletion evidence are ready.

## Task 002B — evidence-aware scoring correctness

Status: **DEFERRED / NOT STARTED**

TASK-002B does not depend on live API completion. It may use the current deterministic demo evidence while keeping formulas transparent, representing unavailable evidence explicitly and avoiding claims about unverified real-provider coverage.

The next scoring task must address all audit findings before adding new dimensions:

- missing category evidence currently becomes the numeric score 50 and is indistinguishable from measured neutral performance;
- optional first-kill/death and clutch totals can use partial observations while their derived denominators still cover all rounds/matches;
- one observed match can produce a perfect Consistency score because measured dispersion is zero;
- tiny clutch samples can produce overly strong scores without shrinkage or a minimum sample rule;
- score results do not provide component-level calculation traces;
- role benchmarks are prototype constants without a versioned calibration source;
- aggregate values are rounded before scoring, losing precision;
- Teamplay currently includes a significant 25% Win Rate contribution.

Required outcome: a transparent, role-aware, evidence-coverage-aware eight-dimension engine for Firepower, Round Impact, Entry, Teamplay, Clutch, Economy, Consistency and Role Value. Confidence remains separate from performance.

## Task 003 — cross ranking, comparison and contextual analysis

Status: **COMPLETE**

By explicit user decision, TASK-003 was executed before TASK-002B. It consumes the current prototype scoring engine only through aggregation/scoring interfaces; the future correctness work can replace that implementation without rewriting the analytical pages.

- [x] Derive provider-independent player-match performance entries from the normalized dataset.
- [x] Add composable player, period, custom date, map, agent, role, game-mode and sample filters.
- [x] Define recent 10/30 as each player's most recent eligible appearances after contextual filtering.
- [x] Add URL-shareable leaderboard metric, sort and filter state with safe empty/sample states.
- [x] Add 2–4 player comparison with radar, raw metrics and computed relative strengths.
- [x] Add map and agent/role summaries, rankings and score profiles.
- [x] Add paginated demo match history with expandable participating-player performance.
- [x] Enhance player profiles with filtered map/agent splits, recent form and sample-aware map extremes.
- [x] Add eight computed badges with explicit metric, sample and tie rules.
- [x] Keep HashRouter and repository-subpath GitHub Pages compatibility.
- [x] Add domain tests and browser verification for desktop and mobile flows.

## Later roadmap

- Task 004: teammate synergy matrix and Duo Synergy page
- Task 005: impact kills and trade analysis
- Task 006: clutch engine
- Task 007: economy analysis
- Task 008: advanced UI refinement
- Task 009: CSV and JSON import
- Task 010: GitHub Pages v1.0 release
- Official Riot integration: application readiness is now documented early, but live production player data remains dependent on Production API approval, RSO access and a secure backend.
