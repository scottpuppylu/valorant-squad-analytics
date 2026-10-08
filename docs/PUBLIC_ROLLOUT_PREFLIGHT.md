# Public rollout preflight — PUBLIC-ROLLOUT-PREFLIGHT-01

**STATUS: COMPLETE (2026-10-08). PUBLIC_ROLLOUT_READY = YES for SOURCE-ONLY publication on a non-production branch.
A `main` push / Production deploy stays BLOCKED (Neon gate). Nothing was pushed, deployed or published.**

| Decision | Value |
|---|---|
| PRIMARY_OUTCOME | **OUTCOME_A**: a safe source-only push is proven for the clean release branch (Production stays on `7a9934e`) |
| `main` / Production | **OUTCOME_B**: a `main` push cannot be separated from a Neon-touching Production deploy with the current configuration. BLOCKED_UNTIL the Neon Production database gate (§9) |
| Next safe action (after SDD approval) | Push ONLY `release/pre-public-clean-01` with an explicit refspec (§11) |

## 1. Clean release

| Item | Value |
|---|---|
| Clean branch | `release/pre-public-clean-01` (local, isolated worktree) |
| Clean release commit | `7dae66670fc8a3b0296b344d3b9b5af910729c1c` — "release: prepare pre-public analytics rollout" |
| Parent | `7a9934e9408cb77eab21d6f31572512c2294b730` (= `origin/main` after a read-only `git fetch`; REMOTE_BASE_CHANGED = NO) |
| Tree | `97de02ac21be2df105457bf54b3e124f427922b5` = tree of local tag `checkpoint-local-release-pre-public-01` |
| Commits ahead of `origin/main` | 1 (+ the docs-only commit adding this file) |
| Delta vs `origin/main` (release commit) | 206 files: 131 added, 74 modified, 1 deleted (`server/db/neon.ts`, accepted driver decoupling); +18 518 / −588 |

**Construction.**
1. A worktree was created at `origin/main`.
2. `git rm -r .` was run, then `git checkout <checkpoint tag> -- .` (the approved tree, materialized).
3. One commit was made. No development commit was cherry-picked.

**Tree equivalence: CLEAN_TREE_EQUIVALENT = YES.**
- The index tree hash equals the checkpoint tree hash (`97de02a`).
- A sorted `(mode, blob hash, path)` list of all 462 paths is identical.
- The worktree equals the index, with no untracked files.
- `.claude/` and `skills-lock.json` are absent from both trees.

**History proof: UNPUBLISHED_DEV_HISTORY_REACHABLE = NO.**
- `31d0210`, `cb186c9`, `111b7ef`, `d9d37ca` and `0d8d101` are not ancestors of the release ref (`git merge-base --is-ancestor` is false for each).
- None of the 74 development commits is reachable.
- A push sends only objects reachable from the release tree, so the vendored-skill blobs from `31d0210` are never transmitted.

**The only docs-only difference from the checkpoint tree** is this file, `docs/PUBLIC_ROLLOUT_PREFLIGHT.md`, added in a
second commit on the release branch. It is not merged back into the development branch.

**Content audit of the release commit:**
- `git diff --check` is clean.
- Secret scan of added lines: no Henrik / Riot / GitHub / Vercel keys, no private keys, no 64-hex secrets. The Postgres
  URLs are templates (`${PASS}`, `CHANGE_ME`); the Neon host is a synthetic test value; the UUIDs are Riot agent content
  ids and synthetic test ids; the long token is an npm integrity hash.
- No env files, dumps, logs, raw payloads, `members.json`, Neon skill files or valorant-api metadata.

CLEAN_RELEASE_SECRET_SCAN, CLEAN_RELEASE_PRIVATE_BOUNDARY and CLEAN_RELEASE_THIRD_PARTY_BOUNDARY are all PASS.

## 2. Vercel behaviour (read-only; nothing changed)

Evidence classes: **L** = VERIFIED_LOCAL_CONFIG, **R** = VERIFIED_READ_ONLY_REMOTE (authenticated Vercel CLI `GET`
calls; environment variable *names and targets only*).

