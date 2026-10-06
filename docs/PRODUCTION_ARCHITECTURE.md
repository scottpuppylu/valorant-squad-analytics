# Production data connection architecture

## Current acquisition direction — DATA-05A

Tracker-style persistent Henrik accumulation is primary; Riot ticket is informational,
TASK-DATA-03B.2B: analytics pages use `view=analysis` over all durable history (SERVER_ANALYTICS.md).
TASK-PROGRESS-01: Profile 進步指數 uses `view=analysis&feature=improvementIndex` (PROGRESS_INDEX.md).
TASK-DATA-FASTSYNC-01: Profile refresh-if-stale through `POST sync/start` `intent=refresh_if_stale` (FAST_RECENT_SYNC.md); cron unchanged.
TASK-IDENTITY-01: members (people) above Riot accounts; public schema 5 `member-identity-v1`; maintainer-only `npm run member:admin` (MEMBER_IDENTITY.md).
TASK-IDENTITY-01B: community name + optional nickname, schema 6 `member-identity-v2`; all name edits are operator-only (no public edit endpoint). The 9 approved names were applied once by data migration 0010 via `db:migrate:vercel` (secret never retrieved).
TASK-WEAPON-01: `view=analysis&feature=weaponAnalytics` (WEAPON_ANALYTICS.md) — aggregate SQL over all eligible weapon evidence; still 12 functions; no migration.
TASK-WEAPON-01.1: `weapon-catalog-v2` (Warden → Rifle); classification only.
TASK-DATA-BULK-01C: sanitized `sync_database_failure` server logs (database-failure-stage-v1; labels only; no API change). Phase-2 root cause NOT VERIFIED; see BULK_DATABASE_ERROR_DIAGNOSIS.md.
TASK-DATA-MODE-POLICY-01: strength analytics are Competitive only (mode-eligibility-policy-v1, feature-scope-policy-v3, weapon-analytics-v2), enforced server-side and identically in Demo. Storage and acquisition are unchanged, there is no migration, and functions stay at 12. See MODE_ELIGIBILITY.md.
TASK-DATA-PERFORMANCE-SCORE-01: provider audit gains a shape-only `performance-score` mode in the same function; it remains disabled in Production. HENRIK_API_KEY is Production-only, so no live audit ran. See PERFORMANCE_SCORE.md.
TASK-DATA-03B.2C: no website match-count ceiling. The 300 snapshot is transport-only, and `server-analysis-v2` aggregates full populations in chunks. Still 12 functions, no migration; see FULL_TRACKED_ANALYTICS.md.
TASK-DATA-BULK-01: local `bulk-history-v1` maintainer controller calls only the existing public sync routes. There are no new functions (still 12), no raised rate limits and no secrets; see BULK_HISTORY.md.
TASK-SECURITY-02: dev/build dependency audit re-verified — production install, browser and API closures contain no affected package; see SECURITY_EXCEPTIONS.md / TASK_SECURITY_02.md.
TASK-DATA-SEASON-01 persists provider season evidence (SEASON_EVIDENCE.md).
DATA-04B deferred. DATA-03B.1 (history pages via `/api/valorant/dataset?view=history`,
same function to respect the 12-function Hobby limit) is accepted. DATA-03B.2A context-aware
scope engine plus `view=analytics` facts is complete (ANALYTICS_SCOPES.md); 03B.2B not started. Server-only authenticated recent/history
cron routes reuse existing consent, leases and evidence storage. See PERSISTENT_SYNC.md.
Production-only sensitive CRON_SECRET is configured; both daily schedules are
registered and both secured canaries passed (DATA-05A PRODUCTION ACTIVATED /
ACCEPTED). UTC 18:05 recent / 18:35 history; recurring operation remains enabled.
No browser visitor is required once cron activation passes both canaries; public
schema 4/newest-300 snapshot remains unchanged and remains the analytics input [SUPERSEDED by TASK-DATA-03B.2C: transport-only; analytics are server-side over all tracked history]. No migration, scoring or Synergy change.

Decision date: 2026-09-29

## Deployment status

- Production application and canonical PUBLIC REAL runtime: <https://valorant-squad-analytics.vercel.app/>
- Same-origin provider status endpoint: deployed and verified in configured mode; the credential remains server-only.
- Public dataset read: no login, cookie, Authorization header or access code; only sanitized current-policy consenting-player projections.
- GitHub Pages rollback: still active in Demo-only mode and never calls the production dataset API.
- Live account resolution and bounded import: verified with one explicitly consenting account.
- Durable history sync: verified with 54 bounded backfill chunks plus one newest-overlap incremental chunk.
- Real-data field coverage: verified only for the bounded, sanitized 2026-09-30 sample documented in `REAL_DATA_FIELD_AUDIT.md`; lifetime completeness is **NOT VERIFIED**.

## Decision

Use **Vercel full deployment** for the production application while retaining GitHub Pages as a temporary demo-only rollback deployment.

