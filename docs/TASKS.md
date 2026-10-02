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

Status: **COMPLETE**

- [x] Add deterministic Neon-compatible migrations for squad, player, membership, consent, match, participant, round, event, economy, rank, sync and deletion foundations.
- [x] Add server-only keyed identifier protection, match-scoped non-member pseudonyms and independent public application IDs.
- [x] Add accurate `self_asserted` consent semantics and a schema path for future `riot_rso_verified` consent.
- [x] Add normalized, idempotent, one-match transactional persistence with database constraints and disposable Postgres tests.
- [x] Disable the provider evidence audit endpoint in production and extend the client secret-boundary scan.
- [x] Configure Neon in the production Vercel project, apply migration `0001`, and complete the bounded production row-count and idempotency test.

Production validation used one explicitly consenting account and one match. Set-based persistence completed in 5.617 seconds on the first write and 5.041 seconds on the identical second write, using 15 SQL statements including transaction control. Aggregate evidence counts were unchanged after the second write. The tested provider response supplied 177 kill locations but no per-player event-location rows; this absence remains explicit rather than fabricated.

At DATA-01A completion the browser-local REAL envelope remained active; DATA-02A later retired it. The foundation itself did not calculate final event metrics or change scoring.

## Task DATA-01B — bounded historical backfill

Status: **COMPLETE — SDD STRICT**

- [x] Add migration `0002_bounded_historical_sync.sql` without changing applied migration `0001`.
- [x] Add bounded v4 `size/start` backfill with one three-match provider page per invocation and a 25-second useful-work budget.
- [x] Persist explicit run/cursor state, coverage, retries, safe error classes and deterministic termination reasons.
- [x] Add a 45-second expiring per-player Postgres lease so only one invocation can advance a cursor.
- [x] Advance the cursor only after each match page commits; retain earlier pages when a later page fails.
- [x] Add provider-aware 429/backoff behavior and no infinite retries.
- [x] Add newest-overlap incremental sync that stops on the first known durable boundary.
- [x] Keep raw payloads in memory only, public APIs on application UUIDs, and HMAC/provider identifiers server-only.
- [x] Add Chinese connect-page controls for starting, resuming and checking durable sync status while keeping analytics browser-local.
- [x] Validate production with the existing consenting player only.

The production backfill executed 54 chunks and 54 provider requests, observed 159 match responses, updated six overlaps, retried zero times and terminated on an empty page. Its safely reported provider window spans 2025-01-25 through 2026-09-28. The incremental run fetched one three-match page, updated three overlaps and terminated on the known boundary. These dates describe only what the unofficial provider returned at validation time; they do not prove complete Riot lifetime history. See `docs/HISTORICAL_SYNC.md`.

Rank/MMR history synchronization is **NOT IMPLEMENTED**. The observed provider schema does not provide a separately verified bounded pagination contract suitable for the same durable state machine, and match-history completion does not depend on it.

## Task DATA-01C — revocation and deletion execution

Status: **COMPLETE — SDD STRICT**

- [x] Add immutable migration `0003_consent_revocation_deletion.sql` without changing `0001` or `0002`.
- [x] Issue a one-time, high-entropy browser management credential for new consent and persist only its domain-separated HMAC.
- [x] Require constant-time credential verification for revoke, continue and status; public UUIDs alone do not authorize deletion.
- [x] Atomically revoke consent, deactivate membership, cancel active/paused sync, release cursor leases and create/reuse the deletion job.
- [x] Block manual import, historical/incremental sync and reconnect while a revoked deletion is open, before provider access.
- [x] Add bounded, leased, idempotent and resumable deletion stages with safe aggregate progress.
- [x] Delete exclusive matches; unlink and minimize the revoked participant while retaining anonymous event topology in shared matches.
- [x] Remove rank rows, provider identity, membership, consent and sync cursor; anonymize safe sync-run aggregates and player PII.
- [x] Add Chinese two-step revocation UX; clear the browser REAL dataset immediately after acceptance while retaining a deletion-only credential/job session until server completion.
- [x] Restore pending deletion across reload, expose status/continue controls, block provider flows locally and destroy the credential only after `complete`.
- [x] Rotate identity-derived event HMACs for affected shared-match kills while preserving anonymous event ordering and FK topology.
- [x] Add disposable PGlite tests for authorization, race behavior, exclusive/shared data, rank, crash rollback, stale lease, retries, re-consent and local cleanup.
- [x] Apply `0003` to production and perform non-destructive schema/API validation.
- [x] Obtain explicit human confirmation immediately before revoking the current production test player.
- [x] Execute and record the first production destructive revocation/deletion validation.

