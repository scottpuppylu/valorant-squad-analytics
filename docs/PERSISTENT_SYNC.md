# Tracker-style persistent scheduled sync

TASK-DATA-05A — SDD STRICT, 2026-10-05. Status: implementation/local gates complete;
**PRODUCTION ACTIVATED / ACCEPTED**; both secured production canaries passed.

## Product contract

Maximize and permanently accumulate observable Henrik history in Neon, subject
to existing consent/deletion rules. Never remove a stored match because a later
provider window omits it. HMAC source uniqueness and existing evidence transactions
remain authoritative. Raw DTOs and identifiers remain server-only/in-memory.
`lifetimeComplete=false` always. Source exhaustion is not lifetime proof.
Public schema 4/newest-300 and scoring/Synergy/reconstruction are unchanged.

TASK-DATA-03B.2B (2026-10-05): analytics read all accumulated durable history server-side; cron
unchanged. Concurrent cron writes cannot loop or double count analysis requests (SERVER_ANALYTICS.md).

TASK-DATA-SEASON-01 (2026-10-05): every cron/manual upsert now persists v4 season metadata
(never erasing known values), and deep stored-index pages fill season for already durable,
participant, consented matches. No new route or cadence change. See SEASON_EVIDENCE.md.

DATA-03B.2A (2026-10-05) adds the analytics scope engine and `view=analytics`
facts without changing acquisition. Season metadata and rank observations are still not
persisted (TASK-DATA-SEASON-01 / TASK-DATA-RANK-01, not started); cron unchanged.

DATA-03B.1 (2026-10-05) makes all accumulated eligible history browsable through
bounded keyset pages (`/api/valorant/dataset?view=history`) without pausing cron.
Pages tolerate concurrent cron inserts without duplicates or loops (see
TASK_DATA_03B_PLAN.md). Analytics still use newest-300; DATA-03B.2 NOT STARTED.

Riot ticket #139243830 remains OPEN — WAITING FOR RIOT RESPONSE, informational
and non-blocking. DATA-04B deferred; DATA-03B.1 implemented, DATA-03B.2 not started. RELEASE-01 is paused
for DATA-05A / DATA-03B; V1 not released. Prior freeze is superseded by explicit
human decision, not by deployment success.

## Jobs and authorization

Both URLs share `api/valorant/cron/[job].ts`, which dispatches only `recent` and
`history`. This keeps the project at 12 Vercel Functions within the Hobby limit;
unknown or ambiguous jobs fail closed without constructing a sync service.

GET `/api/valorant/cron/recent` and `/api/valorant/cron/history` require exact
`Authorization: Bearer <CRON_SECRET>`, compared in constant time. Missing secret
returns 503; absent/wrong/array authorization returns 401 before runtime creation.
Never put the secret in logs, URLs, browser source, Git or reports.

Authentication completed through official CLI 62.2.0 in existing Ubuntu WSL.
Windows CLI login fails on a non-ASCII hostname HTTP header; no CLI patch or
machine-name change was used. Existing project/team/link and Git repository are
preserved. Production-only sensitive CRON_SECRET was absent and securely added
through stdin; no value was printed or retained in Git. Sensitive production
variables cannot be pulled locally. Use the supported Vercel cron Run control
for canaries and the verified read-only database Query editor for health checks.

Registered production configuration (verified Vercel Cron Jobs UI, UTC, daily only):

```json
"crons": [
  { "path": "/api/valorant/cron/recent", "schedule": "5 18 * * *" },
  { "path": "/api/valorant/cron/history", "schedule": "35 18 * * *" }
]
```

