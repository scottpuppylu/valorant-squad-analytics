# Tracker-style persistent scheduled sync

TASK-DATA-05A — SDD STRICT, 2026-10-05. Status: implementation/local gates complete;
production registration and canaries **NOT VERIFIED / NOT ENABLED**.

## Product contract

Maximize and permanently accumulate observable Henrik history in Neon, subject
to existing consent/deletion rules. Never remove a stored match because a later
provider window omits it. HMAC source uniqueness and existing evidence transactions
remain authoritative. Raw DTOs and identifiers remain server-only/in-memory.
`lifetimeComplete=false` always. Source exhaustion is not lifetime proof.
Public schema 4/newest-300 and scoring/Synergy/reconstruction are unchanged.

Riot ticket #139243830 remains OPEN — WAITING FOR RIOT RESPONSE, informational
and non-blocking. DATA-04B deferred; DATA-03B not started. RELEASE-01 is paused
for DATA-05A / DATA-03B; V1 not released. Prior freeze is superseded by explicit
human decision, not by deployment success.

## Jobs and authorization

GET `/api/valorant/cron/recent` and `/api/valorant/cron/history` require exact
`Authorization: Bearer <CRON_SECRET>`, compared in constant time. Missing secret
returns 503; absent/wrong/array authorization returns 401 before runtime creation.
Never put the secret in logs, URLs, browser source, Git or reports.

Registration is intentionally omitted from vercel.json while CLI credentials
are unavailable. Cached CLI 48.0.0 `whoami` reports no credentials. The operator
must authenticate CLI, securely generate/set production-only sensitive CRON_SECRET
through stdin (not command arguments/chat), then deploy the schedule configuration.
Do not overwrite an existing secret without checking whether it already exists.

Pending registration (UTC, daily only):

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

Current environment stop: no CLI authentication, no secret set, no registration,
no canary/provider calls or production gameplay writes. Historical baseline of
two players/30 durable sources is preserved evidence, not a fresh database query.
