# Development tasks

> **AUTHORITATIVE STATUS** lives in the table under "Current stage" in AGENTS.md. Sections below
> are dated decisions; status words inside "Earlier decision" sections are **historical** and
> are marked [SUPERSEDED] where they conflict with current state.

## Current decision — TASK-RELEASE-BLOCKER-FIX-01 (2026-10-08)

**STATUS: COMPLETE / RELEASE_CHECKPOINT_READY = YES (checkpoint attempt 2).** The tag
`checkpoint-local-release-pre-public-01` is local only. Nothing was pushed.
- Revocation now clears the revoked planter's / defuser's plant and defuse coordinates in shared matches. Four
  permanent tests failed before the fix and pass after it.
- The third-party Neon skill is removed from the release tree. Its history is kept; the clean release branch keeps it
  off the remote.
- Next: PUBLIC-ROLLOUT-PREFLIGHT-01 (the Vercel / Neon / Pages push side effects).
- Details: [LOCAL_RELEASE_CHECKPOINT.md](LOCAL_RELEASE_CHECKPOINT.md) §13.

## Earlier decision — LOCAL-RELEASE-CHECKPOINT-01 (2026-10-08)

**STATUS: COMPLETE / RELEASE_CHECKPOINT_READY = NO.** No tag was created and nothing was pushed. [SUPERSEDED: attempt 2 READY, see TASK-RELEASE-BLOCKER-FIX-01.]
- Every verification gate passed except one blocking finding.
- **Blocker:** after a shared-match revocation, the revoked planter's / defuser's round plant and defuse coordinates
  (migration 0012 columns) are not cleared.
- Next: a separately authorized deletion fix, then a re-run of this checkpoint.
- Details: [LOCAL_RELEASE_CHECKPOINT.md](LOCAL_RELEASE_CHECKPOINT.md).

## Earlier decision — TASK-ANALYTICS-TEAM-COMPOSITION-02 (2026-10-08)

**STATUS: COMPLETE / OUTCOME_B / AWAITING SDD REVIEW (local only, not pushed).**
- team-composition-v2 adds holdout-gated attack / defense responsibilities to the unchanged V1 assignment.
- site-reference-v1 classifies held-out plants with P95 accuracy 0.948 (0 wrong site, 0 ambiguous).
- Member-level site tendencies did not reproduce (1 of 6), so every site claim is withheld.
- V1 output is byte-identical, and Shared-Match, rank, facts and basic stats are unchanged.
- This is the final analytics feature task.
- Next (not started automatically): LOCAL_RELEASE_CHECKPOINT → PUBLIC_ROLLOUT_PREFLIGHT → SOURCE PUSH. [SUPERSEDED: checkpoint ran; READY = NO.]
- Details: [TEAM_COMPOSITION_V2.md](TEAM_COMPOSITION_V2.md).

## Earlier decision — TASK-DATA-MAP-ZONE-METADATA-01 (2026-10-08)

**STATUS: STOPPED FOR SDD REVIEW. OUTCOME_D.**
- No transform or callout source has acceptable provenance; the third-party source is unofficial and all rights
  reserved.
- Provider plant-site labels are a validated, license-free site reference in raw coordinates.
- SDD decides among: provider-site references for V2, a licensed transform source, or proceeding to the release
  checkpoint. [SUPERSEDED: SDD chose provider-site references; see TASK-ANALYTICS-TEAM-COMPOSITION-02.]
- Details: [MAP_SPATIAL_METADATA.md](MAP_SPATIAL_METADATA.md).

## Earlier decision — TASK-DATA-POSITION-NORMALIZATION-01 (2026-10-08)

**STATUS: COMPLETE / AWAITING SDD REVIEW.**
- position-evidence-v1 fixes the nested `player_locations` parser and normalizes view direction, plant site and
  coordinates, defuse coordinates and explicit round side (migration 0012).
- The rebuild is identical across two runs; all analytics are unchanged.
- MAP_ZONE_METADATA_READY = NO, so TEAM_COMPOSITION_V2_READY = NO.
- Next: the smallest map-zone metadata task.
- Details: [POSITION_EVIDENCE.md](POSITION_EVIDENCE.md).

## Earlier decision — TASK-ANALYTICS-TEAM-COMPOSITION-01 (2026-10-08)

**STATUS: COMPLETE / OUTCOME_B / AWAITING SDD REVIEW.**
- Agent / role recommendations are supported: member × agent evidence validates out of sample.
- Map, synergy and role distribution do not validate and are shown as context.
- No win-probability or optimal claim; no position or site claims.
- Next: TASK-DATA-POSITION-NORMALIZATION-01.
- Details: [TEAM_COMPOSITION.md](TEAM_COMPOSITION.md).

## Earlier decision — TASK-DATA-AGENT-CATALOG-01 (2026-10-08)

**STATUS: COMPLETE / AWAITING SDD REVIEW.**
- agent-catalog-v1 is keyed by stable id. Miks = Controller (Riot official). `773f0c78-…` stays UNKNOWN (non-Competitive
  rows only).
- The Controller fallback is removed, and the completeness guard is in place.
- Coverage: Community Score 6/9, Current Strength 7/9, Recent Form 4/9, Progress 9/9.
- Shared-Match v1 is exact (pinned to catalog v0).
- TEAM_COMPOSITION_V1_READY = YES (agent / role / responsibility only).
- TASK-DATA-POSITION-NORMALIZATION-01 is required before position or site claims.
- Details: [AGENT_CATALOG.md](AGENT_CATALOG.md).

## Earlier decision — TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01 (2026-10-08)

**STATUS: LOCAL_V2_CANONICAL_READY = YES; local default switched; AWAITING SDD REVIEW. Public rollout BLOCKED.**
- All nine rollout gates pass.
- High-level analytics are restored only partly: Community Score 5/9, Current Strength 6/9, Recent Form 2/9,
  Progress 8/9 (saturating).
- INTERNAL_STRENGTH_RESEARCH_REOPEN_RECOMMENDED = NO for now.
- Details: [EVENT_METRICS_V2_ROLLOUT.md](EVENT_METRICS_V2_ROLLOUT.md).

## Earlier decision — TASK-SCORING-INTERNAL-STRENGTH-01 (2026-10-08, accepted OUTCOME_B)

**STATUS: PHASE A COMPLETE / OUTCOME_B / AWAITING SDD REVIEW.**
- On canonical evidence, every transparent candidate predicts later same-match outcomes about equally (0.74–0.78).
- The absolute composites are unavailable for all members (event-metrics-v1).
- Rank, Shared-Match and recency ablations are not material.
- `community-internal-strength-v1` is not implemented.
- Interim: shared-match-rating-v1 alone is the most defensible group-internal representation.
- Details: [INTERNAL_STRENGTH.md](INTERNAL_STRENGTH.md).

## Earlier decision — TASK-SCORING-SHARED-MATCH-02 (2026-10-08, accepted OUTCOME_B)

**STATUS: PHASE A COMPLETE / OUTCOME_B / AWAITING SDD REVIEW.**
- Richer event-metrics-v2 signals improve saturation, within-member role neutrality and stability.
- No candidate clearly dominates Firepower: noise is not better, availability is lower, and same-role sensitivity did
  not improve.
- `shared-match-rating-v2` is not implemented; shared-match-rating-v1 stays current.
- Details: [SHARED_MATCH_RATING_V2.md](SHARED_MATCH_RATING_V2.md).

## Earlier decision — TASK-ANALYTICS-EVENT-RECONSTRUCTION-ROBUSTNESS-01 (2026-10-08)

**STATUS: COMPLETE / AWAITING SDD REVIEW. OUTCOME_A.**
- **v2:** `event-metrics-v2` handles revives, self / environmental kills and posthumous kills without invalidating
  whole matches. True ambiguity still fails closed (0 cases in real data).
- **Real data:** KAST / Opening / Trade go from 45 to 547 of 548 matches.
- **Next:** SHARED_MATCH_V2_RECOMMENDED = YES (design only). Canonical v2 adoption is a separate rollout.
- **Details:** [EVENT_RECONSTRUCTION_ROBUSTNESS.md](EVENT_RECONSTRUCTION_ROBUSTNESS.md).

## Earlier decision — TASK-SCORING-SHARED-MATCH-01 (2026-10-08)

**STATUS: COMPLETE / AWAITING SDD REVIEW.**
- **Evidence:** a same-match pair evidence model and `shared-match-rating-v1`, computed locally from private staging.
  All 36 member pairs have direct evidence; all of it is same-team.
- **Signal:** role-aware one-match Firepower. The event-reconstructed dimensions are too sparse because the engine
  fails closed on revive / posthumous rounds.
- **Rank:** context only.
- **Limitations:** documented (residual role bias, saturation, teammates only).
- **Next:** TASK-SCORING-INTERNAL-STRENGTH-01.
- **Details:** [SHARED_MATCH_RATING.md](SHARED_MATCH_RATING.md).

## Earlier decision — TASK-DATA-RANK-01 (2026-10-07)

**STATUS: COMPLETE / AWAITING SDD REVIEW.**
- **What it built:** private rank evidence (`rank-staging-v1`) plus a provider-independent point-in-time resolver
  (`rank-context-v1`) with no future leakage.
- **Evidence:** every staged match carries the account's pre-match tier, with 0 provider requests. Current, peak and
  seasonal are available for 9/9. Stored MMR history is short (≈ 20 rows per account).
- **`elo`:** Henrik's `elo` is a tier + RR encoding, not MMR.
- **Not done:** no scoring, weights or multipliers.
- **Next:** TASK-SCORING-SHARED-MATCH-01.
- **Details:** [RANK_EVIDENCE.md](RANK_EVIDENCE.md).

## Product direction (SDD, 2026-10-07)

- **Direction:** a public platform plus user-created private / invite-only comparison groups. Opt-in is per member;
  analytics are group-scoped.
- **Excluded:** no global player search, global MMR / Elo ranking or opponent scouting.
- **Order:** TASK-DATA-RANK-01 → TASK-SCORING-SHARED-MATCH-01 → TASK-SCORING-INTERNAL-STRENGTH-01 → group UI →
  TASK-RIOT-PRODUCTION-READINESS-01 (DEFERRED).