Nominal Taipei times: 02:05 and 02:35. Hobby only guarantees hourly precision,
so these are not exact next-run promises; no nextScheduledRefresh is exposed.
[Current Vercel limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) allow
daily jobs; [cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
documents concurrent/duplicate invocations and secret protection.

Both jobs share a transaction-scoped nonblocking advisory lock (50501,1) held
on a dedicated Neon pool connection; contention returns partial/busy with no
provider work. Existing per-player/kind 45-second cursor leases remain intact.
Serial chunks are spaced at least seven seconds. At most four players/chunks;
40-second work envelope, conservatively stop starting chunks after 15 seconds
to reserve the existing 25-second useful-work allowance. 60-second platform
timeout is the final bound, not a promise every slow database transaction ends
within 40 seconds. No hidden provider retry loop. Retryable failures retain
durable backoff; malformed/database errors stop the invocation. Responses contain
aggregate eligibility/processing/pause/partial state, no player/run IDs or secrets.
observedRunProviderRequests is explicitly cumulative run telemetry, not a canary
request delta or invocation total.

## Eligibility and fairness

Current-policy self_asserted active consent, active membership, non-anonymized
player, Henrik identity and no open deletion job are all required. Selection
also excludes active leases and future nextAttemptAt; service rechecks consent
before requests, writes and cursor commits. Never auto-upgrade consent.

Recent: existing incremental start/resume; newest overlap to known boundary.
Due when no cursor/run or no successful incremental page in 20 hours; never
synced first then oldest last_success_at. Newly created audit runs are scheduled,
manual remains the default. Existing run trigger labels are never rewritten.

History: retry-ready paused/running/pending deep work first, including the existing
failed provider_repeated_page run (P2); then never-started players; then incomplete
terminal sweeps past seven days; exhausted sweeps past thirty days. Within each
priority rotate by cursor updated_at (oldest first), public UUID breaks ties.
Existing P1/P2 runs resume rather than bypassing a stall with duplicate runs.

## Repetition and reconciliation

First repeated live fingerprint: paused PROVIDER_PAGINATION_UNSTABLE, five-minute
backoff; second: thirty minutes. Persist no duplicate evidence, advance no offset.
Third consecutive repetition: stored_index, live exhaustion false, incomplete
reason live_v4_pagination_stalled. Different valid page resets retries normally.
Existing retry fields and pagination_repeat reason identify consecutive repeats.

Stored mutable pages restart idempotently on change. Repetition first pauses/backoffs;
third ends the sweep incomplete. Known HMAC sources skip detail, unknown sources
use at most one full detail per chunk, permanent unavailable detail is counted.
Compact index rows never manufacture event evidence.

Full exhausted sweep: both flags true, phase complete, sourceExhausted true.
Partial terminal sweep: run complete, unresolved cursor remains stored_index,
partial_source_coverage, sourceExhausted false. This satisfies migration 0007's
constraint that phase complete requires both sources exhausted. No migration 0008.

After cooldown a conditional lease transaction resets only traversal, retry and
fingerprint fields, creates a new scheduled audit run and retains cumulative
coverage and all source/participant/round/event/rank/consent/identity rows. A new
upstream A/B/C/D/E view extends prior A/B/C; later X/A/B never deletes C/D/E.

## Production acceptance gates

Implementation and deployments do not activate recurring provider work. With
secret securely configured, validate exactly one recent and one historical canary,
reusing eligible P1/P2 state. Then SELECT-only aggregate health: uniqueness,
links/orphans, current consent, memberships, deletion, leases, errors and ledger.
Only both PASS authorize normal recurring operation. Do not leave registered cron
running after a failed canary: remove registration/disable scheduling and inspect.
No player reconnect, destructive operation, raw archive, Riot/RSO, DATA-03B or V1 tag.

Pre-activation SELECT-only baseline (2026-10-05): 9 eligible/public players,
9 current-policy consents/memberships, 50 durable sources, provider run counters
83. Zero duplicates, participant/round/event/round-participant orphans, leases
and open deletion jobs; ledger 0001–0007. Incremental: 3 complete manual runs;
deep: 2 paused and 1 failed manual run. The 9 players are maintainer-confirmed
expected activity, not a fixture defect. No canary has run at this checkpoint.

## Activation acceptance — 2026-10-05

Starting HEAD 2c45e857fe2248be85ee54e5f3f615ab18af1ad8; activation commit
d8b7b897c5ff5ae4093af0d33de8aee4a3da7e9e. Existing project production deployment
dpl_Eu91SGVCQwThTS1Rune9DBEbU8zu READY (build 3m50s, post-build 17s), GitHub CI
and Pages passed. Vercel settings displayed both paths/schedules and Enabled.
Exactly one visible Run click for each job; no direct Henrik request, manual
sync bypass, secret extraction, identity reset or deletion. The Run control
uses deployed cron authorization; both requests returned HTTP 200.

Pre-canary SELECT-only timestamp 2026-10-05T05:50:43.717022Z: 9 eligible/public,
9 active memberships/current-policy consents, 50 sources, provider counters 83.
Recent: one new scheduled incremental run, paused for bounded continuation;
one provider request, 3 persisted sources, chunk 10.349s. Intermediate sources
53 / counters 84. History: existing paused manual deep run resumed unchanged
(trigger_kind remains manual), live_v4, one provider request, 3 persisted sources,
chunk 10.627s, paused safely. No new deep run was manufactured. Each UI invocation
had completed by its first 45-second observation; no platform timeout observed.
Exact whole-request duration is NOT VERIFIED; chunk durations are runtime traces.

Post-canary SELECT-only timestamp 2026-10-05T05:53:55.595585Z: 56 sources /
counters 85 (+2 total, recent +1, history +1); all 50 pre-canary sources retained.
Players/memberships/consents remain 9. Duplicates, participant/round/kill-event/
round-participant/assistant/location orphans, consent-membership contradictions,
deletion contradictions, ineligible pending/running runs, open deletion jobs,
active/stale leases all zero. Ledger unchanged 0001–0007; no migration applied.
Incremental: 3 complete manual, 1 paused scheduled. Deep: 2 paused manual,
1 legacy failed manual (unchanged). Backfill: 2 complete / 1 paused manual.
No new failed run; retries zero, no backoff active. Existing legacy failure is
not repaired/bypassed by this acceptance. No observed concurrent manual write.

Both canaries PASS: no runaway request, consent/integrity violation or source
loss; recurring cron remains enabled and future normal eligible-player work is
authorized. lifetimeComplete=false; neither provider window nor sweep exhaustion
proves lifetime completeness. No live pagination repetition occurred: first
5-minute, second 30-minute, third stored_index recovery and legacy failed-run
selection are **NOT VERIFIED in this production canary**, tested locally only.
Do not generate repeats or run another canary to exercise these branches.
Recent cold-start emitted Node DEP0169 url.parse deprecation warning; HTTP 200,
no identity/credential warning payload. No dependency force-fix in this task.

Local activation gates: lint PASS; 24 files / 353 tests PASS (49.26s), source
boundary PASS; build PASS (712 modules, 5.20s), dist boundary PASS; production
audit zero; DB validation 16 PASS (27.62s). Full audit five high, SEC-2026-001,
NOT FIXED. Final acceptance-copy gates recorded in TASK_DATA_05A_PLAN.md.
DATA-03B recommended next, NOT STARTED; RELEASE-01 PAUSED, V1 NOT YET RELEASED.
