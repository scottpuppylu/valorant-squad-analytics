# TASK-SYNERGY-01 — SDD STRICT execution plan

Starting HEAD: a6c3172cf581fb82683de9fa111b750f93b2a2de; clean main = origin/main.
Checkpoint: checkpoint-before-synergy-01.

Baseline (2026-10-03): lint exit 0; 18 files / 241 tests passed in 23.65s;
build exit 0, 697 modules, 4.61s; audit 0 vulnerabilities; DB validation 15 tests in 16.07s.
Baseline payloads: 22,803 bytes (1p/30m), 680,332 bytes (4p/300m), six queries each.

## Contract-first implementation

1. Schema 3: opaque match-local team groups, per-performance outcomes, compact visible-pair trade edges from the existing event-metrics-v1 classification. Six queries; no migration.
2. Pure pair domain: selected date/map/mode first, same-team shared samples, independent without-partner baselines, exclude opponents. Reuse unchanged community-score-v2. Versioned centered index, gates, shrinkage and independent confidence.
3. Product: Chinese selectors, matrix/shortlist/detail/trace, shareable public-ID filters; deterministic varied Demo; intentional empty REAL. No agent/role or ambiguous recent-N global filters; use explicit date range.
4. Regression tests for outcomes, privacy, missing/partial/neutral evidence, asymmetry, filters, trade linkage and bounded payload/performance. Document formulas and boundaries.
5. Current-worktree lint/test/build/audit/db gates, desktop/390px browser verification, focused commits, push, CI/Pages/Vercel and empty-production schema validation.

## Boundaries

No provider calls, player creation/reconnection, consent-policy changes, individual score changes,
new browser REAL cache, persistent pair scores, raw event projection or UI refinement task.
Non-empty production pair path may remain NOT YET EXERCISED; fixture verification is mandatory.
Task status: COMPLETE. Implementation release 25cd731 passed all release gates; this acceptance-only
documentation commit is also pushed and its final deployment statuses are verified at handoff.

## Release acceptance — 2026-10-03

- Local lint exit 0; 19 files / 270 tests passed, 20.69s; secret boundary passed.
- Production build exit 0, 706 modules, 3.23s; main JS 449.24 kB / 141.81 kB gzip;
  CSS 34.08 / 7.91 kB; HTML 0.71 / 0.49 kB; radar chunks 1.27 / 0.86,
  16.08 / 5.68 and 339.53 / 99.68 kB. Dist secret boundary passed.
- npm audit: 0 vulnerabilities. DB validation: 15/15 tests, 15.31s. No migration.
- CI success: https://github.com/scottpuppylu/valorant-squad-analytics/actions/runs/37042651011
  (verify job 87s).
- Pages success: https://github.com/scottpuppylu/valorant-squad-analytics/actions/runs/37042651390
  (build 91s; deploy 8s).
- Vercel Ready, production source 25cd731, duration 3m 28s:
  https://vercel.com/scottpuppys-projects/valorant-squad-analytics/8Yg2xJkQFuxRsz7NNhBMEfpyLHjx
- Local Demo, public Pages and canonical Vercel: seven routes each at desktop 1440px and mobile 390px;
  nonblank, no page-level horizontal overflow, no internal task labels, console errors 0.
  Matrix selection, asymmetric member detail, contextual filtering and trace verified on Demo.
- Production read HTTP 200, Cache-Control no-store, schema 3, dataset-read-v3,
  synergy-ready-projection-v1, REAL empty: 1 public player / 0 matches. Synergy gives the
  two-public-player requirement, not Demo fallback. No provider/database identifiers in the response.
- Bounded fixtures: 1p/30m 24,843 bytes, six queries, pair calculation 0.611ms;
  4p/300m 813,532 bytes, six queries, six observed pairs / 1,800 pair-match tuples,
  pair calculation 88.452ms. These are local observations, not production latency guarantees.
- Individual scoring, consent policy and migrations 0001–0006 unchanged. No provider call,
  production player creation/reconnection, sync, revocation or deletion.
- Non-empty production Synergy: NOT YET EXERCISED. TASK-UI-01 recommended only, NOT STARTED.