| Question | Answer | Evidence |
|---|---|---|
| Project linked | YES: the local `.vercel/project.json` links project `valorant-squad-analytics`; ids are recorded in the SDD report, not in this public file | L |
| Git integration | GitHub `scottpuppylu/valorant-squad-analytics`; `gitProviderOptions.createDeployments = enabled`; no ignored-build-step command | R |
| A. `main` push → Production deploy | **YES**: production branch = `main`. Every recent `main` commit (including `7a9934e`) produced a git-sourced Production deployment | R |
| B. Other branch push → Preview deploy | **YES**: deployments are enabled for all branches and nothing skips them. No Preview has ever been created (0 of the last 100), so this is from configuration, not observed history | R |
| C. Production branch | `main` | R |
| D. Existing repository skip mechanism | **NONE**: no `ignoreCommand` and no `git.deploymentEnabled` in `vercel.json`. Adding one is a change that needs SDD approval | L |
| E. Deploy runs the database path | **Production: YES. Preview: NO** (§3) | L + R |
| Preview access | Vercel Authentication protects all deployment URLs except custom domains (`ssoProtection`) | R |

## 3. Build command chain

`vercel.json` sets `buildCommand: npm run vercel-build` →
1. `npm run db:migrate:vercel` → `tsx scripts/migrate-vercel.ts`:
   - `VERCEL_ENV === 'production'`: reads `DATABASE_URL` and **applies pending migrations (0012 = DDL write)**.
   - Anything else: prints "Skipping database migrations outside Vercel Production."
2. `npm run db:hydrate-facts:vercel` → `tsx scripts/hydrate-analysis-facts-vercel.ts`:
   - Production: reads `DATABASE_URL`, **reads all durable evidence and writes analysis facts** under the new canonical
     key (`analysis-match-facts-v1:event-metrics-v2:…`). A failure is logged and non-blocking.
   - Otherwise: skip.
3. `npm run build` → `tsc -b && vite build && assert-secret-boundary --dist` (static app; no database).

**Offline simulation on the clean tree (no database variables present):**
- `VERCEL_ENV=preview npm run vercel-build`: both database steps print "Skipping …", and the build succeeds (exit 0).
- `VERCEL_ENV=production`: it stops at step 1 with "DATABASE_URL is required for Vercel Production migrations"
  (exit 1). A Production build cannot proceed without its database.

## 4. Neon dependency (static inspection; Neon not accessed)

**VERCEL_PRODUCTION_DATABASE_EXPECTED = NEON (R).**
- The project's only storage resource is the **Neon** marketplace integration.
- It is attached to `environments = ["production"]` with `deployments.required = true`.
- It injects `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PG*` and `POSTGRES_*` variables, all **Production-only**.
- `HENRIK_API_KEY`, `IDENTIFIER_HMAC_KEY`, `CRON_SECRET` and `REAL_DATASET_READ_MODE` are also Production-only.
- No Preview or Development variable exists. There is no per-Preview Neon branch action (the store is not attached to
  Preview).

| Operation | Production | Preview |
|---|---|---|
| MIGRATION_0012 (build) | NEON_WRITE | NO_DB (skipped) |
| FACT_HYDRATION (build) | NEON_READ (all evidence) + NEON_WRITE | NO_DB (skipped) |
| API_RUNTIME_READ | NEON_READ | NO_DB: `createDatabase()` returns `undefined` without `DATABASE_URL`, so it fails closed |
| SYNC_WRITE | NEON_WRITE (+ Henrik) | NO_DB, no provider key |
| CRON | NEON_READ / NEON_WRITE (+ Henrik) | none (crons run on Production only) |

**NEON_QUOTA_DEPLOYMENT_RISK = BLOCKING for Production.**
- The Neon transfer quota is recorded as exhausted until 2026-11-01. It is not assumed reset, and it was not probed.
- A Production deploy needs successful Neon DDL, a full evidence read and fact writes.
- If Neon refuses, the build fails at step 1 and the current deployment keeps serving; this fails closed but is still an
  unauthorized Neon contact.