```text
Browser
  -> same-origin /api/valorant/*
  -> thin Vercel serverless route
  -> ValorantDataProvider boundary
  -> HenrikDataProvider
  -> HenrikDev
  -> Henrik adapter and normalized Neon evidence
  -> versioned /api/valorant/dataset projection (exact public-mode gate)
  -> DatasetProvider
  -> existing TASK-003 query/scoring/UI layers
```

## Options considered

| Option | Result | Reason |
|---|---|---|
| Vercel full deployment | Selected | One deployment, same-origin API, no CORS policy, server-only environment secrets, preview deployments, and the smallest operational surface. |
| GitHub Pages + Vercel backend | Rejected for production | Keeps two origins, requires explicit CORS and two coordinated deployments without providing value for this small application. |
| GitHub Pages + Cloudflare Worker | Rejected for production | Also introduces cross-origin configuration and a second provider/toolchain. It is viable but not simpler here. |

## Frontend compatibility

Vite uses `/` as its base in Vercel builds and retains `/valorant-squad-analytics/` for the existing GitHub Pages workflow. HashRouter remains in place, so old shared analytical URLs remain valid on both deployments.

## Backend responsibilities

- Validate method, content type, input length, affinity, match limit, and explicit consent.
- Read `HENRIK_API_KEY` only from the server runtime.
- Apply timeout, bounded retry, 429 mapping, basic per-instance rate limiting, and duplicate-import protection.
- Convert provider data to the internal normalized model and remove PUUIDs and raw match IDs before responding.
- Return stable error codes and Chinese user-safe messages.

The backend does not calculate UI scores, issue provider credentials, or accept Riot authentication secrets. TASK-DATA-01A adds optional server-side persistence when both database settings are present; without them, the current provider/browser flow remains unchanged.

## Provider evidence

HenrikDev's current OpenAPI advertises API-key authentication through the `Authorization` header and documents account v2 and match-history v4 endpoints. Its project documentation directs operators to its external dashboard/support process for key management. No documented key-issuance or player OAuth API was found, so 哥布林大調查 does not implement or claim one.

HenrikDev is an unofficial provider. A controlled structural audit observed match, round, kill, economy and MMR field families, but this evidence is sample-bound and version-bound. It does not upgrade unofficial provider data into Riot-official truth. See `docs/REAL_DATA_FIELD_AUDIT.md`.

## Browser runtime and durable foundation

TASK-DATA-02 replaces the active browser REAL envelope with a versioned public durable read boundary. `DatasetProvider` removes the legacy key on startup, never writes server-read REAL data to localStorage, and exposes explicit loading/ready/stale/empty/error/demo states. Vercel serves PUBLIC REAL without viewer authentication when `REAL_DATASET_READ_MODE=public`; any other value fails closed. GitHub Pages remains deliberately Demo-only.

TASK-DATA-01A adds a production-validated Neon durable write path behind the server provider. Versioned migration `0001` creates identity, consent, match, round, kill, rank, sync and deletion foundations. TASK-DATA-01B migration `0002` adds executable sync state, public run IDs, aggregate performance/coverage fields and expiring leases. DATA-01C migration `0003` and its revoke/deletion runtime are production validated. DATA-02A migration `0004` adds a stable independent public match UUID. DATA-02B migration `0005` enforces player-scoped active-consent uniqueness. METRICS-01 migration `0006` records evidence status used by `durable-evidence-v2` and `event-metrics-v1`. Each match normalizes in memory and commits in one transaction; raw provider JSON is discarded. The provider audit endpoint is disabled in production.

### DATA-01A production validation

The controlled production sample used one explicitly consenting account and one match. The first write completed in 5.617 seconds and the identical rewrite in 5.041 seconds. Provider fetches took 815 ms and 668 ms; durable normalization took 50 ms and 11 ms; Neon transactions took 4.724 seconds and 4.361 seconds. Each request used 15 SQL statements including transaction control after teams, participants, rounds, round participants, kills, assistants and locations were converted to set-based writes.

Both writes ended with the same aggregates: one player, one active consent, one membership, one source match, two teams, ten match participants, 24 rounds, 240 round-participant rows, 177 kills and 72 assistant links. The sample contained 177 kill-coordinate rows and 240 observed economy rows. It did not contain per-player event-location evidence, so `event_player_locations` correctly remained zero. Nine non-member participants remained match-scoped and pseudonymous. Rank persistence was not part of this import path and `rank_observations` remained zero.

## Current architecture limitations

- Public non-empty production content has not yet been exercised after the DATA-01C player deletion; disposable databases validate the same current-policy projection.
- The read projection is capped at the newest 300 eligible matches and must not be described as complete lifetime history.
- Schema 2 projects ACS, ADR, HS%, KAST, FK/FD plus compact Trade, clutch, objective, direct ability, economy-efficiency and impact-context evidence. Scores and weights for the new dimensions remain deferred to TASK-002B.
- A server consent ledger, durable cursor execution and production-validated credential-authorized deletion state machine exist. Automatic 90-day audit expiry execution and cross-device recovery without the browser credential remain pending/operator-assisted.
- Historical sync uses a durable 45-second per-player Postgres lease. The older bounded-import in-memory guard remains only for its separate one-request path.
- The opaque snapshot covers browser-visible content. The dataset API is `no-store`; the browser loads initially and on explicit refresh/reload without polling or localStorage persistence.