## Earlier decision — TASK-DATA-HISTORY-COVERAGE-GAP-01 (2026-10-07)

**STATUS: COMPLETE (SDD-corrected). PRIMARY OUTCOME_D; supporting candidate OUTCOME_B.**
- No documented authorized source currently demonstrates recoverable lifetime history.
- **Riot Production + RSO** remains the only official path worth pursuing; its depth is UNKNOWN.
- **滑鏟:** the reference-count gap is confirmed; the match-level gap is not verified.
- **Neon:** whether it holds extra history is UNKNOWN.
- **Henrik:** the stored history is a documented accumulating subset of Riot history, so it cannot backfill the
  滑鏟 gap (102 provider-visible vs ≈ 433 observed).
- **Riot official:** a Production key + RSO matchlist is the only authorized candidate. Its depth is not documented,
  and Riot's policy excludes private personal-use apps.
- **Next:** decisions on the source of the ≈ 433 reference, the product scope for Riot eligibility, and the truthful
  "provider-visible history" model.
- **Details:** [HISTORY_COVERAGE_GAP.md](HISTORY_COVERAGE_GAP.md).

## Earlier decision — TASK-DATA-LOCAL-REBUILD-COLLECT-01 closed (2026-10-07)

**STATUS: PASS_WITH_GOVERNANCE_EXCEPTION** (SDD).
- **Rate waiver:** for this task only. `HISTORICAL_MAX_OBSERVED_RPM = 7`; the corrective controls are in place.
- **Result:** 838 / 838 hydrated.
- **Coverage gap confirmed:** 滑鏟 shows 102 Henrik-visible Competitive matches in 2026, against about 433 observed.
  Classified as an upstream history-coverage limitation; the crawler is not the cause.
- **Backup:** the private staging store is preserved and backed up locally.
- **Next, planned, research only:** TASK-DATA-HISTORY-COVERAGE-GAP-01.
- **Then, after Neon access returns:** TASK-DATA-NEON-RECONCILIATION-01.
- **Canonical evidence:** [REBUILD_STAGING.md](REBUILD_STAGING.md).

### Collection record (2026-10-07)

**STATUS at collection time: COLLECTION COMPLETE / AWAITING SDD REVIEW** [SUPERSEDED: PASS_WITH_GOVERNANCE_EXCEPTION].
- **Collected:** private provider-visible history for the 9 public accounts, into the isolated PostgreSQL 18 staging
  store.
- **Result:** 838 unique matches, all hydrated, every source exhausted, integrity clean. 838 is the same as the
  earlier Production reference.
- **滑鏟:** 102 Competitive matches in 2026, because the provider's history for that account starts 2026-02-15.
- **Unchanged:** consent and public code.
- **Not publication-eligible;** `lifetimeComplete = false`.
- **Evidence and defects fixed:** [REBUILD_STAGING.md](REBUILD_STAGING.md).
- **Next:** TASK-DATA-NEON-RECONCILIATION-01, after the Neon quota resets.

## Earlier decision — TASK-DATA-LOCAL-REBUILD-01 (2026-10-07) [SUPERSEDED by TASK-DATA-LOCAL-REBUILD-COLLECT-01]

**STATUS: PREPARED / BLOCKED_ON_MAINTAINER_INPUT.**
- **Done:** the empty PostgreSQL 18 rebuild target is ready.
- **Not run:** no provider request.
- **Needed:** the provider key placed locally by the maintainer, the 9 Riot IDs with affinity, an SDD decision on
  consent records, and an SDD decision on the HMAC key. See [LOCAL_REBUILD.md](LOCAL_REBUILD.md).
- **TASK-INFRA-PRODUCTION-PG18-TARGET-PREP-01:** complete, awaiting SDD review.
- **TASK-INFRA-PRODUCTION-DATA-MIGRATION-01:** DEFERRED_BY_NEON_TRANSFER_QUOTA.
- **TASK-DATA-NEON-RECONCILIATION-01:** future.

## Earlier decision — TASK-INFRA-PRODUCTION-DATA-MIGRATION-01 (2026-10-07)

**STATUS: BLOCKED_BY_NEON_TRANSFER_QUOTA** [SUPERSEDED: DEFERRED_BY_NEON_TRANSFER_QUOTA]. Neon Free monthly transfer allowance is exhausted (≈ 5.13 GB of ≈ 5 GB).
- **Resets:** 2026-11-01. Resume then, or after the maintainer explicitly confirms an upgrade.
- **Not run:** no Production probe, read or dump.
- **Local target:** ready and empty.
- **Neon tooling:** the Neon CLI and the project-level Neon skill are installed; Neon MCP is deferred.
- **Readiness:** LOCAL_PRODUCTION_DATABASE_READY = NO.
- **Resume:** follow the checklist in [PRODUCTION_DATA_MIGRATION.md](PRODUCTION_DATA_MIGRATION.md).

## Earlier decision — TASK-INFRA-STATIC-PUBLICATION-CHANNEL-01 (2026-10-07) — ACCEPTED by SDD

**Publication channel validated end to end on the real Internet with SYNTHETIC data only.**
- Public data repository `scottpuppylu/valorant-squad-analytics-data`, served by GitHub Pages.
- The git-based `GitHubDataRepositoryPublisher` writes the version first, verifies it, and writes the manifest last.
- Verified: remote frontend PASS, A → B switch, incomplete C safe, rollback.
- See [STATIC_DATA_PUBLISH.md §11](STATIC_DATA_PUBLISH.md).

**SDD decisions recorded:**
- STATIC-QUERY-PARITY-01 ACCEPTED, and `weaponId` approved as a static content id.
- TASK-SYNERGY-SCALING-01 is DEFERRED / NON-BLOCKING.

**Still NOT_STARTED:** real data publication, production data migration and cutover.

## Earlier decision — TASK-INFRA-STATIC-QUERY-PARITY-01 (2026-10-07)

**Static query parity implemented locally (synthetic data only, nothing published).**
See [STATIC_DATA_PUBLISH.md §10](STATIC_DATA_PUBLISH.md).

- **SDD verdict on STATIC-DATA-PUBLISH-01:** the foundation is ACCEPTED, but static data architecture readiness
  was NOT ACCEPTED, because multi-filter and custom-date queries were "not precomputed".
- **Fix:** a hybrid model. Public facts (`public-facts-v1`) run the extracted SHARED server core in a browser Web
  Worker; a small `common` first-paint tier is precomputed. Every normal visible control is preserved.
- **Evidence:**
  - 1 401 byte-identical parity cases, 0 fail;
  - every 10k export finished under the default statement timeout, and the weapon SQL blocker was removed by the
    architecture.
- **Follow-ups (separate tasks, not started):**
  - **TASK-SYNERGY-SCALING-01:** all-history Synergy at 10k takes ≈ 7 s in the shared scoring aggregation, on the
    server as well.
  - **TASK-WEAPON-ANALYTICS-SCALING-01:** only needed if the live API path stays in use.
  - Optional: serve history from facts, to remove duplication.

## Earlier decision — TASK-INFRA-STATIC-DATA-PUBLISH-01 (2026-10-07)

**STATIC_DATA_ARCHITECTURE_READY (local, synthetic data only).** Nothing published: PUBLIC_DATA_PUBLISHED = NO.
See [STATIC_DATA_PUBLISH.md](STATIC_DATA_PUBLISH.md).

- **Model:** PostgreSQL stays the source of truth. Public reads come from a derived, immutable, versioned snapshot
  (`static-snapshot-v1`). The manifest is published LAST, and the browser fetches only files of the snapshot it
  pinned.
- **Exporter:** `npm run data:export`.
  - Uses the same server services as `/api/valorant/dataset` over one READ ONLY snapshot of a local database.
  - Privacy gate `public-export-gate-v1`: allowlist, forbidden names, content scan, database cross-check.
  - Deterministic, content-addressed snapshot ids.
- **Publisher:** `npm run data:publish:local` (`LocalFilesystemPublisher`). GitHub is only a future publisher.
- **Frontend:** `StaticSnapshotClient` behind the existing `DatasetApiClient`, enabled with
  `VITE_DATA_MODE=static`. Pages are unchanged; requests outside the catalog show an explicit notice.
- **Recommended channel:** B, a separate public data repository served by GitHub Pages (same origin, scoped token,
  isolated and squashable history).
- **Finding:** at 10 000 matches the existing weapon-analytics aggregate statement exceeds the default 55 s
  statement timeout. The export fails closed. A future `TASK-WEAPON-01` scaling task, or a raised exporter
  timeout, is an SDD decision.

**Earlier decision TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01:** ACCEPTED by SDD (2026-10-07).

## Earlier decision — TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01 (2026-10-07)

**LOCAL_RUNTIME_READY = YES** (this desktop, local only). Synthetic data and credentials only; 0 Production calls,
0 provider requests, no push, no inbound exposure.

| Area | Evidence |
|---|---|
| WSL storage | Recovery export `D:\WSL-Recovery\Ubuntu-pre-move-20261007.tar` (6.87 GB, SHA-256 recorded, GNU tar validated) **kept until SDD acceptance**. Native `wsl --manage Ubuntu --move D:\WSL\Ubuntu`; WSL itself retired the old C: vhdx. Boot, default user, systemd and home verified after the move |
| Docker | Docker Engine 29.8.2 + Compose v5.6.0 from the official apt repo inside WSL (no Docker Desktop). Socket `660 root:docker`, no TCP listener, root `/var/lib/docker` on ext4 (D:-hosted vhdx) |
| PostgreSQL storage | Named volume `postgres-data` under `/var/lib/docker/volumes/` on ext4 `/dev/sdd`; never `/mnt/c`, `/mnt/d` or NTFS |
| Source | git bundle of Windows HEAD `5620921` cloned into `~/projects` (Linux-native), identical commit |
| Real PostgreSQL 16.15 | Contract suite 5/5 PASS; full suite 730 passed / 0 skipped with `TEST_DATABASE_URL` |
| Migration rehearsal | `infra/rehearsal/rehearse-migration.sh` PASS: 600 synthetic matches, pg_dump → pg_restore, parity identical, migrate idempotent |
| Backup / restore | PASS for both the live stack DB and a 300-match synthetic dump: backup, checksum, restore and parity. The non-empty target is refused. Corrupt / missing-checksum / unsafe-target / missing-dump are refused (exit 1/1/2/2). The valid backup is intact |
| Local stack | `up` gives: postgres healthy, migrate exit 0, app healthy, scheduler running (no job before 18:05 UTC, 0 sync runs), Caddy valid. `/`, the SPA fallback, `/healthz` and `/api` return 200 over local TLS. No secret in logs; `down -v` clean |