- If Neon accepts, hydration consumes transfer on an exhausted quota.

**Preview: NEON_ACCESS = NONE.**

**Not done here:** removing the database steps from the build (OPTION_D) is a separate architecture decision.

## 5. GitHub Actions and Pages (clean tree)

| Workflow | Triggers | Permissions | Secrets | Target |
|---|---|---|---|---|
| `.github/workflows/ci.yml` | `push` to `main`; `pull_request` to `main` | `contents: read` | none | lint, test, build only |
| `.github/workflows/deploy-pages.yml` | `push` to `main`; `workflow_dispatch` | `contents: read`, `pages: write`, `id-token: write` | none | GitHub Pages environment `github-pages` (custom branch policy) |

**What runs on each push:**
- MAIN_PUSH_RUNS_CI = YES, MAIN_PUSH_DEPLOYS_PAGES = YES.
- RELEASE_BRANCH_PUSH_RUNS_CI = NO (unless a PR to `main` is opened), RELEASE_BRANCH_PUSH_DEPLOYS_PAGES = NO.

**Pages content.**
- Pages builds without `VITE_DATA_MODE`. On `*.github.io` the app runs **Demo** mode on synthetic `src/data/demoMatches.ts`.
- In a `GITHUB_ACTIONS=true` build, the bundle contains none of the 9 community names, no participant HMAC, no
  `location_x` / `view_radians` / plant coordinates and no team-composition code.
- The only `puuid` string is the pre-existing guard that *rejects* stored data containing it (also present in `7a9934e`).
- REAL_PRIVATE_DATA_INCLUDED = NO, RAW_COORDINATES_INCLUDED = NO, PRIVATE_IDENTIFIERS_INCLUDED = NO.
- Pages is safe independently of Vercel.

## 6. Clean-release feature exposure

The clean tree equals the checkpoint tree, so [LOCAL_RELEASE_CHECKPOINT.md](LOCAL_RELEASE_CHECKPOINT.md) §9 applies
unchanged.

| Feature | Class | Visible after a release-branch push | Visible after a later `main` deploy |
|---|---|---|---|
| event-metrics-v2 | IMPLEMENTED, SERVER_EXPOSED, PUBLIC_API_EXPOSED, UI_EXPOSED | No (Preview has no data) | YES: LIVE_API_BEHAVIOUR_CHANGE over existing legacy data |
| rank context | INTERNAL_ONLY (private staging) | No | No |
| Shared-Match v1 | INTERNAL_ONLY | No | No |
| agent catalog (agent-catalog-v1) | UI_EXPOSED (roles in scoring, filters, UI) | No | YES (role changes; Miks = Controller) |
| Community Score | UI_EXPOSED; coverage follows event-metrics-v2 | No | YES (availability change) |
| Current Strength | UI_EXPOSED; coverage follows event-metrics-v2 | No | YES (availability change) |
| Team Composition V1 | INTERNAL_ONLY | No | No |
| Team Composition V2 | INTERNAL_ONLY | No | No |
| position evidence | SERVER_EXPOSED for writes only, INTERNAL_ONLY for reads; never public | No | Write-only for newly synced matches |
| Pages (any push to `main`) | DEMO_ONLY | n/a | Demo |

## 7. Migration 0012 preflight (PGlite, local only)

**MIGRATION_0012_LOCAL_PREFLIGHT = PASS.**
- Production-compatible baseline 0001–0011 with populated rows → the runner applies only `0012`, and a second run
  applies nothing (idempotent).
- Pre-existing rows keep their values. All 10 new columns are nullable and NULL on old rows.
- The side/source constraint rejects a half-populated side.
- A fresh database applies 0001–0012, then nothing on re-run.