## Persistence architecture

```text
consent + membership
  -> bounded provider synchronization
  -> Neon transaction: source evidence + coverage + sync audit
  -> versioned event reconstruction
  -> versioned metric/score views
  -> sanitized read-only dataset API
  -> React dataset provider and existing analysis pages
```

Neon stores normalized evidence, not UI-formatted strings. Provider lookup identifiers are server-only, domain-separated HMACs. A separate nullable encrypted slot is reserved but unused. Non-consenting participants use match-scoped pseudonyms. Raw payload retention is off; a future debugging exception would require a separate encrypted, access-controlled and expiring design.

## Initial backfill — DATA-01B complete

Backfill runs newest-to-oldest with one v4 `size=3/start=N` request per invocation and a 25-second useful-work budget. The cursor advances only after all matches on the page commit independently. It stops on empty page, short page, repeated fingerprint, no older unique match, or the 300-match horizon. Empty/short pages mark the observed provider window complete; repeated/no-unique/horizon termination records an incomplete reason. Every match upsert remains HMAC-keyed and idempotent.

## Incremental sync — DATA-01B complete

Incremental sync starts again at `start=0`, intentionally re-fetches the newest three matches and stops as soon as a known durable boundary is observed. This updates corrected evidence without crawling the historical window again. Each chunk re-checks active `self_asserted` consent before the provider call. Rate-limited/time-out/5xx results persist exponential backoff; database and malformed-response errors fail without cursor advance.

### DATA-01B production validation

The controlled production run used only the existing consenting player. Backfill issued 54 provider requests, observed 159 match responses, updated six overlaps, retried zero times and stopped on `empty_page`. The observed provider window is 2025-01-25 through 2026-09-28. The follow-up incremental request observed three already-known matches, updated those overlaps and stopped on `known_boundary`.

The backfill accumulated 116.509 seconds of provider fetch time, 1.224 seconds of normalization, 371.672 seconds of database transactions, 512.581 seconds of measured service-core work and 2,394 SQL statements. A full three-match chunk averaged 9.492 seconds of service-core work. Consecutive production UI requests averaged 13.429 seconds end to end, or about 13.4 matches per minute under the conservative manual cadence. See `docs/HISTORICAL_SYNC.md` for calculation details and limitations.

## Revocation — DATA-01C complete and production validated

`POST /api/valorant/consent/revoke`, `/api/valorant/deletion/continue` and `/api/valorant/deletion/status` accept credentials only in JSON request bodies. Each request requires the one-time browser management credential; the server stores only its domain-separated HMAC and compares in constant time. No token is accepted in a URL, public UUID alone has no destructive authority, and old consent is not silently upgraded.

Revocation disables provider access in the same transaction, cancels unfinished sync and starts a leased, bounded and idempotent deletion job. Exclusive matches cascade-delete. Shared match participation is unlinked, randomly re-tombstoned and minimized while anonymous event topology remains for another active consenting member. Rank rows, provider identity, membership, consent, sync cursor, personal sync coverage and player display PII are removed; only a tombstone plus aggregate deletion audit remains. Full semantics and recovery policy are in `REVOCATION_AND_DELETION.md`.

The explicitly approved 2026-10-01 run gated on exactly one active legacy production candidate, provisioned its management credential only inside the server boundary, and verified manual import, reconnect, backfill and incremental sync stopped before any provider fetch. The worker completed in three attempts: 154 exclusive matches deleted, zero shared matches anonymized, one provider identity and membership removed, two cursors removed and two sync runs anonymized. Rank and shared-match counts were zero. The tombstone, zero personal sync residue and zero orphan checks all passed. The temporary operator route and three temporary secrets were then removed, followed by a clean production redeploy whose removed route returned 404.

## Dataset runtime rebase — DATA-02 complete

The frontend uses `DatasetProvider` with loading, ready, stale, empty, error and demo states. `GET /api/valorant/dataset` schema 2 returns only public application IDs, evidence availability, projection version, bounded coverage, compact advanced aggregates and an opaque content snapshot. Exact `REAL_DATASET_READ_MODE=public` exposes the sanitized dataset with no viewer authentication; every other value returns disabled without counts. Public visibility requires active membership and one active `self_asserted` consent on `2026-10-02-public-v1`. Migration `0005` enforces one active consent per player across versions. Demo remains deliberate on Pages and is never merged with REAL. Full details and performance evidence are in `DATASET_RUNTIME.md` and `METRICS_RECONSTRUCTION.md`.

## Rollback

The DATA-02A rollback state is tagged `checkpoint-before-data-02a` at commit `1d2b522`. GitHub Pages continues in deliberate Demo-only mode. Vercel is the PUBLIC REAL canonical runtime; no deleted player was reconnected.
