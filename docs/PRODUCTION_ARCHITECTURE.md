# Production data connection architecture

Decision date: 2026-09-29

## Deployment status

- Production application: <https://valorant-squad-analytics.vercel.app/>
- Same-origin provider status endpoint: deployed and verified in configured mode; the credential remains server-only.
- GitHub Pages rollback: still active in Demo mode.
- Live account resolution and bounded import: verified with one explicitly consenting account.
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

TASK-DATA-01A adds an optional Neon durable write path behind the server provider. Versioned migration `0001` creates identity, consent, match, round, kill, rank, sync and deletion foundations. Each match normalizes in memory and commits in one transaction; raw provider JSON is discarded. The provider audit endpoint is disabled in production. A read API, backfill, incremental sync, revocation cascade and frontend source-of-truth switch are not included.

## Current architecture limitations

- `src/data/analytics.ts` chooses the dataset at module load, so replacement requires a reload.
- One browser-local envelope is the only real-data store; it is not shared, durable or independently backed up.
- Import limits are fixed to 10/20/30 matches and the normalizer discards most round, kill and economy evidence after computing a few match-level values.
- No server consent ledger, sync cursor, deletion job, retention process or cross-device authorization exists.
- Serverless in-memory rate limits and import locks are per-instance safeguards, not distributed coordination.
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

## Initial backfill — DATA-01B, not started

Backfill runs newest-to-oldest with bounded v4 `size/start` windows, a request/time budget and an unchanged cursor until each page commits. It stops on an empty or short page, a known boundary, or the configured horizon. Every match upsert is idempotent. Coverage start/end and incompleteness are product-visible; stored matches never establish lifetime completeness.

## Incremental sync — DATA-01B, not started

Incremental sync re-fetches a small newest overlap, deduplicates by a keyed match fingerprint, updates changed completed matches and queues only affected derivations. A durable per-player lock, provider-aware rate budget, retry state and schema/normalizer versions replace the current in-memory-only coordination.

## Revocation — DATA-01C, not started

Revocation disables provider access immediately, records the policy/consent transition and starts an idempotent deletion job. The job removes private identity links, participant evidence, derived metrics and caches; shared match facts may remain only when they cannot identify the revoked player. Completion counts and cache invalidation are auditable without logging deleted identifiers.

## Dataset runtime rebase — DATA-02, not started

The frontend should move from module-load localStorage to a `DatasetProvider` with explicit loading, ready, stale, empty and error states. A read-only versioned API returns application IDs, evidence availability, calculation versions, coverage dates and last-sync status. Demo remains a deliberate fallback and GitHub Pages rollback; it is never merged with the real squad dataset.

## Rollback

The pre-migration state is tagged `checkpoint-pages-before-api-02`; the evidence-audit checkpoint is tagged `checkpoint-before-api-02-1-audit`. GitHub Pages remains deployed from `main` and continues in Demo mode when `/api` is unavailable. The Vercel frontend, configured provider-status path and bounded consenting audit are confirmed working. Pages remains a rollback until the durable dataset runtime has its own rollback and deletion evidence.