**MIGRATION_0012_BACKWARD_COMPATIBLE_WITH_OLD_CODE = YES (tested).** The deployed code (`7a9934e`) ran its own full
suite twice, without and with 0012, in a disposable worktree. Its Neon import was replaced by an inert stub that throws
if called; the tests use PGlite.
- Every behavioural test passes with 0012 applied: revocation 13/13, history sync 37/37, server analysis 16/16, dataset
  history 17/17, analysis facts 7/7, and every behavioural case in dataset read / database foundation.
- The only new failures (9) are assertions on the exact list of applied migration names, which the new code updates
  (`727d655`).
- One environmental CLI test fails in both runs.

OLD_ROWS_COMPATIBLE = YES.

## 8. Rollback plan (not executed)

**SOURCE_ROLLBACK.**
- Release branch: delete it with `git push origin --delete release/pre-public-clean-01`. This is not a force push.
- `main` (later): push a revert commit as a normal fast-forward. Never force-push.

**VERCEL_ROLLBACK.** Instant rollback to the previous Production deployment (commit `7a9934e`) from the dashboard or
`vercel rollback`. It runs no build and no migration.

**DATABASE_ROLLBACK.** Roll forward. Keep 0012 applied: it is additive, and old code is compatible with it (tested).

**Privacy caveat on a code rollback.**
- The old code's revocation does not clear the 0012 plant / defuse coordinates (the defect fixed in this release).
- Old code never writes them, and it already deletes snapshots.
- So before or at a rollback, run the one-statement scrub of `rounds.plant_location_x/y` and `defuse_location_x/y`, which
  old code never reads. Alternatively, keep the revocation fix deployed.
- This must be part of any future rollback runbook.

## 9. Final decision and exact next steps

- **SOURCE_ONLY_PUSH_FEASIBLE = YES**, on the non-production branch only:
  - it creates a Preview build that is proven database-free and provider-free, behind Vercel Authentication;
  - it triggers no GitHub workflow.
- **RELEASE_BRANCH_PUSH_SAFE = YES. MAIN_SOURCE_PUSH_SAFE = NO. FULL_DEPLOY_NOW_SAFE = NO.**
- **BLOCKED_UNTIL** (for `main` / Production): the Neon transfer quota reset (recorded as 2026-11-01), or an explicit SDD
  Production database decision. Examples: OPTION_B (a proven Vercel Git-deploy disable with an exact re-enable sequence)
  or the planned VPS / static architecture, which needs no Neon.

## 10. Production data limitations (unchanged)

- CANONICAL_CONSENT_RECONCILED = NO, CANONICAL_HISTORY_RECONCILED = NO, LIFETIME_COMPLETE = NO.
- The local 838-match staging set is not canonical Production.
- REAL_PUBLIC_DATA_PUBLISHED = NO; the data repository is unchanged (`ff661e1`).

## 11. Exact next commands (for SDD; NOT executed)

1. **Source-only publication** (after SDD approval). Explicit refspec, no tags, no force:

   ```bash
   git push --no-follow-tags origin refs/heads/release/pre-public-clean-01:refs/heads/release/pre-public-clean-01
   ```

   - Expected: one new remote branch, a Vercel **Preview** build (database steps skipped), no GitHub Actions run, and no
     Pages change.
   - Never push `main` (development history), `checkpoint-local-release-pre-public-01` or any `--tags`.
2. **Later Production rollout.** Only after the Neon / Production database gate is cleared and SDD approves:
   1. Re-run this preflight against the then-current `origin/main`.
   2. Fast-forward `main` to the clean release commit:

      ```bash
      git push --no-follow-tags origin <clean release commit>:refs/heads/main
      ```

   3. Observe the Vercel Production build (0012 applied, hydration summary).
   4. Observe Pages and CI.
   5. Keep the rollback plan (§8) ready.

## Addendum — PRODUCTION_BUILD_HARDENING (TASK-RELEASE-PRODUCTION-BUILD-HARDENING-01, 2026-10-08)

The evidence above is unchanged. This addendum resolves the two concerns raised by Preview
`dpl_2RMCZ28f5UQx2KcfxtwChcZwhgqh`.

