# V1 release preflight

Governance: SDD STRICT. TASK-RELEASE-01 remains IN PROGRESS; V1 is NOT YET RELEASED. No release level or release tag is authorized.

Current preflight: TASK-RELEASE-01A COMPLETE — SDD STRICT WITH DOCUMENTED DEV-ONLY SECURITY EXCEPTION SEC-2026-001. Historical blocker statements below are superseded by the 01A.3 disposition, not erased. Full audit remains five high, NOT FIXED; production audit zero. No release Level A/B/C or v1.0.0 authorization follows from preflight completion.

## TASK-RELEASE-01A.2 — approved Option A

Status: COMPLETE — SDD STRICT. Production API and browser acceptance succeeded.

Starting HEAD: e9880c9bc329ccaefebddfb9d4746a4852435ff1. Clean main equaled origin/main. Pushed checkpoint-before-release-01a2-option-a before edits.

Verified diagnosis: 10 candidate performances, 222 rounds, 2,220 presences, 1,650 distinct kill events. Basic evidence passed, but 46 rounds violated the single-life topology model. Requiring reconstructed KAST/Opening consequently omitted all 10 matches. Exact provider revive/self-death semantics remain NOT VERIFIED; this does not establish corrupt durable data.

Resolution: independently gate basic stats on public eligibility, observed stats, agent, finite K/D/A/score/damage, positive durable round count and exact participant presence in every distinct durable round. Attach event-derived values only when reconstructed. Preserve independent direct domains and unchanged scoring/Synergy gates.

Contract: schema 4, dataset-read-v4, evidence-decoupled-projection-v1, durable-neon-v4. Snapshot hashes versions and browser-visible content. Event engine, formulas, weights, benchmarks, privacy policy and migrations 0001–0006 remain unchanged. No new migration.

Baseline: lint PASS; 20 files/292 tests PASS (28.60s); build PASS (710 modules, 4.00s; main 361.72 kB/116.15 gzip, charts 339.21/99.53, CSS 40.17/9.15); DB validation 15 tests PASS (15.67s). npm audit FAIL: 5 high vulnerabilities via braces/Tailwind 3 dependency chain, GHSA-vfj7-8cjw-p6xm. The suggested forced Tailwind 4 migration is outside this hotfix. Do not mark release preflight clean while unresolved.

Acceptance: complete local gates, CI, Pages Demo and Vercel deployment; then read-only API must return schema 4 REAL ready, 1 player and 10 matches. Stop if match count differs. Verify eight analysis routes, honest missing values, sanitized score/evidence aggregates, dataset GET logs and relational/migration/consent/sync/deletion health. Never archive production identities or rows.

Only code/docs/tests and deployment plus read-only checks are authorized. No provider calls, writes, import/sync, consent changes, deletion, secrets changes or schema change. Rollback is code-only to the checkpoint; never roll back the database.

## Hotfix acceptance — 2026-10-03

Final local rerun: lint PASS; 21 files / 317 tests PASS (23.84s); source and built secret-boundary scans PASS; build PASS, 711 modules, 2.81s. Main 363.14 kB / 116.46 gzip; charts 339.21 / 99.53; CSS 40.17 / 9.15. DB validation 1 file / 15 tests PASS (16.55s). Audit remains FAIL, five high, unchanged from baseline.