**Defects found by the real runtime and fixed (local commits):**
1. The parity gate compared OID-derived NOT NULL names and deparsed CHECK text, so every faithful restore failed
   (now `database-parity-v2`).
2. The scheduler inherited the API's HTTP healthcheck and was always unhealthy.

**Operational finding:** WSL shuts its VM down when idle, and the stack restarts on the next WSL start. 24/7
self-hosting needs WSL kept running (power and idle policy). BACKUP_FAILURE_DOMAIN stays SHARED (C: and D: are
one SSD).

**Still NOT_STARTED:** PRODUCTION_DATA_MIGRATION, PRODUCTION_CUTOVER, STATIC_JSON_PUBLISH. Next candidate:
TASK-INFRA-STATIC-DATA-PUBLISH-01 (not implemented). [SUPERSEDED: implemented locally, see the current decision above.]

## Earlier decision — TASK-INFRA-SELFHOST-READINESS-01 (2026-10-07)

**SDD correction:** SELF_HOSTED_FIRST. Production runs on user-owned hardware. The cloud VPS path
(TASK-INFRA-VPS-BOOTSTRAP-01) is cancelled as the primary target.

**Outcome: B — HOST_READY_NETWORK_BLOCKED.** Read-only discovery only; nothing installed or exposed, router and
DNS untouched.

| Area | Evidence | Verdict |
|---|---|---|
| Host | i5-14400F 10C/16T, 31.8 GB RAM, 1 TB NVMe (C: 79 GB free, D: 158 GB free), desktop with no battery, Hyper-V active | OK |
| WSL2 | 2.6.3, kernel 6.6.87.2, Ubuntu 24.04, `systemd=true`, NAT networking, vhdx on C: [SUPERSEDED: moved to D:] | Docker Engine feasible [SUPERSEDED: installed] |
| Power | AC sleep never, hibernate off, Fast Startup off | 24/7 needs a usage change: 70 clean shutdowns and 74 boots in 30 days, 14 unexpected shutdowns in 90 days |
| Network | Wired Realtek 2.5GbE at 1 Gbps, DHCP LAN, no IPv6 on the LAN | — |
| Public IP | IPv4 globally routable (masked 122.100.x.x); IPv6 none | — |
| CGNAT | **POSSIBLE**: router upstream hop RFC1918 (10.x); no UPnP / NAT-PMP to read the router WAN | Unconfirmed |
| Ports | 80, 443, 5432, 3000 free; RDP 3389 and SMB 445 listen on all interfaces (LAN) | — |
| Firewall | Windows Firewall on for all profiles (default inbound block); Ethernet profile Public; Hyper-V firewall for WSL default inbound Block | OK |
| Storage | One physical SSD (C:/D:) plus a removable SD card; no NAS | **BACKUP_FAILURE_DOMAIN=SHARED** |

**SDD decision needed:** whether direct inbound IPv4 is possible.
- Compare the router status page's WAN IPv4 with the public IPv4. If they differ, it is CGNAT.
- If CGNAT is confirmed, ask the ISP for a public IPv4 (or IPv6), or decide on a fallback. Not decided here.

## Earlier decision — TASK-INFRA-REAL-POSTGRES-REHEARSAL-01 (2026-10-07)

**BLOCKED_BY_RUNTIME_ENVIRONMENT** [SUPERSEDED: rehearsal PASS, TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01]. No Docker, PostgreSQL client tools or Caddy on this machine; nothing was
installed.
- **Ran without Docker:** shell syntax, structural compose parse, the restore script's negative paths (all refuse),
  the background-limit re-check and all local gates.
- **Fixed:** two static compose defects — the app-image `build` linkage, and app secrets leaking into the postgres
  container env.
- **Next required environment:** this machine with Docker Desktop, or the VPS.
- **Production unchanged:** PRODUCTION_VPS_READY / DATA_MIGRATION / CUTOVER / VERCEL_RETIREMENT / NEON_RETIREMENT = NO.

See [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md).

## Earlier decision — TASK-INFRA-DATABASE-PORTABILITY-01 (2026-10-07)

**LOCAL IMPLEMENTATION COMPLETE; nothing in Production changed.** The main line is fixed:
infra → migration → historical completeness → coverage → Rank → Shared-Match.

| Milestone | Status |
|---|---|
| CODE_PROVIDER_DECOUPLING | COMPLETE: standard `pg`, `createDatabase` / `getSharedDatabase`, Neon SDK removed, architecture guards |
| NODE_STANDALONE_RUNTIME | COMPLETE: the same 12 handlers on `node:http`, scheduler replaces Vercel Cron |
| VPS_DEPLOYMENT_ASSETS | COMPLETE: Dockerfile, compose, Caddy, env.example, backup / restore / rehearsal |
| LOCAL_POSTGRES_VALIDATION | PGlite + mocked-pg PASS; real PostgreSQL **NOT RUN** (no Docker/PostgreSQL on the authoring machine) |
| MIGRATION_REHEARSAL | Parity gate PASS (PGlite); real `pg_dump` / `pg_restore` rehearsal **NOT RUN** |
| PRODUCTION_VPS_READY / PRODUCTION_DATA_MIGRATION / PRODUCTION_CUTOVER | NOT STARTED |
| VERCEL_RETIREMENT / NEON_RETIREMENT | NOT STARTED (Neon = rollback source until retired) |

stored_index Production acceptance is deferred to the VPS (runbook step 20). Phase 4 is NOT READY.
See [PRODUCTION_MIGRATION_RUNBOOK.md](PRODUCTION_MIGRATION_RUNBOOK.md).

## Earlier decision — TASK-DATA-STORED-INDEX-01 (2026-10-07)

**IMPLEMENTATION IN PROGRESS / PRODUCTION ACCEPTANCE BLOCKED BY NEON TRANSFER QUOTA.**
- Option C: stored-index page size 20, separate from live_v4's 3; exact HMAC check; ≤ 1 detail per chunk;
  deep-history-v2 restarts v1 stored cursors at page 1.
- Locally: −85 % stored index requests at Phase-3 density, with exact discovery parity.
- The local commit is not pushed. 0 Production canaries run, and the canary authorization is unused.
- Phase 4 is NOT READY. See [STORED_INDEX_EFFICIENCY.md](STORED_INDEX_EFFICIENCY.md).

## Earlier decision — TASK-DATA-BULK-01E (2026-10-06)

**COMPLETE / ACCEPTED — 6 RPM sustained for the full 120-minute window.**
- 599 charged = 599 measured provider requests, 598 HTTP requests, 0 errors of any kind, max chunk 14.8 s, max
  2 accounts in flight, 0 same-account concurrency.
- Tracked 672 → 838 (+166 unique), earliest 2024-01-13. 6 accounts are source-exhausted (not lifetime-complete);
  3 remain in stored_index.
- Analysis facts are fresh after the crawl (`queries=6`, `fallback=0`).
- Next decision: **C — optimize stored_index before more Bulk.** stored_index spent 503 requests for 14 persisted
  observations; live_v4 yields 3.0 per request.
- See [BULK_HISTORY.md](BULK_HISTORY.md).

## Earlier decision — TASK-DATA-03B.2D (2026-10-06)

**COMPLETE / ACCEPTED (`full-tracked-aggregate-v1` over `analysis-match-facts-v1`, migration 0011).** Production: 672 matches hydrated (1,405 facts); lifetime 5.28 → 2.78 s, map −50 %, agent −52 %, Act −58 %, synergy −49 %; 6 statements, 0 fallback, identical bytes. See [FULL_TRACKED_LATENCY.md](FULL_TRACKED_LATENCY.md).
- Phase A: the chunked phase 2 re-scanned whole topology tables per 250-match chunk (O(n²)), and event
  reconstruction is O(n) CPU per request.
- Option A (set-based on demand) failed: 14.4 s at 5 k. Option B (materialized per-participant facts) was chosen.
- Full-population analysis now uses 6 statements regardless of history size. Local realistic 10 k:
  lifetime 39.9 s → 4.53 s, synergy 30.3 s → 6.27 s.
- Byte-identical output to the previous engine. No formula, scope, mode or public-contract change.
- TASK-DATA-BULK-01B: BOTH KNOWN BLOCKERS RESOLVED; Bulk NOT RUN until a separate explicit human authorization.
- Next (separately authorized): a bounded Bulk continuation at 2 lanes / 6 RPM with the existing hard stops.

## Earlier decision — TASK-DATA-HISTORICAL-IDENTITY-01 (2026-10-06)

**COMPLETE / ACCEPTED (`historical-identity-v1`).** The one acceptance POST returned HTTP 200: pages +1, provider +1, cursor advanced, tracked 671 → 672, no `sync_database_failure`. See [HISTORICAL_IDENTITY.md](HISTORICAL_IDENTITY.md).
- The consenting participant is identified by `providerIdentityHmac('HenrikDev', affinity, players[].puuid)` equal to the
  account's durable `provider_identities.lookup_hmac`, exactly one per match. The Riot name/tag is never used.
- Static gate: `PROVIDER_IDENTITY_DOMAIN_COMPATIBLE = YES`.
- Identity failures are `MALFORMED_RESPONSE`, never DATABASE_ERROR, and emit no `sync_database_failure`.
- No migration; schema 6 and `durable-evidence-v2` unchanged.
- TASK-DATA-BULK-01B: IDENTITY BLOCKER RESOLVED, but BULK REMAINS PAUSED pending DATA-03B.2D (full-tracked analysis latency).

## Earlier decision — TASK-DATA-BULK-01D (2026-10-06)

**COMPLETE / ROOT CAUSE VERIFIED (C1a).**
- Exactly one controlled `sync/continue` returned 503 DATABASE_ERROR with telemetry `persist_sync_page` /
  `consenting_participant_absent` (deep_backfill, live_v4).