**Build invocation (root cause verified).** The 13 build passes were **13 real, serial executions**, not replayed logs.
- Each pass has its own timestamps (about 28 s apart) and its own `vite build` duration (6.2–8.7 s).
- Pass 1 is the project build command. Passes 2–13 each precede one of the 12 API function compiles
  (`Using TypeScript 5.9.3`).
- Cause: `@vercel/node` 22.0.0 (`build()` with `considerBuildCommand = false`) calls
  `runPackageJsonScript(entrypointDir, ["vercel-build", "now-build"])` for **every function entrypoint**. It walks up to
  the root `package.json`, which defined `vercel-build`.
- The project-build-command path (`considerBuildCommand = true`) is used only by framework node builders, not by
  `api/**/*.ts`.
- `docs/FULL_TRACKED_LATENCY.md` had already recorded the 12× re-run on Production deploy `d629c28`.

**Before the fix, per Production deployment:**
- migration 13× (1 applies, 12 are no-ops);
- hydration 13× (1 full pass, 12 pending scans with `scannedMatches: 0`, about 1 s each);
- build 13×.

**Fix (repo-only; no Vercel setting change).**
- The npm script is renamed `vercel-build` → `build:vercel`, and `vercel.json` `buildCommand` → `npm run build:vercel`.
- Vercel's own `getScriptName(pkg, ["vercel-build", "now-build"])` (cached CLI 62.7.0) selected `"vercel-build"` for the
  old `package.json` and selects `null` for the new one. Function entrypoints therefore run no script, and the project
  build runs the chain once.
- The chain and its order are unchanged (migrate → hydrate → build), both database steps stay gated on Vercel
  Production, and nothing was removed.

**Expected after the fix, per Production deployment:**
- MIGRATION_INVOCATIONS_PER_DEPLOYMENT = 1;
- HYDRATION_INVOCATIONS_PER_DEPLOYMENT = 1;
- BUILD_INVOCATIONS_PER_DEPLOYMENT = 1.

These counts are derived from the builder source plus local selection; the Production count is first observable on the
next authorized Production deploy.

**Repeat safety (local, no database contact).**
- MIGRATION_REPEAT_SAFE = YES: 13 sequential runner invocations on the deployed baseline apply `0012` once, then nothing;
  the ledger has 12 rows.
- HYDRATION_REPEAT_CORRECTNESS = IDEMPOTENT: a second `hydrateAnalysisFacts` scans 0 matches (`tests/analysisFacts.test.ts`).
- HYDRATION_REPEAT_COST_RISK = LOW per repeat after a successful first pass (one pending-scan query, ids only). It is
  removed anyway: 12 fewer Production Neon sessions per deploy.
- Trade-off: a failed or partial first hydration is no longer retried 12 times within the deploy. Correctness is
  unaffected, because the read path reconstructs any non-fresh fact from raw evidence.
- No guard, lock row or external state was added: the build now naturally runs once.

**TS2550.**
- Vercel's function type-check uses the nearest `tsconfig.json`: the root solution file, with `"files": []` and no
  `compilerOptions`. It therefore defaults to ES2021, where `Array.prototype.at` (ES2022) is reported.
- This was diagnostic-only and non-fatal; the Node 24 runtime supports `.at`. Four of the six sites were already in
  `7a9934e`.
- The six flagged `.at(-1)` sites now use `src/utils/last.ts` (identical semantics; tested for empty, single, multiple
  and 0..50-length arrays against `.at(-1)`).
- A local reproduction of the bundler check (12 entrypoints, ES2021 lib) went from 6 × TS2550 to **0**.
- The TypeScript target and lib were not raised.
- One pre-existing, non-fatal `TS2339` (`server/dataset/weaponAnalytics.ts:161`, `.map` on `unknown`) remains, unchanged
  and out of scope.

**Release branch.** RELEASE_BRANCH_UPDATE_REQUIRED = YES: one hardening commit on `release/pre-public-clean-01`. Pushing
it needs SDD approval and would create one more database-free Preview. `main` and Production stay unchanged and blocked
on the Neon gate.
