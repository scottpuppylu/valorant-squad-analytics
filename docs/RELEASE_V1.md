# V1 release preflight

> **TASK-DATA-03B.2D (2026-10-06, `full-tracked-aggregate-v1` over `analysis-match-facts-v1`, migration 0011):** full-population analysis reads one fact row per visible performance in ONE statement (6 statements total, independent of history size; was `5 + 4·⌈n/250⌉`). Facts are the exact event-metrics-v1 reconstruction, refreshed in the same per-match transaction as every evidence write and trusted only while fresh; otherwise that match is reconstructed from raw evidence. Public contract, scope semantics and every formula are unchanged (byte-identical to the previous engine). See [FULL_TRACKED_LATENCY.md](FULL_TRACKED_LATENCY.md). Not a release action; V1 is NOT YET RELEASED.

> **TASK-DATA-HISTORICAL-IDENTITY-01 (`historical-identity-v1`, 2026-10-06):** the consenting participant is now identified by the stable provider identity HMAC (`providerIdentityHmac(players[].puuid)` == the account's `provider_identities.lookup_hmac`), never by the current Riot name/tag. Identity failures are `MALFORMED_RESPONSE`, never DATABASE_ERROR, and emit no `sync_database_failure`. See [HISTORICAL_IDENTITY.md](HISTORICAL_IDENTITY.md). Not a release action; V1 is NOT YET RELEASED.

> **TASK-DATA-BULK-01C (2026-10-06):** Phase-2 DATABASE_ERROR diagnosis is blocked by observability; stage telemetry is deployed and the root cause is NOT VERIFIED. Bulk remains STOPPED / BLOCKED. V1 NOT YET RELEASED. See [BULK_DATABASE_ERROR_DIAGNOSIS.md](BULK_DATABASE_ERROR_DIAGNOSIS.md).

> **TASK-DATA-MODE-POLICY-01 (2026-10-06):** Competitive-only strength analytics are active and verified read-only in production. This is not a release action; V1 is NOT YET RELEASED. See [MODE_ELIGIBILITY.md](MODE_ELIGIBILITY.md).

> **TASK-DATA-PERFORMANCE-SCORE-01 (2026-10-06):** audit complete. The Performance Score provider field is NOT VERIFIED; ACS_SAFE. Not a release action; V1 NOT YET RELEASED. See [PERFORMANCE_SCORE.md](PERFORMANCE_SCORE.md).

> **TASK-DATA-03B.2C (2026-10-06):** the REAL website 300-match functional ceiling and the generic
> 2000 ALL/ACT/PAIR cap were removed (server-analysis-v2). This was verified read-only in production
> (tracked 332 > 300). It is not a release action; V1 is NOT YET RELEASED. See [FULL_TRACKED_ANALYTICS.md](FULL_TRACKED_ANALYTICS.md).

> **TASK-DATA-BULK-01 (2026-10-06):** the bulk backfill canary passed (≤ 12 provider requests); the full crawl is NOT
> STARTED. This is not a release action, and V1 is NOT YET RELEASED. See [BULK_HISTORY.md](BULK_HISTORY.md).

## Current dependency security gate — TASK-SECURITY-02 (2026-10-06)

Dependency security gate disposition updated.
- Full `npm audit` = 7: 5 high (GHSA-vfj7, SEC-2026-001 original subset) + 2 moderate (GHSA-rj75, SEC-2026-002).
- GHSA-68fv (source-map-js) is FIXED.
- Production audit = 0.
- Older lines in this file saying "full audit = exactly five high" or "SEC-2026-001 resolves the dependency gate" are
  historical. See SECURITY_EXCEPTIONS.md.

Production DB health is a separate gate and is still NOT VERIFIED. V1 NOT YET RELEASED.

## Current release gate — TASK-WEAPON-01.1 (2026-10-06)

`weapon-catalog-v2` (Warden → Rifle) COMPLETE / ACCEPTED. The production SQL health check is still NOT VERIFIED
(V1 gate). [SUPERSEDED by TASK-SECURITY-02: the full audit drifted to 8. One high (source-map-js) was fixed by a
compatible lockfile patch; the full audit is now 7 (5 high braces chain under SEC-2026-001 original subset + 2 moderate
under SEC-2026-002); production audit 0. Dependency security gate disposition updated — not "all vulnerabilities fixed".]
RELEASE-01 PAUSED; V1 NOT YET RELEASED.

## Earlier release gate — TASK-WEAPON-01 (2026-10-06)

Member weapon analytics (weapon-analytics-v1) COMPLETE / ACCEPTED (WEAPON_ANALYTICS.md). The production SQL
health check is still NOT VERIFIED (V1 gate). RELEASE-01 PAUSED; V1 NOT YET RELEASED.

## Earlier release gate — TASK-IDENTITY-01B (2026-10-06)

TASK-IDENTITY-01B COMPLETE / ACCEPTED: nickname support (schema 6, migration 0009) and the 9
approved community names (data migration 0010). The production SQL health check is still NOT
VERIFIED (V1 gate). RELEASE-01 PAUSED; V1 NOT YET RELEASED.

[SUPERSEDED: the earlier note said community-name assignment was pending maintainer execution.]

## Earlier release gate — TASK-IDENTITY-01 (2026-10-06)

Member identity COMPLETE / ACCEPTED (MEMBER_IDENTITY.md): 9 members × 1 account, 0 merges, schema 5.
Community names are PENDING (TASK-IDENTITY-01B). The production SQL health check is still NOT
VERIFIED and remains a V1 gate. RELEASE-01 PAUSED; V1 NOT YET RELEASED; no tag.

## Earlier release gate — TASK-DATA-FASTSYNC-01 (2026-10-06)

Opportunistic recent refresh COMPLETE / ACCEPTED (FAST_RECENT_SYNC.md). The production SQL health
check is still NOT VERIFIED and remains a V1 gate. RELEASE-01 PAUSED; V1 NOT YET RELEASED; no tag.

## Earlier release gate — TASK-PROGRESS-01 (2026-10-05)

Adaptive Improvement Index COMPLETE / ACCEPTED (PROGRESS_INDEX.md). The production SQL health check is
still NOT VERIFIED and remains a V1 gate. RELEASE-01 PAUSED; V1 NOT YET RELEASED; no tag.

## Earlier release gate — TASK-DATA-03B.2B (2026-10-05)

Server-side analytics consumption COMPLETE / ACCEPTED (SERVER_ANALYTICS.md). RELEASE-01 PAUSED;
V1 NOT YET RELEASED; no tag.

## Earlier release gate — TASK-DATA-SEASON-01 (2026-10-05)

TASK-DATA-SEASON-01 COMPLETE / ACCEPTED: production Act coverage 94.5 % (E11:A5); see SEASON_EVIDENCE.md. RELEASE-01 PAUSED;
V1 NOT YET RELEASED; no tag.

## Earlier release gate — DATA-03B.2A (2026-10-05)

DATA-03B.1 COMPLETE / ACCEPTED. DATA-03B.2 redefined as the Context-Aware Analytics Scope
Engine; 2A COMPLETE, 2B NOT STARTED. Score pages default to 目前實力. Act and rank evidence are
unavailable and labelled honestly. RELEASE-01 PAUSED; V1 NOT YET RELEASED; no tag.

## Earlier release gate — DATA-03B (2026-10-05)

DATA-03B.1 (paginated history runtime + browse consumption) is implemented;
DATA-03B.2 (all-history analytics) NOT STARTED. Analytics remain newest-300.
DATA-05A PRODUCTION ACTIVATED / ACCEPTED. RELEASE-01 remains PAUSED; V1 NOT YET
RELEASED. No release level or tag. See TASK_DATA_03B_PLAN.md.

## Current release gate — DATA-05A (2026-10-05)

Explicit human decision supersedes the Riot-response freeze below. Tracker-style
persistent Henrik history replaces lifetime-proof as current operational target.
Riot ticket #139243830 remains OPEN / informational / non-blocking; DATA-04B deferred.
RELEASE-01 PAUSED FOR DATA-05A / DATA-03B; V1 NOT YET RELEASED. DATA-03B NOT STARTED at that checkpoint.
CLI authentication and production-only CRON_SECRET setup are complete; cron
registration and both secured canaries passed: DATA-05A PRODUCTION ACTIVATED /
ACCEPTED. Daily recent/history remain enabled (UTC 18:05/18:35).
Nine public players are maintainer-confirmed expected activity. Sources 50→56,
provider counters 83→85; all original sources retained, integrity checks zero.
This is operational acceptance, not V1 release or lifetime-history proof.
See PERSISTENT_SYNC.md for limitations and exact evidence.
No release level/tag, Riot/RSO, scoring/Synergy change or destructive operation.
The following freeze and fixture descriptions remain historical evidence only.

## Current release gate — TASK-DATA-04A, 2026-10-04

TASK-DATA-04A is **WAITING ON RIOT — ticket #139243830**, **OPEN — WAITING FOR RIOT RESPONSE**. TASK-DATA-04B is **BLOCKED ON DATA-04A**. TASK-RELEASE-01 remains **PAUSED**; V1 is **NOT YET RELEASED**. No Riot provider/RSO implementation or another Production/RSO application before clarification; no API calls, production changes, DATA-03A.2 or DATA-03B execution.

**RELEASE-01 remains PAUSED; V1 NOT RELEASED.** Full lifetime history is an unmet hard requirement, not source exhaustion or newest-300 coverage. Completed docs-only [LIFETIME_HISTORY.md](LIFETIME_HISTORY.md) concludes Outcome D: reviewed Riot contracts do not document a lifetime guarantee, and `lifetimeComplete=true` cannot currently be proven. Actual Riot Production/OAuth approval is NOT VERIFIED; private friend-group eligibility requires clarification.

Acquisition is frozen: no DATA-03A.2/P1/P2 continuation, Riot/Henrik game calls, production writes, DATA-03B or release Level A/B/C / v1.0.0. DATA-03A hard-stop evidence and 30 durable sources remain preserved. DATA-04B is BLOCKED / NOT STARTED pending its access/security/product gates and explicit authorization. This supersedes earlier continuation permissions; historical preflight/security evidence below is retained, not new release approval.

Governance: SDD STRICT. TASK-RELEASE-01 / 01A are PAUSED FOR DATA-03; V1 is NOT YET RELEASED. No release level or release tag is authorized.

TASK-DATA-03A implementation/deployment is complete: independent deep-history-v1
acquisition and append-only migration 0007. Approved TASK-DATA-03A.1 production
canaries passed; full continuation STOPPED on P2 provider_repeated_page on
2026-10-04. Production acceptance is BLOCKED: P1 paused/P2 failed; neither source
is exhausted. Durable sources=30, linked matches=15/18, shared same-team=3.
Post-stop SELECT-only integrity checks passed; no retry, repair or further sync.
Public schema 4/newest-300 remains unchanged; DATA-03B NOT STARTED.
See DEEP_HISTORY.md. Prior fixture diagnosis below remains evidence, not
automatic adoption of an invariant-based release baseline. SEC-2026-001 unchanged.

Current preflight: TASK-RELEASE-01A IN PROGRESS / ON HOLD pending human approval of a revised production fixture/invariant baseline. TASK-RELEASE-01A.4 classifies the one-player/ten-match to two-player/seventeen-match drift as EXPECTED_SUPPORTED_ACTIVITY from existing Connect, sync and import records, not a code change. Actor attribution is NOT VERIFIED. The exact one-player/ten-match requirement remains unchanged and not met until human approval. Dependency security disposition remains complete under SEC-2026-001. Historical statements below are retained as historical evidence. Full audit remains five high, NOT FIXED; production audit zero. No release Level A/B/C or v1.0.0 authorization.

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

The dependency-only preflight gate is resolved WITH DOCUMENTED DEV-ONLY SECURITY EXCEPTION SEC-2026-001. Overall TASK-RELEASE-01A remains IN PROGRESS / ON HOLD because the required production fixture no longer matches (see below). TASK-RELEASE-01 remains IN PROGRESS, V1 NOT YET RELEASED. CI/Pages/Vercel final-commit verification is reported at handoff. Migration NONE, Henrik calls 0, production data writes NONE. No Connect/import/sync, production health SQL rerun, release level or release tag.

Final local rerun for this disposition: lint PASS; 21 files / 317 tests PASS (21.97s); source secret scan PASS; build PASS (711 modules, 3.18s; main 363.14 kB / 116.46 gzip, charts 339.21 / 99.53, CSS 40.17 / 9.15; unchanged output hashes); dist secret scan PASS; DB foundation validation 1 file / 15 tests PASS (17.49s). Full audit still FAILS, exactly five high; production audit PASS, zero vulnerabilities. No new tests were needed for documentation-only changes.

### Unexpected production fixture — acceptance hold

After pushing 988c372, the canonical dataset GET returned HTTP 200/no-store, schema 4, ready, **two players / seventeen matches**, instead of the explicitly expected one / ten. A second read-only aggregate check confirmed the same counts. No identities, payloads or rows were archived; no provider calls or production writes were made by this task. Cause and authorization of this external state change are NOT VERIFIED. Dependencies, application code and output hashes remain unchanged in this task.

Stop data-related validation and do not repair, delete, reimport, sync or rerun production SQL. Human confirmation of the intended current fixture and authorization of revised read-only acceptance are required before closing RELEASE-01A or selecting a release level. The security disposition remains valid for the unchanged application dependency boundary; the exact production acceptance is NOT MET. Final-commit deployment status can still be observed read-only without altering data.

## TASK-RELEASE-01A.4 — read-only fixture drift diagnosis, 2026-10-03

Status: diagnosis COMPLETE; human baseline adoption gate OPEN. Classification:
**EXPECTED_SUPPORTED_ACTIVITY**. This task explicitly authorized SELECT-only SQL,
existing public dataset GET and bounded runtime-log reads, superseding the preceding
SQL pause only for this diagnosis. No application/package changes, production writes,
provider calls, migration, release-level execution or release tag.

Starting HEAD: `81c2832d65dcedaccfcded611cc9e6ce798b6031`, clean main equal to
origin/main. Changes since `846c464` are governance/documentation only. Final HEAD
remains unchanged; this diagnosis is a local documentation update, not a deployment.

### Sources, cutoff and limitations

Three successful SELECT-only aggregate queries used the Vercel Neon Query console
with Read-only checked. P1/P2 are assigned by players.created_at ascending (internal
tie-breaker only); no identity mapping is retained. Evidence below contains only
anonymous aggregate counts, states and timestamps. Current canonical dataset GET
returned HTTP 200, no-store, schema 4, REAL, ready, two players, seventeen matches,
twenty performances, snapshot present and isDemo=false. The snapshot is the actual
`snapshot` object, not a presumed `snapshotId` field.

The documented prior 1/10 acceptance GET window is 2026-10-03 16:56:28–16:57:33
Asia/Taipei. Its end, `2026-10-03T08:57:33Z`, is the source-observation cutoff.
Later historical 1/10 closure has no exact timestamp in this document; do not invent
one. All timestamps in the following tables are UTC unless explicitly marked local.

Requested runtime-log window: 16:55–22:48 Asia/Taipei. Vercel rejected its start as
outside the allowed range. Successfully inspected 22:15–22:48 instead, with no more
logs to show. The older 16:55–22:15 portion is NOT VERIFIED. Logs cover the causal
activity and first previously observed 2/17 reads, but do not prove complete historical
activity or human identity. Only route/method/status/timestamp are recorded here.

### Anonymous creation and eligibility

| Field | P1 | P2 |
|---|---|---|
| Player created_at | 2026-10-02 17:06:47.684854 | 2026-10-03 14:41:29.825320 |
| Player updated_at | 2026-10-03 14:36:08.335240 | 2026-10-03 14:41:29.825320 |
| Provider identity created_at / updated_at | Both 2026-10-02 17:06:47.684854 | Both 2026-10-03 14:41:29.825320 |
| Consent consented_at | 2026-10-02 17:06:47.576000 | 2026-10-03 14:41:29.714000 |
| Consent created_at | 2026-10-02 17:06:47.684854 | 2026-10-03 14:41:29.825320 |
| Membership joined_at | 2026-10-02 17:06:47.684854 | 2026-10-03 14:41:29.825320 |

Both players: non-anonymized=true, active membership=true, exactly one active
self_asserted consent on `2026-10-02-public-v1`, provider identity present=true,
management verifier present=true and verifier version valid=true. P2 was created
at 22:41:29.825320 Asia/Taipei, after the documented acceptance cutoff. This is a
new player, not merely an old player becoming publicly eligible.

### Visibility, seven-match delta and source timeline

| Matrix | Count |
|---|---:|
| P1 visible performances | 10 |
| P2 visible performances | 10 |
| Shared matches | 3 |
| P1-only | 7 |
| P2-only | 7 |
| Union | 17 |
| Shared same-team matches | 3 |

Union reconciles exactly: 10 + 10 - 3 = 17. Of the current union, 10 source matches
were observed before the cutoff and 7 were first observed after it. The seven-match
increase is **seven newly persisted unique source matches**, not seven previously
stored source matches becoming public. P2 also links to three already-public shared
matches; those links add performances, not unique matches.

| Source timeline | P1 (10) | P2 (10) |
|---|---|---|
| Minimum first_observed_at | 2026-10-02 17:07:03.855 | 2026-10-02 17:07:03.855 |
| Maximum first_observed_at | 2026-10-02 17:09:02.350 | 2026-10-03 14:41:56.423 |
| Minimum last_observed_at | 2026-10-03 14:37:06.676 | 2026-10-03 14:41:56.423 |
| Maximum last_observed_at | 2026-10-03 14:41:56.423 | 2026-10-03 14:41:56.423 |
| First observed before / after cutoff | 10 / 0 | 3 / 7 |

The seven new sources split into one at 14:41:38.022 and six at 14:41:56.423 UTC.
Their timestamps align with P2's backfill then bounded import respectively. This
path attribution is supported by matching DB chronology, successful route logs and
the source-code persistence path, not by actor identity or raw request-body access.

### Sync runs and cursors

All runs below have trigger_kind=manual. Counters are persisted run counters, not
unique newly inserted source totals; overlap/upsert must not be counted as new matches.

| Player/kind/status | Started UTC | Completed UTC | Pages | Seen | Persisted | Overlap | Provider requests | Termination |
|---|---|---|---:|---:|---:|---:|---:|---|
| P1/backfill/complete (before cutoff) | 10-02 17:06:59.362 | 10-02 17:09:46.770 | 2 | 6 | 6 | 3 | 2 | no_older_unique_matches |
| P1/incremental/complete | 10-03 14:36:22.339 | 10-03 14:36:33.505 | 1 | 3 | 3 | 3 | 1 | known_boundary |
| P1/incremental/complete | 10-03 14:36:38.372 | 10-03 14:36:48.563 | 1 | 3 | 3 | 3 | 1 | known_boundary |
| P2/backfill/paused | 10-03 14:41:35.254 | NULL | 1 | 3 | 3 | 2 | 1 | NULL |

| Player/kind | Last success = updated_at UTC | Coverage from UTC | Coverage to UTC | Complete provider window | Retries |
|---|---|---|---|---|---:|
| P1/backfill | 10-02 17:09:46.770 | 09-27 13:00:31.840 | 10-02 16:03:54.035 | false | 0 |
| P1/incremental | 10-03 14:36:48.563 | 09-30 16:48:19.871 | 10-02 16:03:54.035 | true | 0 |
| P2/backfill | 10-03 14:41:45.901 | 10-02 15:29:21.925 | 10-03 09:35:27.566 | false | 0 |

Coverage dates are all in 2026. After acceptance, P1 had two successful incremental
runs and P2 one successful persisted backfill chunk. P2 paused is an intended chunk
boundary, not a failed sync or complete history: postgresSyncStore.commitPage sets
paused/completed_at=NULL when there is no terminal reason and releases the lease.
Current scoped sync health: failed=0, running=0, paused=1, run errors=0, cursor errors=0,
lease presence=0, invalid coverage ranges=0. Do not resume the paused run in this task.

### Bounded Vercel route activity

22:15–22:48 Asia/Taipei, displayed request rows, including existing deployment aliases
for dataset reads; successful write-route rows are on the canonical production host.

| Method/route | HTTP | Count |
|---|---:|---:|
| POST /api/valorant/account/resolve | 200 | 2 |
| POST /api/valorant/account/resolve | 400 | 3 |
| POST /api/valorant/matches/import | 200 | 2 |
| POST /api/valorant/sync/start | 200 | 4 |
| GET /api/valorant/dataset | 200 | 9 |
| GET /api/valorant/provider/status | 200 | 2 |

No consent/revocation/deletion or sync/continue rows were shown in this window.
This is not proof that those routes have never been used. HTTP 400 resolve rows
do not establish their request content/cause or actor; none were inspected.

Successful relevant request timestamps (local): resolve 22:36:05.993 and
22:41:26.652; import 22:37:03.376 and 22:41:52.542; sync/start 22:36:12.212,
22:36:21.569, 22:36:37.367 and 22:41:33.752. Extra sync/start success is not an
extra persisted run: only the DB run records above establish persisted work.
First historical 2/17 read observations align with GETs at 22:46:46.843 and
22:47:25.486. Runtime logs alone contain no dataset-count payload proof.

### Public Connect mutability and data health

Code inspection confirms **YES**: a normal visitor can use Connect without a
site account/login, supply Riot Game Name/Tag/affinity and explicit current-policy
consent, then resolve and bounded-import. Resolve/import handlers apply validation,
rate limits and durable consent gates, not a viewer login or Riot ownership proof.
The server retains provider credentials. See src/pages/ConnectPage.tsx,
api/valorant/account/resolve.ts, api/valorant/matches/import.ts, server/validation.ts,
server/henrikDataProvider.ts and server/persistence/durableEvidenceService.ts.
Production counts are consequently mutable independently of Git deployments.
Self_asserted consent is product-flow consent, not proof of human identity/ownership.

P2: candidates=10, basic-gate emitted=10, failures=0, observed stats=10,
complete participant round presence=10; durable-evidence-v2=10; rounds total=191,
minimum=8, maximum=28; source rounds/kills evidence observed/observed=10.
P1 likewise emits 10/10, failures=0, complete presence=10, total rounds=222.
Public response contains 20 performances: KAST/Opening statuses partial/partial=19,
reconstructed/reconstructed=1 across both players. Raw observed events do not imply
all advanced metrics or scores are reconstructed. No scoring/Synergy recalculation
or formal release-level validation was performed.

Duplicate active-consent, provider-identity, membership, source-match uniqueness,
public-player duplication and active-consent/revoked-timestamp checks: all 0.
P1/P2 revoked consent counts=0, open deletion jobs=0, non-anonymized=true and
current active membership/consent valid. No revoked/deleted player reappearing is
indicated. These are scoped checks, not a repeat of the full historical 27-edge audit.

### Release implication and human gate

Actor attribution: **NOT VERIFIED**; do not name or infer the actor. The supported
path is verified separately from actor/ownership. SEC-2026-001 remains valid for the
unchanged dependency/runtime/input-path boundary; no security fix is claimed.

Level B prerequisite: POSSIBLE (two independent valid basic REAL performance sets).
Level C prerequisite: POSSIBLE (three shared same-team matches). These are prerequisite
discoveries only, not Level B/C acceptance, score availability or a V1 release.

Recommend retiring an exact 1/10 fixture in favor of a human-approved dynamic baseline:
schema 4, REAL, ready, an agreed minimum of current-policy consenting players, valid
projection contracts, no Demo fallback and zero relational/consent/sync/deletion
inconsistencies (legitimate paused/incomplete coverage represented honestly).
**Recommendation only; acceptance criteria are not adopted or rewritten by this diagnosis.**
Ask the human to approve current validated 2/17 state and invariant-based acceptance.
TASK-RELEASE-01A stays IN PROGRESS / ON HOLD; TASK-RELEASE-01 IN PROGRESS;
V1 NOT YET RELEASED. No Level A/B/C starts automatically.

### Documentation quality gates — current worktree

- npm run lint: PASS, exit 0.
- npm test: PASS, 21 files / 317 tests, 29.97s; source secret-boundary check PASS.
- npm run build: PASS, exit 0, 711 modules, Vite build 5.32s; built secret-boundary
  check PASS. Main 363.14 kB / 116.46 gzip; charts 339.21 / 99.53; CSS 40.17 / 9.15.
- npm audit --omit=dev: PASS, exit 0, zero vulnerabilities.
- npm run db:validate: PASS, 1 file / 15 tests, 27.12s; local PGlite validation,
  not a production migration or write.
- npm audit: exit 1, exactly five high findings in the unchanged documented
  dev/build dependency chain. NOT FIXED; existing SEC-2026-001 applies.
- git diff --check: PASS. No new tests or dependency changes needed for docs only.

Only docs/RELEASE_V1.md and docs/TASKS.md changed locally. No commit, push or
deployment was requested/performed by this read-only diagnosis.