- Effects: provider +1, pages +0, retries +1, cursor unchanged, tracked +0.
- Root-cause class: deterministic historical identity matching. The consenting participant is matched by current Riot
  name+tag. The database is not at fault.
- TASK-DATA-BULK-01B is **BLOCKED ON IDENTITY FIX**.
- Next: TASK-DATA-HISTORICAL-IDENTITY-01 (SDD STRICT), which identifies the consenting participant by durable provider
  identity instead of the current Riot ID. [SUPERSEDED: implemented, see above.]
- See [BULK_DATABASE_ERROR_DIAGNOSIS.md](BULK_DATABASE_ERROR_DIAGNOSIS.md).

## Earlier decision — TASK-DATA-BULK-01C (2026-10-06)

**DIAGNOSIS BLOCKED BY OBSERVABILITY / ROOT CAUSE NOT VERIFIED.**
- The failure (滑板車, live_v4) happened after a successful provider request and after 2 of the page's matches committed;
  `recordFailure` committed, the lease was released and the cursor did not advance.
- Three candidates match the durable signature exactly:
  - C1a: the 3rd match lacks the consenting participant (Riot ID changed); deterministic and mislabelled DATABASE_ERROR;
  - C1b: the 3rd per-match transaction failed in the DB;
  - C2: a short final page whose cursor commit failed.
- `database-failure-stage-v1` (sanitized log) is implemented and ready for reproduction. Controlled reproduction is NOT
  AUTHORIZED / NOT RUN.
- Phase-2 "pagination repetition 0" is corrected to 1.
- A minor un-awaited status-read defect was recorded. Bulk stays STOPPED / BLOCKED; TASK-DATA-03B.2D is NOT STARTED.
- See [BULK_DATABASE_ERROR_DIAGNOSIS.md](BULK_DATABASE_ERROR_DIAGNOSIS.md).

## Earlier decision — TASK-DATA-MODE-POLICY-01 (2026-10-06)

**COMPLETE / ACCEPTED.**
- `mode-eligibility-policy-v1`: absolute strength analytics are **Competitive only**.
- Unrated is eligible only for the future same-match relative engine (TASK-SCORING-SHARED-MATCH-01, NOT STARTED).
- Entertainment, Premier, Custom and unknown modes are browse-only.
- feature-scope-policy-v3 (queue eligibility only) and weapon-analytics-v2 (population only) are active; every score
  formula is unchanged and duo-synergy-v1 is Competitive only.
- Production: 309 Competitive of 671 tracked; every absolute population is 309 or a subset of it.
- Bulk is still STOPPED / BLOCKED, the DATABASE_ERROR is NOT RESOLVED, and the analysis latency risk is OPEN.
- See [MODE_ELIGIBILITY.md](MODE_ELIGIBILITY.md).

## Earlier decision — TASK-DATA-BULK-01B Phase 2 (2026-10-06)

**STOPPED / BLOCKED** on the first `DATABASE_ERROR` (one `sync/continue` 503 for 滑板車; root cause NOT VERIFIED).
- Ran 53.6 min at 2 lanes / 6 RPM with **zero 429**: 311 charged / 310 measured provider requests.
- Mix: 292 live_v4 + 18 stored_index chunks (0 detail requests).
- Tracked 332 → **671**; oldest 2026-08-14 → **2025-01-25**.
- 8 runs paused, 1 failed; no worker left running.
- New risk: production full-tracked analysis ≈ 10 s at 671 matches (linear) → ~60 s near ~4,000–4,500 matches.
- Next bulk decision: **D**. Investigate the DB error and the analysis latency before any further crawl. See
  [BULK_HISTORY.md](BULK_HISTORY.md).

## Earlier decision — TASK-DATA-PERFORMANCE-SCORE-01 (2026-10-06)

**AUDIT COMPLETE / PHASE B BLOCKED — the provider Performance Score field is NOT VERIFIED (Phase-A outcome D).**
- Riot: Performance Score (0–500) replaces ACS for scoreboard/MVP; the formula is not published.
- Henrik: public OpenAPI 4.6.0 has no field; v4.10.0 BETA announces "performance scores" without a schema.
- A live audit was not possible without weakening the boundary (HENRIK_API_KEY is Production-only; the audit is
  production-disabled). 0 provider calls.
- `stats.score` is still the legacy combat-score total → **ACS_SAFE**, so no hotfix was needed.
- Added `provider-shape-inspector-v1` and a ≤ 2-request `performance-score` audit mode (non-production).
- Nothing ingested; no migration or scoring change.
- Next: TASK-DATA-PERFORMANCE-SCORE-01B (one Preview audit after a maintainer decision to grant Preview provider
  access, or after Henrik publishes the v4.10.0 schema).
- TASK-SCORING-SHARED-MATCH-01, TASK-DATA-RANK-01 and TASK-DATA-BULK-01B are NOT STARTED. See
  [PERFORMANCE_SCORE.md](PERFORMANCE_SCORE.md).

## Earlier decision — TASK-DATA-03B.2C (2026-10-06)

**COMPLETE / ACCEPTED.**
- The website 300-match functional ceiling is REMOVED; the transport snapshot is a bounded internal
  optimization only.
- History browsing covers all eligible tracked history via pagination.
- REAL analytics are server-side over the full tracked population per feature policy
  (`server-analysis-v2`, `selection-summary-v1`). The generic 2000 ALL/ACT/PAIR cap is REMOVED.
- Intentional adaptive windows are PRESERVED; `lifetimeComplete=false`.
- No formula, schema or migration change.
- Production (read-only): tracked 332, history 332 browsable, every analysis `populationComplete`.
- TASK-DATA-BULK-01B (Phase 2) NOT STARTED and may resume at the lower approved RPM;
  TASK-DATA-RANK-01 NOT STARTED. See [FULL_TRACKED_ANALYTICS.md](FULL_TRACKED_ANALYTICS.md).

## Earlier decision — TASK-DATA-BULK-01A Phase 1 (2026-10-06)

**STOPPED / NEEDS REVIEW** — it stopped, as required, at the first **provider-side 429**, 631.5 s into the bounded run.
- Provider requests: 84 charged of 500 (77 actual).
- All 9 accounts served; every chunk was live_v4 (0 stored_index).
- Tracked matches 213 → 332 (+119); oldest coverage 2026-08-21 → 2026-08-14.
- Zero DB, timeout, 5xx, consent or lock errors. All runs are paused and resumable.
- Recommendation: **A** (unchanged controller, lower `--provider-rpm 6`). Phase 2 is NOT STARTED and needs authorization.
  See [BULK_HISTORY.md](BULK_HISTORY.md).

## Earlier decision — TASK-DATA-BULK-01 (2026-10-06)

**IMPLEMENTED / CANARY PASSED.** `bulk-history-v1` (`npm run history:bulk`) is a local maintainer controller.
- It drives the existing account-scoped deep_backfill through the public sync routes only, with no secrets and no new endpoint.
- Production canary: 12 provider requests charged, 10 actual, 0 errors. Tracked matches went from 191 to 213.
- Two lanes are now the default (+62% steady-state throughput).
- **Full crawl: NOT STARTED** — it needs explicit human authorization. See [BULK_HISTORY.md](BULK_HISTORY.md).

## Earlier decision — TASK-SECURITY-02 (2026-10-06)

**COMPLETE / SECURITY DISPOSITION ACCEPTED.** The full audit drifted from 5 → 8.
- source-map-js GHSA-68fv: FIXED by a compatible lockfile patch (`d021e5e`).
- postcss-selector-parser GHSA-rj75 (2 moderate): temporarily accepted under SEC-2026-002.
- braces GHSA-vfj7 (5 high): SEC-2026-001, original subset only.
- Full audit 7, production audit 0. Evidence: [TASK_SECURITY_02.md](TASK_SECURITY_02.md).
- TASK-SECURITY-03 (Tailwind 4 / build toolchain security migration): NOT STARTED, recommended. It is the only path that
  clears the remaining advisories (isolated lockfile audit = 0) and needs explicit authorization.

## Earlier decision — TASK-WEAPON-01.1 (2026-10-06)

**COMPLETE / ACCEPTED.** Warden catalog correctness hotfix: `weapon-catalog-v2` (Warden → Rifle, firearm; Riot
Patch Notes 13.06). `weapon-analytics-v1` is unchanged; no numeric change, no migration, no provider calls.

- TASK-DATA-FASTSYNC-01.2 (FASTSYNC UI Navigation Regression Test Repair): NOT STARTED. Some older FASTSYNC UI tests
  do not actually navigate under HashRouter/happy-dom.
- Security follow-up: the full `npm audit` now reports 8 (2 moderate, 6 high), with new dev/build-only advisories in
  source-map-js and postcss-selector-parser. The production audit is still 0. This needs a disposition beyond
  SEC-2026-001; not force-fixed.

## Earlier decision — TASK-WEAPON-01 (2026-10-06)

**COMPLETE / ACCEPTED.** Member-level context-aware weapon analytics: `weapon-analytics-v1`,
`weapon-catalog-v1` ([WEAPON_ANALYTICS.md](WEAPON_ANALYTICS.md)). Two evidence domains (round weapon
observation vs kill weapon); ALL TRACKED/ACT by aggregate SQL over all eligible history; CURRENT via the
currentStrength selection; no migration; no score/Progress/Synergy change. Unsupported: per-weapon HS%,
ADR, damage, accuracy, attack/defense. TASK-DATA-RANK-01 NOT STARTED; DATA-03B.2C DEFERRED;
FASTSYNC-01.1 DEFERRED; RELEASE-01 PAUSED; V1 NOT YET RELEASED.

## Earlier decision — TASK-IDENTITY-01B (2026-10-06)

**COMPLETE / ACCEPTED.** The 9 approved community names were applied by the one-time fail-closed data
migration 0010 (see [MEMBER_IDENTITY.md](MEMBER_IDENTITY.md)). Production: 9 members × 1 account,
9 community names, nicknames unset, 0 merges. TASK-WEAPON-01 is NOT STARTED and recommended next.
TASK-ADMIN-01 is NOT STARTED.

