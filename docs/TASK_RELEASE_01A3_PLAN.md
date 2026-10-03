# TASK-RELEASE-01A.3 — security disposition plan

Governance: SDD STRICT. Scope: dependency diagnosis and a bounded security disposition only.
Starting main was clean and equal to origin/main at 846c464f28f54d4e22c53e50d32d99bdaf63041e.
The checkpoint-before-release-01a3-security tag was created and pushed before changes.

## Baseline, before dependency edits — 2026-10-03

- Full npm audit JSON: five high findings, zero other severities; one underlying braces advisory and four propagated package findings.
- Production audit JSON: zero vulnerabilities.
- npm ls/explain: braces 3.0.3 is dev-only through Tailwind 3.4.19, chokidar 3.6.0, micromatch 4.0.8 and fast-glob 3.3.3.
- Lint PASS; 21 test files / 317 tests PASS, 25.51s; source secret scan PASS.
- Build PASS: 711 modules, 2.96s; main 363.14 kB / 116.46 gzip; charts 339.21 / 99.53; CSS 40.17 / 9.15; built secret scan PASS.
- DB validation PASS: one file / 15 tests, 17.86s, disposable local PGlite only.

## Decision and acceptance

First seek genuinely patched compatible dependencies using registry metadata, outdated/dry-run checks and an isolated compatible-parent update trial. Do not change majors, override an unfixed version, fork or patch dependencies.

Before accepting SEC-2026-001, establish physical production-only package absence, browser module-graph absence, all API entry-point dependency closure and production-input reachability. Distinguish local bundle evidence from remote artifact inspection. Require all nine exception criteria in the user request and a review no later than 2026-11-03 or immediately on an upstream fix.

If criteria pass, retain unchanged dependencies and application behavior, document all five findings and the exact approved exception, and track TASK-SECURITY-01. Existing CI does not run full audit; do not introduce a blanket vulnerability-ignore gate. Manual release gates must retain both complete and production-only audit outputs and re-evaluate any scope change.

Rerun lint/tests/build/DB validation/audits, commit and push focused documentation, verify aligned CI/Pages/Vercel and read-only schema 4 / REAL / ready / one player / ten matches. Stop on unexpected dataset changes. No provider calls, database migrations or production data writes. V1 remains NOT YET RELEASED; request a release-level choice without executing it.
