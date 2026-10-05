# TASK-DATA-05A — SDD STRICT execution plan

Starting HEAD: 9e5be422722ccb959372df291a7515e7b8ee437c.
Checkpoint: checkpoint-before-data-05a-scheduled-sync (pushed).

The explicit 2026-10-05 product decision supersedes the Riot-response freeze.
Target: permanently accumulate observable Henrik history subject to existing
consent/deletion rules; never infer lifetime completeness. Riot/RSO, DATA-03B,
scoring, Synergy and V1 release are out of scope.

1. Verify baseline, then implement authenticated, serial, bounded cron coordination.
2. Reuse current leases/consent/upsert boundaries. Preserve manual trigger defaults.
3. Persist repeated-page backoff; third live stall falls back to stored discovery.
4. Reconcile terminal sweeps after 7/30 days without deleting evidence or identities.
5. Test eligibility, budgets, auth, recovery, reconciliation and persistence.
6. Update governance and honest product copy; run all quality gates.
7. Commit/push and verify deployment. Enable schedules only after secure production
   CRON_SECRET configuration. Execute one recent and one history canary; recurring
   work requires both canaries to pass. If secret cannot safely be set, stop before
   registration/canaries and report the environment gate.

Historical implementation environment gate: cached Vercel CLI 48.0.0 is available, but `whoami`
reports no existing credentials. No secret generated, no cron enabled, no provider
call or production gameplay write performed.

Baseline: lint PASS; 23 files / 339 tests PASS (51.68s), source boundary PASS;
build PASS (712 modules, 5.04s), dist boundary PASS; production audit zero;
db:validate 16 PASS (20.63s). Full audit exit 1 / five high under SEC-2026-001,
NOT FIXED. No dependency modification.

Implementation verification: lint PASS; 24 files / 352 tests PASS (47.40s),
source boundary PASS; build PASS (712 modules, 2.81s), dist boundary PASS;
main 363.14 kB / 116.45 gzip, chart 339.21 / 99.53, CSS 40.17 / 9.15,
Connect 22.46 / 7.53. Production audit zero; DB 16 PASS (18.81s).
Full audit remains five high, NOT FIXED. No migration created/applied.
Local Chrome Connect renders, disabled Demo connection and zero console errors.
Port 5173 EACCES; alternate 4173 runs successfully. REAL progress/cron provider
end-to-end NOT VERIFIED (secret gate); no consenting identity entered.

Deployment correction: commit 0ec2374 failed Vercel output deployment because
13 functions exceeded the Hobby maximum of 12. Merge the two cron entrypoints
into `api/valorant/cron/[job].ts`, preserving both URLs, exact bearer auth and
the secret activation gate. No other API or gameplay behavior changes. Re-run
local quality gates and verify the replacement deployment before handoff.

Correction gates: lint PASS; 24 files / 353 tests PASS (44.46s), source boundary
PASS; build PASS (712 modules, 3.97s), dist boundary PASS; bundle sizes unchanged.
Production audit zero; full audit five high (SEC-2026-001, NOT FIXED);
DB validation 16 PASS (18.36s). No dependency/schema/cron registration changes.

Activation continuation: official CLI 62.2.0 authenticated via existing Ubuntu
WSL (Windows non-ASCII hostname header defect); existing project reused,
production-only sensitive CRON_SECRET securely configured through stdin.
d8b7b897c5ff5ae4093af0d33de8aee4a3da7e9e registered the daily UTC 18:05/18:35
jobs; production READY, CI/Pages PASS. Exactly one recent and one history Run
canary passed HTTP 200, provider counters 83→84→85, sources 50→53→56, all 50
original sources retained; 9 eligible/public players confirmed expected.
Zero integrity/consent/deletion contradictions, orphans, duplicates or leases;
ledger 0001–0007 unchanged. See PERSISTENT_SYNC.md for aggregate evidence and
NOT VERIFIED production branches. DATA-05A PRODUCTION ACTIVATED / ACCEPTED.
Recurring eligible-player acquisition authorized; no DATA-03B or V1 release.

Final acceptance-copy worktree gates: lint PASS; 24 files / 353 tests PASS
(43.18s), source boundary PASS; build PASS (712 modules, 3.89s), dist boundary
PASS. Main 363.14 kB / 116.46 gzip, chart 339.21 / 99.53, CSS 40.17 / 9.15,
Connect 22.50 / 7.53; HTML 0.71 / 0.49. Production audit zero; full audit
five high under SEC-2026-001, NOT FIXED. DB validation 16 PASS (17.87s),
disposable local PGlite only. No dependency/schema changes. Post-canary all
3 deep cursors are live_v4, live/stored exhaustion false; lifetimeComplete=false.