[SUPERSEDED / HISTORICAL — the earlier record was "IN PROGRESS — code deployed; production name write
PENDING maintainer execution", kept below.]
- Done: primary community name + optional nickname (`member-identity-v2`, schema 6, migration
  0009) and operator-only editing (`set-nickname`, `clear-nickname`, `plan-names`, `apply-names`).
- Pending: the 9 approved names (`ops/community-names-2026-10-06.json`) pre-check as unambiguous
  but are not yet written. Production `DATABASE_URL` is a Vercel Sensitive variable and is not
  available to the agent.
- Nicknames are unset. No public edit endpoint exists (future TASK-ADMIN-01).
- TASK-WEAPON-01 NOT STARTED.

## Earlier decision — TASK-IDENTITY-01 (2026-10-06)

**COMPLETE / ACCEPTED.** Member / multi-account identity foundation (`member-identity-v1`, schema 5,
migration 0008; [MEMBER_IDENTITY.md](MEMBER_IDENTITY.md)). Human fact: the 9 current accounts are 9
different people, so production is 9 members × 1 account with 0 merges. Community names are PENDING.

- TASK-IDENTITY-01B (community name assignment): NOT STARTED — waiting for the maintainer's
  account → group-name mapping. No provider call is needed; use `npm run member:admin -- rename-member`.
- TASK-WEAPON-01: NOT STARTED — the recommended next product analytics task (member-level weapon
  evidence).
- TASK-DATA-FASTSYNC-01.1 (known-boundary fast path): DEFERRED.
- TASK-DATA-RANK-01 NOT STARTED; DATA-03B.2C DEFERRED; RELEASE-01 PAUSED; V1 NOT YET RELEASED.

## Earlier decision — TASK-DATA-FASTSYNC-01 (2026-10-06)

**COMPLETE / ACCEPTED.** Opportunistic recent match refresh `recent-refresh-v1`
([FAST_RECENT_SYNC.md](FAST_RECENT_SYNC.md)): server-authoritative 30-minute freshness gate,
race-safe lease re-check, one bounded chunk per action, Profile auto refresh plus manual 更新戰績.
Cron schedules are unchanged. TASK-DATA-FASTSYNC-02 (sub-daily scheduled recent sync): NOT STARTED /
OPTIONAL FUTURE. TASK-DATA-RANK-01 NOT STARTED; DATA-03B.2C DEFERRED; RELEASE-01 PAUSED; V1 NOT
YET RELEASED.

## Earlier decision — TASK-PROGRESS-01 (2026-10-05)

**COMPLETE / ACCEPTED (2026-10-06).** Adaptive Improvement Index authorized and implemented: `improvement-index-v1`,
`improvement-benchmarks-v1`, `feature-scope-policy-v2`. See [PROGRESS_INDEX.md](PROGRESS_INDEX.md).
Production acceptance is recorded there. TASK-DATA-RANK-01 NOT STARTED. DATA-03B.2C DEFERRED —
required before a true LIFETIME/ACT/PAIR population can exceed the 2000-match analytical bound
without becoming partial.

## Earlier decision — TASK-DATA-03B.2B (2026-10-05)

**COMPLETE / ACCEPTED.** Server-side context-aware analytics consumption; see
[SERVER_ANALYTICS.md](SERVER_ANALYTICS.md). Analytics no longer depend on snapshot completeness.
Staged: server view → fixture parity → production read-only parity (10/10) → consumer switch.
Follow-up DATA-03B.2C (server aggregates/materialized facts beyond the 2000-match phase-2 bound):
DEFERRED, needs measured need. TASK-PROGRESS-01: [SUPERSEDED: authorized 2026-10-05, see the TASK-PROGRESS-01 decision above].

## Earlier decision — TASK-DATA-SEASON-01 (2026-10-05)

**COMPLETE / ACCEPTED.** Persist and reconcile match Act/season evidence; see
[SEASON_EVIDENCE.md](SEASON_EVIDENCE.md). No migration; production Act coverage 173/183 (94.5 %,
E11:A5); remaining 10 fill via normal cron. Act scopes are active. Production backfill
uses supported deep sync endpoints only. TASK-DATA-RANK-01 NOT STARTED. [SUPERSEDED at that time:
TASK-PROGRESS-01 DESIGN ONLY; DATA-03B.2B NOT STARTED — both since authorized.] DATA-05A, DATA-03B.1 and DATA-03B.2A accepted.

## Earlier decision — TASK-DATA-03B.2 redefined (2026-10-05)

Superseding human decision: DATA-03B.2 is the **Context-Aware Analytics Scope Engine**,
not "all-history analytics". Different features use different windows; 300 is transport only.
See [ANALYTICS_SCOPES.md](ANALYTICS_SCOPES.md).

- **DATA-03B.1**: COMPLETE / ACCEPTED.
- **DATA-03B.2A — scope engine + wiring: COMPLETE.** Registry, adaptive resolver,
  Act/rank-optional evidence, `view=analytics` facts, score pages on 目前實力.
- **DATA-03B.2B — server aggregate consumption: COMPLETE / ACCEPTED** (2026-10-05, see above).
- **TASK-DATA-SEASON-01** (persist season metadata): started 2026-10-05, see above.
  **TASK-DATA-RANK-01** (rank ingestion): NOT STARTED, separately gated.
- **TASK-PROGRESS-01 — Adaptive Improvement Index**: COMPLETE / ACCEPTED 2026-10-06
  ([PROGRESS_INDEX.md](PROGRESS_INDEX.md)). [SUPERSEDED: was RECOMMENDED, design only.]
- DATA-05A PRODUCTION ACTIVATED / ACCEPTED; DATA-04B DEFERRED; RELEASE-01 PAUSED; V1 NOT RELEASED.

## Earlier decision — TASK-DATA-03B (2026-10-05)

Split under SDD STRICT; see [TASK_DATA_03B_PLAN.md](TASK_DATA_03B_PLAN.md).

- **DATA-03B.1 — full-history paginated runtime + browse consumption: IMPLEMENTED.**
  `GET /api/valorant/dataset?view=history` keyset pages over all eligible durable
  matches; Matches page loads older tracked matches on demand. Browse-only.
- ~~DATA-03B.2 — all-history analytical aggregation~~ — superseded by the Context-Aware
  Analytics Scope Engine above.
- DATA-05A: PRODUCTION ACTIVATED / ACCEPTED, cron unchanged.
- DATA-04B: DEFERRED. RELEASE-01: PAUSED; V1 NOT YET RELEASED.

## Current decision — TASK-DATA-05A (2026-10-05)

Status: **ACTIVE — Tracker-style persistent scheduled sync**. Explicit human
decision supersedes the prior Riot-response freeze. Primary strategy: permanently
accumulate observable Henrik history, daily incremental and historical reconciliation,
existing consent/deletion boundaries; lifetimeComplete=false. Implementation and
environment acceptance tracked in [PERSISTENT_SYNC.md](PERSISTENT_SYNC.md).
Vercel CLI authentication and production-only CRON_SECRET setup are complete.
DATA-05A is **PRODUCTION ACTIVATED / ACCEPTED**: both daily jobs registered and
exactly one recent plus one historical secured canary passed (HTTP 200).
Sources 50→56; provider counters 83→85; existing 50 sources preserved.
Nine public players are maintainer-confirmed expected activity, not a drift
investigation. Recurring eligible consenting-player acquisition is authorized.
Pagination-repeat recovery was not encountered by these canaries; live branch
verification remains NOT VERIFIED. DATA-03B was NOT STARTED at this checkpoint (superseded above).

- DATA-04A: WAITING ON RIOT — informational / non-blocking, ticket #139243830 OPEN.
- DATA-04B: DEFERRED / NOT REQUIRED FOR CURRENT PRODUCT PATH.
- DATA-03A: resumed as acquisition infrastructure; preserve existing P1/P2 runs/data.
- DATA-03B: NOT STARTED [SUPERSEDED: DATA-03B.1/2A/2B completed later]; public schema 4/newest-300 unchanged.
- RELEASE-01: PAUSED FOR DATA-05A / DATA-03B; V1 NOT YET RELEASED.
- No Riot/RSO, another application, destructive data operation or scoring/Synergy change.

The following DATA-04A decision is superseded historical evidence, not current freeze.

## Current decision — TASK-DATA-04A (2026-10-04)

The hard requirement is **FULL LIFETIME MATCH HISTORY**, earliest actual VALORANT match through latest, with no known missing matches. Do not substitute a provider window, source exhaustion or newest-300 projection.

### TASK-DATA-04A — Authoritative Lifetime History Feasibility

Status: **WAITING ON RIOT — ticket #139243830**. [Support ticket](https://support-developer.riotgames.com/hc/en-us/requests/139243830) is **OPEN — WAITING FOR RIOT RESPONSE** (maintainer-confirmed 2026-10-04; no live status query in this update). Docs-only research is complete, but official lifetime guarantees, pagination/retention/missing-match semantics, private community eligibility and Production/RSO sequence remain pending. See [LIFETIME_HISTORY.md](LIFETIME_HISTORY.md) for the submitted questions and preserved research/design.

Primary outcome **D: FULL_LIFETIME_HISTORY_NOT_PROVABLE_WITH_CURRENT_AVAILABLE_SOURCES**. Riot lifetime guarantee **NOT DOCUMENTED**; actual Production/OAuth approval **NOT VERIFIED**. `lifetimeComplete=true` cannot currently be proven. The current private friend-group scope requires Riot eligibility clarification; no application was submitted.

### TASK-DATA-04B — Riot Official Provider / RSO Integration

Status: **BLOCKED ON DATA-04A / NOT STARTED**. Requires Riot clarification first, then explicit authorization, eligible product scope, approved Production and separate OAuth access, reviewed token/identity/consent lifecycle and a documented decision on the unmet lifetime requirement. No invented VAL matchlist pagination. Henrik is secondary reconciliation only; existing players, public UUIDs and durable history must be preserved.

### Acquisition / release freeze

Do not implement DATA-04B/Riot provider/RSO or submit another Production/RSO application until Riot clarifies the required sequence. The submitted support inquiry is not an application or access approval. TASK-RELEASE-01 is **PAUSED**; V1 is **NOT YET RELEASED**.

This decision supersedes earlier continuation permissions. Preserve DATA-03A implementation and DATA-03A.1 hard-stop evidence: P1 paused, P2 failed `provider_repeated_page`, 30 durable unique sources, `lifetimeComplete=false`. DATA-03A production acceptance remains **BLOCKED**; DATA-03A.2 and P1/P2 continuation are frozen. DATA-03B remains **NOT STARTED** [SUPERSEDED: completed later]. RELEASE-01 remains **PAUSED**, V1 not released. No Riot/Henrik game API calls, production writes, migration or release levels/tags are authorized by DATA-04A. Historical roadmap entries below are retained, not renewed authorization.

## Task 000 — repository and Codex setup

- [x] Initialize a Git repository with `main` as the default branch.
- [x] Add README, Node ignore rules, line-ending rules, project brief, and roadmap.
- [x] Add repository-level Codex instructions.
- [x] Add conservative project-scoped Codex defaults.
- [x] Create and connect the public GitHub repository.
- [x] Push the initial commit.

## Task 001 — application scaffold

Create the V1 application skeleton with React, TypeScript, Vite, Tailwind CSS, Recharts, Vitest, and npm.

Required outcomes:

- [x] Establish the folder structure described in `docs/PROJECT_BRIEF.md`.
- [x] Create realistic demo data for eight fictional players and at least thirty matches.
- [x] Implement responsive navigation, a first dashboard, and a first leaderboard.
- [x] Add placeholder routes for all planned V1 pages.
- [x] Add `docs/SCORING.md` and `docs/DATA_MODEL.md`.
- [x] Configure linting, unit tests, CI, and GitHub Pages deployment.
- [x] Ensure the Vite base path works under `/valorant-squad-analytics/`.
- [x] Verify `npm run lint`, `npm test`, and `npm run build`.

Do not implement the full scoring engine during this task. Use clearly labeled initial calculations or fixtures and leave advanced scoring for Task 002.

## Task 002A — usability and official API readiness

Status: **COMPLETE**

- [x] Convert user-facing application text to Taiwan Traditional Chinese.
- [x] Prototype browser-local image avatar behavior (subsequently retired and replaced by emoji identity in TASK-002A.1).
- [x] Add a typed, searchable and filterable metric dictionary.
- [x] Research official VALORANT endpoints and DTO capabilities.
- [x] Add About, Privacy and documented Connect Riot readiness flows; the unfinished connection page is now hidden from the public product.
- [x] Add Demo/Riot data-source boundaries without network requests or credentials.

## Task 002A.1 — emoji identity and real-data evidence spike

Status: **PARTIALLY COMPLETE / CLOSED FOR NOW**

- [x] Replace uploaded image avatars with one default emoji per player and one browser-local override.
- [x] Add an accessible Chinese emoji picker with immediate app-wide updates, refresh persistence and reset.
- [x] Remove image validation, resizing, blob display and IndexedDB dependencies from the active product path.
- [x] Add a typed HenrikDev v4 schema summarizer and a local consent/key-gated probe command.
- [x] Prepare the provider/proxy boundary without connecting it to the deployed application.
- [x] Record provider policy, documented schema possibilities and privacy limits without treating them as live verification.

Real account validation, match retrieval, field auditing and capability comparison moved forward into `TASK-API-02`. The deployed GitHub Pages application remains on deterministic fictional data while the Vercel production path is being established.

## Task API-01 — real third-party data validation

Status: **SUPERSEDED BY TASK-API-02**

- [ ] Obtain a Henrik API key through the provider's approved process.
- [ ] Use one explicitly consenting account and retrieve a small latest-match sample.
- [ ] Normalize the real response without committing identifiers, credentials or raw private payloads.
- [ ] Audit observed field coverage, nullability, queues, incomplete matches and reconstruction limits.
- [ ] Compare documented capability with observed capability and record unsupported analytics honestly.

The local `.env` probe remains useful only as historical diagnostic scaffolding. It is not the intended player experience and does not satisfy production integration.

## Task API-02 — production data connection architecture

Status: **COMPLETE**

- [x] Select Vercel full deployment and document alternatives, rollback, privacy and secret boundaries.
- [x] Create and push the `checkpoint-pages-before-api-02` rollback tag.
- [x] Add same-origin provider status, account resolution and bounded match-import server routes.
- [x] Add Taiwan Traditional Chinese `#/connect` UX with explicit consent and no credential fields.
- [x] Normalize provider responses without returning PUUIDs, raw match IDs or raw payloads.
- [x] Keep demo and real datasets explicitly separate and removable.
- [x] Add security, API, normalization and storage tests using mocks only.
- [x] Deploy the full application to Vercel while retaining GitHub Pages.
- [x] Configure a server-only production credential through Vercel environment settings.
- [x] Resolve one consenting account and complete a bounded real-data import.
- [x] Keep provider credentials, PUUIDs, raw match IDs and raw payloads out of browser responses and Git.

TASK-API-02 does not include TASK-002B, Synergy, a scoring rewrite, a database, or provider credential issuance.

## Task API-02.1 — live evidence audit, presentation fix and architecture rebase

Status: **COMPLETE — SDD STRICT**

- [x] Create and push `checkpoint-before-api-02-1-audit` before implementation.
- [x] Run one consent-gated, bounded and sanitized provider audit without retaining player or match identifiers.
- [x] Observe v4 history, match detail, stored matches, current MMR, MMR history and adjacent history windows.
- [x] Classify direct, derivable, reconstructable, partial and unavailable analytics in `docs/REAL_DATA_FIELD_AUDIT.md`.
- [x] Record the stored-match and lifetime-completeness limitations.
- [x] Centralize display rounding for scores, ACS, ADR, ratios, percentages, counts and credits without changing internal precision.
- [x] Add missing/null, sanitized summarizer and numeric-presentation tests.
- [x] Document the current runtime, future Neon schema, backfill, incremental sync, revocation and dataset-runtime boundaries.

TASK-API-02.1 does not implement a database, scheduled sync, new scoring formulas, TASK-002B or Synergy.

## Task DATA-01A — durable database and consent foundation

Status: **COMPLETE**

- [x] Add deterministic Neon-compatible migrations for squad, player, membership, consent, match, participant, round, event, economy, rank, sync and deletion foundations.
- [x] Add server-only keyed identifier protection, match-scoped non-member pseudonyms and independent public application IDs.
- [x] Add accurate `self_asserted` consent semantics and a schema path for future `riot_rso_verified` consent.
- [x] Add normalized, idempotent, one-match transactional persistence with database constraints and disposable Postgres tests.
- [x] Disable the provider evidence audit endpoint in production and extend the client secret-boundary scan.
- [x] Configure Neon in the production Vercel project, apply migration `0001`, and complete the bounded production row-count and idempotency test.

Production validation used one explicitly consenting account and one match. Set-based persistence completed in 5.617 seconds on the first write and 5.041 seconds on the identical second write, using 15 SQL statements including transaction control. Aggregate evidence counts were unchanged after the second write. The tested provider response supplied 177 kill locations but no per-player event-location rows; this absence remains explicit rather than fabricated.

At DATA-01A completion the browser-local REAL envelope remained active; DATA-02A later retired it. The foundation itself did not calculate final event metrics or change scoring.

## Task DATA-01B — bounded historical backfill

Status: **COMPLETE — SDD STRICT**

- [x] Add migration `0002_bounded_historical_sync.sql` without changing applied migration `0001`.
- [x] Add bounded v4 `size/start` backfill with one three-match provider page per invocation and a 25-second useful-work budget.
- [x] Persist explicit run/cursor state, coverage, retries, safe error classes and deterministic termination reasons.
- [x] Add a 45-second expiring per-player Postgres lease so only one invocation can advance a cursor.
- [x] Advance the cursor only after each match page commits; retain earlier pages when a later page fails.
- [x] Add provider-aware 429/backoff behavior and no infinite retries.
- [x] Add newest-overlap incremental sync that stops on the first known durable boundary.
- [x] Keep raw payloads in memory only, public APIs on application UUIDs, and HMAC/provider identifiers server-only.
- [x] Add Chinese connect-page controls for starting, resuming and checking durable sync status while keeping analytics browser-local.
- [x] Validate production with the existing consenting player only.

The production backfill executed 54 chunks and 54 provider requests, observed 159 match responses, updated six overlaps, retried zero times and terminated on an empty page. Its safely reported provider window spans 2025-01-25 through 2026-09-28. The incremental run fetched one three-match page, updated three overlaps and terminated on the known boundary. These dates describe only what the unofficial provider returned at validation time; they do not prove complete Riot lifetime history. See `docs/HISTORICAL_SYNC.md`.

Rank/MMR history synchronization is **NOT IMPLEMENTED**. The observed provider schema does not provide a separately verified bounded pagination contract suitable for the same durable state machine, and match-history completion does not depend on it.

## Task DATA-01C — revocation and deletion execution

Status: **COMPLETE — SDD STRICT**

- [x] Add immutable migration `0003_consent_revocation_deletion.sql` without changing `0001` or `0002`.
- [x] Issue a one-time, high-entropy browser management credential for new consent and persist only its domain-separated HMAC.
- [x] Require constant-time credential verification for revoke, continue and status; public UUIDs alone do not authorize deletion.
- [x] Atomically revoke consent, deactivate membership, cancel active/paused sync, release cursor leases and create/reuse the deletion job.
- [x] Block manual import, historical/incremental sync and reconnect while a revoked deletion is open, before provider access.
- [x] Add bounded, leased, idempotent and resumable deletion stages with safe aggregate progress.
- [x] Delete exclusive matches; unlink and minimize the revoked participant while retaining anonymous event topology in shared matches.
- [x] Remove rank rows, provider identity, membership, consent and sync cursor; anonymize safe sync-run aggregates and player PII.
- [x] Add Chinese two-step revocation UX; clear the browser REAL dataset immediately after acceptance while retaining a deletion-only credential/job session until server completion.
- [x] Restore pending deletion across reload, expose status/continue controls, block provider flows locally and destroy the credential only after `complete`.
- [x] Rotate identity-derived event HMACs for affected shared-match kills while preserving anonymous event ordering and FK topology.
- [x] Add disposable PGlite tests for authorization, race behavior, exclusive/shared data, rank, crash rollback, stale lease, retries, re-consent and local cleanup.
- [x] Apply `0003` to production and perform non-destructive schema/API validation.
- [x] Obtain explicit human confirmation immediately before revoking the current production test player.
- [x] Execute and record the first production destructive revocation/deletion validation.

The approved 2026-10-01 production run used a short-lived operator-only endpoint that never entered Git history. The exact-one legacy-candidate gate passed, all four post-revocation provider paths stopped before fetch, and the real deletion service completed in three leased attempts. It removed 154 exclusive matches, one provider identity, one membership, two sync cursors and personal metadata from two sync runs; there were no shared matches or rank rows. Post-checks found no linked personal evidence, no sync residue and zero relational orphans. The temporary endpoint, three temporary Vercel secrets and local credential/response files were removed before a clean production redeploy. The original Chrome profile was then identified through its one-player/one-match REAL envelope; the product's `移除本機戰績並返回 Demo` action removed it, and refresh persistence plus Demo fallback were verified. See `docs/REVOCATION_AND_DELETION.md`.

## Task DATA-02 — dataset runtime rebase

Status: **COMPLETE — SDD STRICT**

### Task DATA-02A — durable read API and React dataset runtime foundation

Status: **COMPLETE — SDD STRICT**

- [x] Create and push `checkpoint-before-data-02a` at the verified DATA-01C HEAD.
- [x] Add immutable migration `0004_dataset_read_runtime.sql` with a stable browser-safe source-match public ID.
- [x] Add six-query, bounded `DatasetReadRepository` and browser-safe `DatasetProjectionService` boundaries.
- [x] Expose versioned `GET /api/valorant/dataset` with REAL reads disabled by default.
- [x] Limit the dataset to the most recent 300 eligible durable matches and state that it is not lifetime history.
- [x] Expose only non-anonymized players with active consent and active membership; never expose non-consenting identities or event topology.
- [x] Match the legacy projection for ACS, ADR, HS%, KAST, FK and FD without introducing later scoring dimensions.
- [x] Replace module-load/localStorage dataset selection with `DatasetProvider` states: loading, ready, stale, empty, error and demo.
- [x] Keep GitHub Pages intentionally Demo-only and Vercel disabled mode intentionally Demo; never merge Demo and REAL.
- [x] Retire the full browser REAL envelope from the active path and clean the legacy key without persisting server reads.
- [x] Add disposable migration, privacy, shared/revoked, parity, provider-state, route and bounded-performance tests.

DATA-02A prepared a fail-closed read path without deciding distribution. DATA-02B later selected PUBLIC REAL and enabled only the sanitized current-policy projection. See `docs/DATASET_RUNTIME.md`.

### Task DATA-02A.1 — evidence null semantics hardening

Status: **COMPLETE — SDD STRICT**

- [x] Omit a legacy-compatible performance when required stats, denominator or complete round-presence evidence is unavailable.
- [x] Omit matches with no usable visible performance and return `empty` when no usable match remains.
- [x] Keep a shared match when at least one active consenting member has complete evidence, without fabricating metrics for another incomplete member.
- [x] Preserve legitimate observed zero values for combat totals, ACS, ADR, HS%, KAST, FK and FD.
- [x] Treat nullable head/body/leg shot fields as missing evidence rather than silently converting them to zero.
- [x] Keep KAST/FK/FD evidence `partial` when an eligible candidate is omitted for incomplete round evidence.
- [x] Preserve schema version 1, snapshot content semantics and the existing legacy-normalizer parity fixture.
- [x] Add disposable database and route regression tests without adding or changing a migration.

This is a focused projection-correctness hardening. Migrations `0001`–`0004` remain immutable; DATA-02B later added the separate consent-governance migration `0005` without changing projection semantics.

### Task DATA-02B — visibility, distribution and revalidation policy

Status: **COMPLETE — SDD STRICT**

- [x] Adopt the explicit PUBLIC REAL decision with no login, password, access code, session, cookie or read credential.
- [x] Add the single browser-safe privacy version `2026-10-02-public-v1` and require it on every explicit connection request before provider access.
- [x] Add migration `0005_public_dataset_consent.sql` so each player has at most one active consent across policy versions.
- [x] Transactionally revoke an older active consent and create one current active consent only after explicit current-policy connection consent.
- [x] Require current-policy consent for manual import, historical/incremental sync, cursor lease/commit and public visibility.
- [x] Make exact `REAL_DATASET_READ_MODE=public` the only value enabling sanitized REAL reads; every other value fails closed.
- [x] Keep the public route same-origin, rate-limited and `Cache-Control: no-store` without broad CORS.
- [x] Keep GitHub Pages Demo-only and make Vercel the canonical PUBLIC REAL runtime.
- [x] Preserve the newest-300-match bound, DATA-02A.1 missing-evidence semantics and the existing sanitized schema 1 projection.
- [x] Update Chinese consent, Privacy and revocation copy for public publication and resumable deletion semantics.

The current production dataset is validly `empty` because DATA-01C deleted the former test player and no player was reconnected. Public non-empty production content path is **NOT YET EXERCISED AFTER DATA-01C DELETION**; disposable database tests validate current-policy visibility, obsolete-policy exclusion, revocation exclusion and sanitized serialization. TASK-METRICS-01 is complete with empty-production validation; TASK-002B implementation is complete; Synergy remains unstarted.

## Task METRICS-01 — versioned event reconstruction and advanced metric evidence

Status: **COMPLETE — SDD STRICT; non-empty production metric path NOT VERIFIED**

- [x] Add append-only migration `0006_metric_evidence_status.sql` and `durable-evidence-v2` missing/observed/unavailable semantics.
- [x] Implement deterministic `event-metrics-v1` Trade, KAST/opening, 1v1–1v5 clutch, objective, direct cast, economy-efficiency and kill-context reconstruction outside React.
- [x] Preserve full anonymous match topology only inside the server while exposing only current-policy consenting-player aggregates.
- [x] Publish compact schema 2 / `dataset-read-v2` / `event-metrics-projection-v1` responses with explicit evidence and coverage; never return raw events or identifiers.
- [x] Add pure multi-match aggregation that sums counts and recomputes ratios from additive totals.
- [x] Add missing, malformed, observed-zero, order/tie, invalid-denominator, privacy, parity and bounded-performance regression tests.
- [x] Keep all TASK-001 score categories, benchmarks and weights unchanged.
- [x] Verify production aggregate counts, migration-0006 apply/rerun, CI and both deployments.

Existing `durable-evidence-v1` rows default to missing v2 evidence and are not silently upgraded; a future authorized overlap/import may rewrite them. Production remains validly empty, so the non-empty production advanced-metric path is **NOT VERIFIED**. Exact formulas, evidence states and compact-zero semantics are in `docs/METRICS_RECONSTRUCTION.md`.

## Task 002B — evidence-aware scoring correctness

Status: **COMPLETE**

Implementation/local acceptance is recorded in TASK_002B_PLAN.md; final HEAD release gates must be verified before handoff.

TASK-002B does not depend on live API completion. It may use the current deterministic demo evidence while keeping formulas transparent, representing unavailable evidence explicitly and avoiding claims about unverified real-provider coverage.

The following historical audit findings are addressed by this versioned engine (pre-task behavior):

- missing category evidence previously became the numeric score 50 and is indistinguishable from measured neutral performance;
- optional first-kill/death and clutch totals can use partial observations while their derived denominators still cover all rounds/matches;
- one observed match can produce a perfect Consistency score because measured dispersion is zero;
- tiny clutch samples can produce overly strong scores without shrinkage or a minimum sample rule;
- score results do not provide component-level calculation traces;
- role benchmarks are prototype constants without a versioned calibration source;
- aggregate values are rounded before scoring, losing precision;
- Teamplay previously included a significant 25% Win Rate contribution.

Required outcome: a transparent, role-aware, evidence-coverage-aware eight-dimension engine for Firepower, Round Impact, Entry, Teamplay, Clutch, Economy, Consistency and Role Value. Confidence remains separate from performance.

## Task 003 — cross ranking, comparison and contextual analysis

Status: **COMPLETE**

By explicit user decision, TASK-003 was executed before TASK-002B. It consumes the current prototype scoring engine only through aggregation/scoring interfaces; the future correctness work can replace that implementation without rewriting the analytical pages.

- [x] Derive provider-independent player-match performance entries from the normalized dataset.
- [x] Add composable player, period, custom date, map, agent, role, game-mode and sample filters.
- [x] Define recent 10/30 as each player's most recent eligible appearances after contextual filtering.
- [x] Add URL-shareable leaderboard metric, sort and filter state with safe empty/sample states.
- [x] Add 2–4 player comparison with radar, raw metrics and computed relative strengths.
- [x] Add map and agent/role summaries, rankings and score profiles.
- [x] Add paginated demo match history with expandable participating-player performance.
- [x] Enhance player profiles with filtered map/agent splits, recent form and sample-aware map extremes.
- [x] Add eight computed badges with explicit metric, sample and tie rules.
- [x] Keep HashRouter and repository-subpath GitHub Pages compatibility.
- [x] Add domain tests and browser verification for desktop and mobile flows.

## Later roadmap

- Task 004: absorbed by TASK-SYNERGY-01 (teammate matrix / Duo Synergy)
- Task 005 evidence foundation: absorbed by TASK-METRICS-01; any Impact/Frag Quality score remains TASK-002B work
- Task 006 evidence foundation: absorbed by TASK-METRICS-01; weighting and small-sample treatment remain TASK-002B work
- Task 007 evidence foundation: absorbed by TASK-METRICS-01; buy-state bands and Economy score remain future work
- Task 008: advanced UI refinement
- Task 009: CSV and JSON import
- Task 010: GitHub Pages v1.0 release
- Official Riot integration: application readiness is now documented early, but live production player data remains dependent on Production API approval, RSO access and a secure backend.

### TASK-002B execution evidence

Starting HEAD bb2bdb87a3ed3041decb0552177552cc4b1bb558; checkpoint-before-task-002b. Versioned eight-dimensional engine, explicit missing/partial policy, precision preservation, selected-role context, trace UI, radar gaps and fictional Demo evidence implemented. See TASK_002B_PLAN.md and SCORING.md. No migration or provider fetch; non-empty production scoring NOT YET EXERCISED. Next only recommended task: TASK-SYNERGY-01, NOT STARTED [SUPERSEDED: TASK-SYNERGY-01 completed later].
Eight dimensions, missing/partial gates, profile/benchmark versions, independent confidence, role-aware traces, eight-axis radar gaps, deterministic Demo and regression gates are complete. First release CI/Pages/Vercel succeeded; final commit release acceptance is reported at handoff. Public REAL remains empty, non-empty scoring NOT YET EXERCISED. No migration; no provider request. Synergy was not started at this historical checkpoint and is now tracked below.

## TASK-SYNERGY-01 — evidence-aware teammate analytics

Status: **COMPLETE** (implementation release 25cd731; acceptance recorded below)

- [x] Schema 3 / dataset-read-v3 / synergy-ready-projection-v1; opaque same-team groups and correct per-performance outcomes.
- [x] Context-first observed-pair enumeration; opponents excluded from shared and independent baselines.
- [x] Reuse unchanged individual community-score-v2; versioned pair index with both directional lifts, shrinkage, gates and separate confidence.
- [x] Compact consenting-only direct Trade projection from event-metrics-v1; six SQL queries; no migration.
- [x] Chinese matrix, shortlist, pair detail, expandable trace, date/map/mode/minimum-shared filters and public-ID URL selection.
- [x] Varied deterministic Demo and intentional empty/one-player/no-shared REAL states; no persistent pair cache.
- [x] Regression tests for evidence/neutral/asymmetric/filter/trade/privacy semantics and measured bounded payload.
- [x] Final worktree quality gates and deployment acceptance (see TASK_SYNERGY_01_PLAN.md).

Non-empty production Synergy **NOT YET EXERCISED**. Do not reconnect the deleted player, change consent policy or perform Henrik calls for this task.
Task 004 is absorbed. TASK-UI-01 was subsequently explicitly authorized and is tracked below.

## TASK-UI-01 — V1 Product Refinement

Status: **COMPLETE — SDD STANDARD**

Starting HEAD 2a27f46956fd94298ac25469223dd6db236a2b84; checkpoint-before-ui-01.
Presentation only: coherent dark tokens, six primary links and More, honest source/evidence
badges, responsive tables, compact profile/comparison, selected pair before collapsed matrix,
dictionary groups, readable consent steps and lazy routes.
No formula, benchmark, weight, dataset schema, provider, privacy-policy or migration change.
Local and release evidence is recorded in UI_V1.md: 292 tests, lint, build, zero-vulnerability
audit and 15 DB checks passed; implementation CI/Pages succeeded and Vercel was Ready.
Both public runtimes passed all eight key routes at 390/768/1024/1440 CSS px, without
overflow or console errors. Actual 200% zoom and long-name checks passed locally.

## TASK-RELEASE-01 — V1 release acceptance

Status: **PAUSED FOR DATA-03 — SDD STRICT; V1 NOT YET RELEASED**

UI-01 does not declare V1 released. A future explicit task may authorize consenting
real-player reconnect, non-empty REAL validation, real-data scoring checks and Synergy
validation with at least two consenting teammates, production smoke tests, final documentation
and a version/tag/release checkpoint. No production reconnect or Henrik call is authorized
by UI-01. Current non-empty production scoring and Synergy remain NOT YET EXERCISED.

## TASK-RELEASE-01A — Production release preflight

Status: **PAUSED FOR DATA-03 — revised fixture/invariant approval still required**. Dependency gate resolved with SEC-2026-001. No release level selected. See RELEASE_V1.md and SECURITY_EXCEPTIONS.md.
Full audit still reports five high findings, NOT FIXED; production audit is zero.
The 2026-10-03 human-verified production health checks now pass: 27 orphan edges,
cross-match references, migrations 0001–0006, consent, sync and deletion health.
TASK-RELEASE-01A.3 formally dispositions the unpatched dev/build-only risk until
2026-11-03 or an earlier upstream fix. Changed scope/exposure or expiry reopens the gate.
Post-push dataset GET shows two players / seventeen matches, not the required one / ten.
TASK-RELEASE-01A.4 verifies supported Connect/sync/import activity; actor NOT VERIFIED.
Exact acceptance remains unchanged pending approval; no repair or production mutation authorized.

## TASK-RELEASE-01A.2 — Basic / Advanced Evidence Decoupling Hotfix

Status: **COMPLETE — SDD STRICT**. Option A explicitly approved.
Schema 4 preserves valid basic performances with exact visible-player presence
for every distinct durable round. KAST/Opening and topology-dependent domains
remain independently reconstructed/partial/unavailable; no numeric substitutes.
Formulas, engine, privacy and migrations unchanged. CI/Pages/Vercel and read-only
production API/browser acceptance succeeded (see RELEASE_V1.md). No provider call,
import/sync, consent change, deletion, release tag or release level is authorized.

## TASK-RELEASE-01A.3 — Dependency Audit Resolution and Security Disposition

Status: **SECURITY DISPOSITION COMPLETE — SDD STRICT; FINAL PRODUCTION ACCEPTANCE ON HOLD**.
Starting HEAD 846c464f28f54d4e22c53e50d32d99bdaf63041e; pushed checkpoint-before-release-01a3-security.
All five findings classified, production-only install and browser/API dependency
closures checked, compatible update trial reproduced the findings. No dependencies,
application behavior, CI workflow, schema, scoring or Synergy changed. Remote Vercel
artifact bytes NOT VERIFIED; no production-input path exists into affected application
code. See TASK_RELEASE_01A3_PLAN.md and SECURITY_EXCEPTIONS.md for evidence and limits.
Deployment acceptance is recorded at handoff; this does not authorize V1 release.
Required production fixture acceptance is NOT MET (two players / seventeen matches).
Human confirmation and a revised read-only acceptance scope are required; do not repair data.

## TASK-RELEASE-01A.4 — Production Fixture Drift Diagnosis

Status: **DIAGNOSIS COMPLETE — SDD STRICT; HUMAN BASELINE GATE OPEN**.
Starting/final HEAD remains 81c2832d65dcedaccfcded611cc9e6ce798b6031.
SELECT-only anonymous timestamps/health, existing public GET, bounded Vercel route
logs and source inspection classify drift as EXPECTED_SUPPORTED_ACTIVITY.
Two eligible players each have 10 basic performances, sharing 3 same-team matches:
union 17. Seven sources are newly persisted (1 during backfill, 6 during bounded
import); no duplication or revoked/deleted-player contradiction was found.
P2 has one healthy paused backfill, incomplete coverage, no lease/error; do not resume it.
Public Connect is login-free/current-policy self_asserted, so counts can change
without a deployment. Actor/ownership NOT VERIFIED. Requested older log window
was outside retention; observed window 22:15–22:48 Asia/Taipei only. See RELEASE_V1.md.
No application/package changes, provider calls, production writes or migration.
Level B/C prerequisites POSSIBLE only; no release level executed or tag created.
Recommend human-approved invariant-based acceptance; do not adopt it automatically.
TASK-RELEASE-01A remains ON HOLD; TASK-RELEASE-01 IN PROGRESS; V1 NOT YET RELEASED.

## TASK-DATA-03A — Deep Historical Acquisition

Status: **IMPLEMENTATION COMPLETE — SDD STRICT; PRODUCTION ACCEPTANCE BLOCKED**.
TASK-DATA-03A.1 approved canaries passed on 2026-10-04. Full continuation stopped
on P2 provider_repeated_page: P1 paused/P2 failed, both live_v4 and sourceExhausted=false.
Sources 17 -> 30; links P1=15/P2=18; shared=3. Fourteen live provider requests,
zero stored/detail requests; no further sync after stop. SELECT-only integrity
checks passed; the known failed run remains. See DEEP_HISTORY.md for exact evidence.
No completion claim or automatic retry/repair is authorized by this result.
Starting HEAD f3c870f5ee7b93dbbd6fcadf470a5f3053866c17 after preserving/pushing
prior diagnosis; checkpoint-before-data-03a-deep-history at that HEAD.
Independent deep_backfill/deep-history-v1: live size/start then 1-based stored
index and bounded full-detail recovery, no total cap or full-overlap stop.
Append-only 0007, phase/page/item, consent/lease/backoff, aggregate status and
explicit browser auto-continuation. Legacy records, public schema 4/newest-300,
privacy, reconstruction, scoring/Synergy unchanged. See DEEP_HISTORY.md.
Initial implementation CI/Pages/Vercel and migration 0007 verified; final follow-up
deployment status is reported at handoff. Current local gates: 339 tests, lint,
build, 16 DB checks, production audit zero; full audit retains SEC-2026-001.
Deployment/migration and approved DATA-03A.1 execution are recorded separately.
The earlier implementation-only gate was satisfied by explicit human approval;
the subsequent hard stop does not authorize a new crawl or repair. No lifetime guarantee.

## TASK-DATA-03B — Full-history runtime consumption

Status: **SPLIT** (2026-10-05). DATA-03B.1 paginated runtime + browse consumption
IMPLEMENTED; DATA-03B.2 all-history analytics NOT STARTED [SUPERSEDED: redefined and completed as DATA-03B.2A/2B]. The newest-300 snapshot
was not enlarged. See [TASK_DATA_03B_PLAN.md](TASK_DATA_03B_PLAN.md). No v1.0.0.

## TASK-SECURITY-01 — braces advisory follow-up

Status: **MONITORING / BLOCKED ON UPSTREAM**.
Owner: site operator / repository maintainer. Manual review at every release or
dependency/boundary change, and no later than 2026-11-03; no scheduled automation created.
GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 remains unpatched. Completion trigger: patched braces,
safe compatible parent removal, or separately approved and verified toolchain migration.
Rerun full and production audits, physical production-only install, browser/API boundary
checks and regression gates. New high/critical, changed exact five-finding scope, runtime
promotion, input-path change or expired exception blocks release. No automatic renewal.
Do not begin Tailwind 4 migration, provider calls or Release Level validation implicitly.