The approved 2026-10-01 production run used a short-lived operator-only endpoint that never entered Git history. The exact-one legacy-candidate gate passed, all four post-revocation provider paths stopped before fetch, and the real deletion service completed in three leased attempts. It removed 154 exclusive matches, one provider identity, one membership, two sync cursors and personal metadata from two sync runs; there were no shared matches or rank rows. Post-checks found no linked personal evidence, no sync residue and zero relational orphans. The temporary endpoint, three temporary Vercel secrets and local credential/response files were removed before a clean production redeploy. The original Chrome profile was then identified through its one-player/one-match REAL envelope; the product's `移除本機戰績並返回 Demo` action removed it, and refresh persistence plus Demo fallback were verified. See `docs/REVOCATION_AND_DELETION.md`.

## Task DATA-02 — dataset runtime rebase

Status: **COMPLETE — SDD STRICT**

### Task DATA-02A — durable read API and React dataset runtime foundation

Status: **COMPLETE — SDD STRICT**

- [x] Create and push `checkpoint-before-data-02a` at the verified DATA-01C HEAD.
- [x] Add immutable migration `0004_dataset_read_runtime.sql` with a stable browser-safe source-match public ID.
- [x] Add six-query, bounded `DatasetReadRepository` and browser-safe `DatasetProjectionService` boundaries.
- [x] Expose versioned `GET /api/valorant/dataset` with REAL reads disabled by default.
- [x] Limit the dataset to the most recent 300 eligible durable matches and state that it is not lifetime history.
- [x] Expose only non-anonymized players with active consent and active membership; never expose non-consenting identities or event topology.
- [x] Match the legacy projection for ACS, ADR, HS%, KAST, FK and FD without introducing later scoring dimensions.
- [x] Replace module-load/localStorage dataset selection with `DatasetProvider` states: loading, ready, stale, empty, error and demo.
- [x] Keep GitHub Pages intentionally Demo-only and Vercel disabled mode intentionally Demo; never merge Demo and REAL.
- [x] Retire the full browser REAL envelope from the active path and clean the legacy key without persisting server reads.
- [x] Add disposable migration, privacy, shared/revoked, parity, provider-state, route and bounded-performance tests.

DATA-02A prepared a fail-closed read path without deciding distribution. DATA-02B later selected PUBLIC REAL and enabled only the sanitized current-policy projection. See `docs/DATASET_RUNTIME.md`.

### Task DATA-02A.1 — evidence null semantics hardening

Status: **COMPLETE — SDD STRICT**

- [x] Omit a legacy-compatible performance when required stats, denominator or complete round-presence evidence is unavailable.
- [x] Omit matches with no usable visible performance and return `empty` when no usable match remains.
- [x] Keep a shared match when at least one active consenting member has complete evidence, without fabricating metrics for another incomplete member.
- [x] Preserve legitimate observed zero values for combat totals, ACS, ADR, HS%, KAST, FK and FD.
- [x] Treat nullable head/body/leg shot fields as missing evidence rather than silently converting them to zero.
- [x] Keep KAST/FK/FD evidence `partial` when an eligible candidate is omitted for incomplete round evidence.
- [x] Preserve schema version 1, snapshot content semantics and the existing legacy-normalizer parity fixture.
- [x] Add disposable database and route regression tests without adding or changing a migration.

This is a focused projection-correctness hardening. Migrations `0001`–`0004` remain immutable; DATA-02B later added the separate consent-governance migration `0005` without changing projection semantics.

### Task DATA-02B — visibility, distribution and revalidation policy

Status: **COMPLETE — SDD STRICT**

- [x] Adopt the explicit PUBLIC REAL decision with no login, password, access code, session, cookie or read credential.
- [x] Add the single browser-safe privacy version `2026-10-02-public-v1` and require it on every explicit connection request before provider access.
- [x] Add migration `0005_public_dataset_consent.sql` so each player has at most one active consent across policy versions.
- [x] Transactionally revoke an older active consent and create one current active consent only after explicit current-policy connection consent.
- [x] Require current-policy consent for manual import, historical/incremental sync, cursor lease/commit and public visibility.
- [x] Make exact `REAL_DATASET_READ_MODE=public` the only value enabling sanitized REAL reads; every other value fails closed.
- [x] Keep the public route same-origin, rate-limited and `Cache-Control: no-store` without broad CORS.
- [x] Keep GitHub Pages Demo-only and make Vercel the canonical PUBLIC REAL runtime.
- [x] Preserve the newest-300-match bound, DATA-02A.1 missing-evidence semantics and the existing sanitized schema 1 projection.
- [x] Update Chinese consent, Privacy and revocation copy for public publication and resumable deletion semantics.

