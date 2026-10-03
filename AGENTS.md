# Repository instructions

## Product boundary

- Build VALORANT Squad Analytics as a transparent community performance dashboard for a private friend group.
- Never describe the score as MMR, Elo, official rank, or a replacement for Riot's ranked system.
- Preserve the GitHub Pages demo during TASK-API-02 migration. Production may use a thin Vercel backend, but no API key or Henrik DTO may enter the deployed frontend.
- TASK-API-02.1 is the completed evidence checkpoint. Normal players provide only Riot Game Name, Tag, affinity and explicit consent. The site operator holds one `HENRIK_API_KEY` server-side; never ask players for provider credentials or Riot authentication secrets.
- Do not copy Riot, VALORANT, VLR, or third-party visual assets or page designs.

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

- TASK-RELEASE-01A.3 security disposition is complete under SEC-2026-001, but final production acceptance is ON HOLD: after its documentation push, read-only dataset GET showed two players / seventeen matches instead of the authorized one / ten. Cause NOT VERIFIED. This supersedes the historical one-player/ten-match state below. RELEASE-01A remains IN PROGRESS / ON HOLD until human confirmation and revised read-only acceptance scope. Do not repair, reimport, sync, delete or rerun production health SQL; no provider calls or data writes are authorized. No release level or v1.0.0. See `docs/RELEASE_V1.md`.

- TASK-SYNERGY-01 and TASK-UI-01 acceptance are COMPLETE. TASK-RELEASE-01A.2 Option A is COMPLETE: schema 4 / dataset-read-v4 / evidence-decoupled-projection-v1, historically Public REAL ready with one visible player and ten basic matches. KAST/Opening remained partial without values; event engine and scoring/Synergy formulas are unchanged. Read-only production relational, migration, consent, sync and deletion checks passed on 2026-10-03 for that historical fixture. TASK-RELEASE-01A.3 dispositions five unpatched dev/build-only high audit findings under SEC-2026-001; production audit is zero. Review expires 2026-11-03 or on an earlier upstream fix. See `docs/SECURITY_EXCEPTIONS.md` and TASK-SECURITY-01; re-evaluate changed advisory scope, imports, runtime promotion or input boundaries. Remote function-artifact bytes remain NOT VERIFIED; all application API closures show no affected dependency/input path. RELEASE-01 remains IN PROGRESS; V1 NOT YET RELEASED. Do not perform provider calls, writes, release levels or tags without new explicit authorization. Non-empty two-player Synergy remains NOT VERIFIED. Older checkpoint descriptions below are historical; see the acceptance hold above for the current fixture. See `docs/RELEASE_V1.md`.

- TASK-DATA-01A, TASK-DATA-01B, TASK-DATA-01C and TASK-DATA-02 are complete. TASK-METRICS-01 is complete; migration 0006, CI and deployments are verified. The non-empty production advanced-metric path remains NOT VERIFIED. Vercel is the PUBLIC REAL canonical runtime: exact server-only `REAL_DATASET_READ_MODE=public` exposes only the bounded sanitized dataset without viewer authentication; every other value fails closed. GitHub Pages remains Demo-only. Current public consent policy is `2026-10-02-public-v1` from `shared/privacyPolicy.ts`; only an active `self_asserted` consent on that exact version authorizes provider writes or public visibility. The explicitly approved DATA-01C validation revoked and deleted the former production test player on 2026-10-01; do not repeat that operation or infer approval for another player. Any future destructive revocation still requires the explicit human approval gate in `docs/REVOCATION_AND_DELETION.md`. TASK-METRICS-01 introduced `event-metrics-v1`, `durable-evidence-v2`, public schema 2 and migration `0006`, but no new score or weight. TASK-002B is explicitly authorized and implementation is complete: community-score-v2, community-benchmarks-v1, overall-profile-v1. Preserve evidence-aware missing/partial semantics and aggregate-only traces. TASK-SYNERGY-01 is explicitly authorized and implemented; release acceptance is recorded in docs/TASK_SYNERGY_01_PLAN.md. Public schema is now 3 / dataset-read-v3 / synergy-ready-projection-v1. duo-synergy-v1 and duo-synergy-benchmarks-v1 remain separate pair-level association, not a ninth dimension. Non-empty production Synergy is NOT YET EXERCISED; no new migration, provider call or player reconnect. Read docs/SYNERGY.md before changing pair boundaries. Do not begin TASK-UI-01 implicitly. Read `docs/DATABASE.md`, `docs/HISTORICAL_SYNC.md`, `docs/REVOCATION_AND_DELETION.md`, `docs/REAL_DATA_FIELD_AUDIT.md`, `docs/DATASET_RUNTIME.md`, `docs/METRICS_RECONSTRUCTION.md`, `docs/CODE_MAP.md`, `docs/PRODUCTION_ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/TASKS.md` before changing data, synchronization, provider, reconstruction or scoring boundaries.
- Keep `DATABASE_URL`, `IDENTIFIER_HMAC_KEY`, provider identifiers and raw match IDs server-only. Never run migrations from browser code or return database/provider identifiers through public APIs.
- A public player/job UUID never authorizes revocation or deletion. Keep consent-management plaintext only in the consenting browser, store only the domain-separated HMAC server-side, and never put the credential in URLs, logs, Git or completion reports.
- Never treat stored-match results as complete lifetime history. Persist coverage windows, evidence availability and derivation versions explicitly.
- Keep display rounding in `src/utils/format.ts` and `src/analytics/presentation.ts`; do not reduce calculation precision to format UI values.
- Stay within the requested task. Record later ideas under the roadmap instead of silently expanding scope.
