# V1 release preflight

Governance: SDD STRICT. TASK-RELEASE-01 remains IN PROGRESS; V1 is NOT YET RELEASED. No release level or release tag is authorized.

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