The current production dataset is validly `empty` because DATA-01C deleted the former test player and no player was reconnected. Public non-empty production content path is **NOT YET EXERCISED AFTER DATA-01C DELETION**; disposable database tests validate current-policy visibility, obsolete-policy exclusion, revocation exclusion and sanitized serialization. TASK-METRICS-01 is complete with empty-production validation; TASK-002B implementation is in progress; Synergy remains unstarted.

## Task METRICS-01 — versioned event reconstruction and advanced metric evidence

Status: **COMPLETE — SDD STRICT; non-empty production metric path NOT VERIFIED**

- [x] Add append-only migration `0006_metric_evidence_status.sql` and `durable-evidence-v2` missing/observed/unavailable semantics.
- [x] Implement deterministic `event-metrics-v1` Trade, KAST/opening, 1v1–1v5 clutch, objective, direct cast, economy-efficiency and kill-context reconstruction outside React.
- [x] Preserve full anonymous match topology only inside the server while exposing only current-policy consenting-player aggregates.
- [x] Publish compact schema 2 / `dataset-read-v2` / `event-metrics-projection-v1` responses with explicit evidence and coverage; never return raw events or identifiers.
- [x] Add pure multi-match aggregation that sums counts and recomputes ratios from additive totals.
- [x] Add missing, malformed, observed-zero, order/tie, invalid-denominator, privacy, parity and bounded-performance regression tests.
- [x] Keep all TASK-001 score categories, benchmarks and weights unchanged.
- [x] Verify production aggregate counts, migration-0006 apply/rerun, CI and both deployments.

Existing `durable-evidence-v1` rows default to missing v2 evidence and are not silently upgraded; a future authorized overlap/import may rewrite them. Production remains validly empty, so the non-empty production advanced-metric path is **NOT VERIFIED**. Exact formulas, evidence states and compact-zero semantics are in `docs/METRICS_RECONSTRUCTION.md`.

## Task 002B — evidence-aware scoring correctness

Status: **IN PROGRESS — local engine and UI implemented; deployment gates pending**

TASK-002B does not depend on live API completion. It may use the current deterministic demo evidence while keeping formulas transparent, representing unavailable evidence explicitly and avoiding claims about unverified real-provider coverage.

The following historical audit findings are addressed by this versioned engine (pre-task behavior):

- missing category evidence previously became the numeric score 50 and is indistinguishable from measured neutral performance;
- optional first-kill/death and clutch totals can use partial observations while their derived denominators still cover all rounds/matches;
- one observed match can produce a perfect Consistency score because measured dispersion is zero;
- tiny clutch samples can produce overly strong scores without shrinkage or a minimum sample rule;
- score results do not provide component-level calculation traces;
- role benchmarks are prototype constants without a versioned calibration source;
- aggregate values are rounded before scoring, losing precision;
- Teamplay previously included a significant 25% Win Rate contribution.

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
- Task 005 evidence foundation: absorbed by TASK-METRICS-01; any Impact/Frag Quality score remains TASK-002B work
- Task 006 evidence foundation: absorbed by TASK-METRICS-01; weighting and small-sample treatment remain TASK-002B work
- Task 007 evidence foundation: absorbed by TASK-METRICS-01; buy-state bands and Economy score remain future work
- Task 008: advanced UI refinement
- Task 009: CSV and JSON import
- Task 010: GitHub Pages v1.0 release
- Official Riot integration: application readiness is now documented early, but live production player data remains dependent on Production API approval, RSO access and a secure backend.

### TASK-002B execution evidence

Starting HEAD bb2bdb87a3ed3041decb0552177552cc4b1bb558; checkpoint-before-task-002b. Versioned eight-dimensional engine, explicit missing/partial policy, precision preservation, selected-role context, trace UI, radar gaps and fictional Demo evidence implemented. See TASK_002B_PLAN.md and SCORING.md. No migration or provider fetch; non-empty production scoring NOT YET EXERCISED. Next only recommended task: TASK-SYNERGY-01, NOT STARTED.
