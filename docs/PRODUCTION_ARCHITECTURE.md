# Production data connection architecture

Decision date: 2026-09-29

## Deployment status

- Production application: <https://valorant-squad-analytics.vercel.app/>
- Same-origin provider status endpoint: deployed and verified in configured mode; the credential remains server-only.
- GitHub Pages rollback: still active in Demo mode.
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
  -> Henrik adapter
  -> sanitized NormalizedAnalyticsDataset
  -> browser-local real dataset store
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

The public analytics runtime still stores the sanitized normalized dataset under a versioned browser key. This remains sufficient for one player to review imported data on one browser and is deliberately not replaced in TASK-DATA-01A.

TASK-DATA-01A adds a production-validated Neon durable write path behind the server provider. Versioned migration `0001` creates identity, consent, match, round, kill, rank, sync and deletion foundations. TASK-DATA-01B migration `0002` adds executable sync state, public run IDs, aggregate performance/coverage fields and expiring leases. DATA-01C migration `0003` and its revoke/deletion runtime are implemented and disposable-database validated; `0003` is applied to production and its status query passed non-destructive validation, but no production revocation or deletion has run. Each match normalizes in memory and commits in one transaction; raw provider JSON is discarded. The provider audit endpoint is disabled in production. A durable read API and frontend source-of-truth switch are not included.

### DATA-01A production validation

The controlled production sample used one explicitly consenting account and one match. The first write completed in 5.617 seconds and the identical rewrite in 5.041 seconds. Provider fetches took 815 ms and 668 ms; durable normalization took 50 ms and 11 ms; Neon transactions took 4.724 seconds and 4.361 seconds. Each request used 15 SQL statements including transaction control after teams, participants, rounds, round participants, kills, assistants and locations were converted to set-based writes.

Both writes ended with the same aggregates: one player, one active consent, one membership, one source match, two teams, ten match participants, 24 rounds, 240 round-participant rows, 177 kills and 72 assistant links. The sample contained 177 kill-coordinate rows and 240 observed economy rows. It did not contain per-player event-location evidence, so `event_player_locations` correctly remained zero. Nine non-member participants remained match-scoped and pseudonymous. Rank persistence was not part of this import path and `rank_observations` remained zero.

## Current architecture limitations

- `src/data/analytics.ts` chooses the dataset at module load, so replacement requires a reload.
- One browser-local envelope remains the only frontend real-data source; Neon evidence is durable but is not read back into the public analytics runtime yet.
- Import limits are 1/10/20/30 matches. The browser dataset remains match-level, while the server now persists normalized round, kill and available economy/location evidence.
- A server consent ledger, durable cursor execution and credential-authorized deletion state machine exist. Production destructive validation, automatic 90-day audit expiry execution and cross-device recovery without the browser credential remain pending/operator-assisted.
- Historical sync uses a durable 45-second per-player Postgres lease. The older bounded-import in-memory guard remains only for its separate one-request path.
- The public score runtime cannot identify a durable snapshot version because no dataset API exists.

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

## Revocation — DATA-01C implemented / production destructive validation pending

`POST /api/valorant/consent/revoke`, `/api/valorant/deletion/continue` and `/api/valorant/deletion/status` accept credentials only in JSON request bodies. Each request requires the one-time browser management credential; the server stores only its domain-separated HMAC and compares in constant time. No token is accepted in a URL, public UUID alone has no destructive authority, and old consent is not silently upgraded.

Revocation disables provider access in the same transaction, cancels unfinished sync and starts a leased, bounded and idempotent deletion job. Exclusive matches cascade-delete. Shared match participation is unlinked, randomly re-tombstoned and minimized while anonymous event topology remains for another active consenting member. Rank rows, provider identity, membership, consent, sync cursor, personal sync coverage and player display PII are removed; only a tombstone plus aggregate deletion audit remains. Full semantics and recovery policy are in `REVOCATION_AND_DELETION.md`.

## Dataset runtime rebase — DATA-02, not started

The frontend should move from module-load localStorage to a `DatasetProvider` with explicit loading, ready, stale, empty and error states. A read-only versioned API returns application IDs, evidence availability, calculation versions, coverage dates and last-sync status. Demo remains a deliberate fallback and GitHub Pages rollback; it is never merged with the real squad dataset.

## Rollback

The pre-migration state is tagged `checkpoint-pages-before-api-02`; the evidence-audit checkpoint is tagged `checkpoint-before-api-02-1-audit`. GitHub Pages remains deployed from `main` and continues in Demo mode when `/api` is unavailable. The Vercel frontend, configured provider-status path and bounded consenting audit are confirmed working. Pages remains a rollback until the durable dataset runtime has its own rollback and deletion evidence.