Implementation commits: a72124e (basic projection and consumers), 496c4e1 (regression tests), 425773a (specification). CI [37111156510](https://github.com/scottpuppylu/valorant-squad-analytics/actions/runs/37111156510) PASS, 94s; Pages [37111156495](https://github.com/scottpuppylu/valorant-squad-analytics/actions/runs/37111156495) PASS, 108s. Vercel [2ZyyeHT9mdN1jYDJ8mQ7JVCYPn89](https://vercel.com/scottpuppys-projects/valorant-squad-analytics/2ZyyeHT9mdN1jYDJ8mQ7JVCYPn89) Ready, 3m48s, aligned to 425773a. Existing migration checker explicitly reported `Production database is already up to date.` No migration or production data write.

Public API: HTTP 200, no-store, schema 4, REAL ready, 1 player / 10 matches, snapshot present and client contract accepted. ACS/ADR/HS derived; KAST/FK/FD partial. All 10 performances omit KAST and Opening values. Trade unavailable 10; clutch partial 10; objectives reconstructed 10; abilities/economy/roleValueInputs derived 10; impactContext partial 10. Dimensions: 0 available, 2 partial, 6 unavailable; Overall unavailable. No identities or raw data were archived.

Browser: Dashboard, Leaderboard, Player Profile, Matches (expanded missing KAST), Maps, Agents, Compare empty/single-player and Synergy one-player guidance all passed after route-specific readiness checks. Missing values remain missing; no NaN/Infinity; console errors 0. Pages subpath Matches loaded fictional Demo and console errors 0.

Post-deploy dataset GET log window 16:56:28–16:57:33 (Asia/Taipei): four GET rows, four HTTP 200, zero listed failure patterns. Only dataset-read requests inspected. Runtime-log scan is bounded evidence, not a claim about all historical requests.

Remaining RELEASE-01A blockers: audit high vulnerabilities; aggregate relational orphan/migration/consent/sync/deletion health queries NOT VERIFIED because Vercel again requires human database verification. No alternate credential extraction or write was attempted. RELEASE-01A remains IN PROGRESS; overall RELEASE-01 remains IN PROGRESS; V1 NOT YET RELEASED. No Level A/B/C selection or v1.0.0 tag.

## Read-only health closure — 2026-10-03

The preceding database-verification blocker is now resolved after human verification. Two SELECT-only aggregate queries ran with the console Read-only checkbox checked. No production data writes, provider calls, migration or identity export occurred.

| Check | Verified result |
|---|---|
| Foreign-key orphan checks | 27 edges checked, 0 orphan rows, 0 failing edges |
| Unvalidated public FK/check constraints | 0 |
| Cross-match presence/kill/assistant/location/objective references | All 0 |
| Migration ledger | Exactly 0001–0006, count 6, unexpected versions 0 |
| Current active consent | 1 |
| Obsolete/duplicate/anonymized active consents | All 0 |
| Inconsistent consent timestamps / missing active management verifier | Both 0 |
| Active membership without current consent | 0 |
| Open or failed sync runs; live/stale sync leases | All 0 |
| Open or failed deletion jobs; stale deletion leases; expired audits | All 0 |
| Source matches / old normalization versions | 10 / 0 |

Public API recheck: HTTP 200, schema 4, REAL ready, 1 player, 10 matches. Final implementation HEAD before this documentation update was 8f182654ec5a580e275dfb908e45e5d634b7d99d: CI 37111689980 succeeded (93s), Pages 37111690005 succeeded (107s), Vercel 4o82jAnFhTG4js8AhfSZ6HYixJDt Ready (3m42s). These are historical aligned deployment checkpoints, not assertions about later documentation commits.

This continuation reran lint PASS, 21 files/317 tests PASS (32.39s), build PASS (711 modules, 5.00s; unchanged bundle sizes), source/dist secret scans PASS and DB validation 15 tests PASS (18.90s). npm audit still FAILS with five high development-chain advisories. The only outstanding preflight blocker is dependency audit remediation; no forced Tailwind 4 migration is authorized here. TASK-RELEASE-01A remains IN PROGRESS; TASK-RELEASE-01A.2 remains COMPLETE; V1 NOT YET RELEASED. Do not choose a release level until the remaining gate is resolved.

## TASK-RELEASE-01A.3 — security disposition, 2026-10-03

Starting HEAD 846c464f28f54d4e22c53e50d32d99bdaf63041e, clean main equal to origin/main. Created and pushed checkpoint-before-release-01a3-security before changes. See TASK_RELEASE_01A3_PLAN.md for baseline results and SECURITY_EXCEPTIONS.md for all five exact findings, paths, accepted-risk criteria and limitations.

One underlying GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 affects braces <=3.0.3, patched NONE at authoritative review. Installed braces 3.0.3, chokidar 3.6.0, micromatch 4.0.8, fast-glob 3.3.3 and Tailwind 3.4.19 are all dev-only. Physical isolated production-only install has no braces and zero vulnerabilities. Browser emitted module graph excludes all five packages. All 11 application API entry-point bundles exclude them, with only node:crypto external; production inputs have no glob/compiler execution path. Remote Vercel artifact bytes are NOT VERIFIED; exception criterion 4 uses the authorized no-untrusted-production-input-path alternative, not an unsupported artifact-absence claim.

Compatible-parent update trial and registry metadata reproduce the same five high findings; no safe compatible fix exists today. Dependency files and application/CI behavior remain unchanged. No force fix, fake override, vendoring, fork or major upgrade. Tailwind 4 is NOT REQUIRED for this authorized disposition; actual migration/remediation requires separate human approval and actual tree verification.

SEC-2026-001 accepts this dev/build-only risk temporarily, not as fixed. Expiry/review 2026-11-03 or earlier upstream fix; named maintainer manually reviews at every release/dependency/boundary change. TASK-SECURITY-01 is MONITORING / BLOCKED ON UPSTREAM. Full audit must still be run and reported honestly; production audit must remain zero. New high/critical, changed five-finding scope, runtime promotion, input-path change or expiry invalidates the exception. Existing CI never included audit; no audit gate was removed and no blanket suppression or custom automated gate was added.

TASK-RELEASE-01A is COMPLETE — SDD STRICT WITH DOCUMENTED DEV-ONLY SECURITY EXCEPTION SEC-2026-001. TASK-RELEASE-01 remains IN PROGRESS, V1 NOT YET RELEASED. CI/Pages/Vercel final-commit verification and schema 4 / REAL / ready / one player / ten matches read-only acceptance are reported at handoff. Migration NONE, Henrik calls 0, production data writes NONE. No Connect/import/sync, production health SQL rerun, release level or release tag.

Final local rerun for this disposition: lint PASS; 21 files / 317 tests PASS (21.97s); source secret scan PASS; build PASS (711 modules, 3.18s; main 363.14 kB / 116.46 gzip, charts 339.21 / 99.53, CSS 40.17 / 9.15; unchanged output hashes); dist secret scan PASS; DB foundation validation 1 file / 15 tests PASS (17.49s). Full audit still FAILS, exactly five high; production audit PASS, zero vulnerabilities. No new tests were needed for documentation-only changes.
