# Production data connection architecture

Decision date: 2026-09-29

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

The backend does not calculate UI scores, persist player data, issue provider credentials, or accept Riot authentication secrets.

## Provider evidence

HenrikDev's current OpenAPI advertises API-key authentication through the `Authorization` header and documents account v2 and match-history v4 endpoints. Its project documentation directs operators to its external dashboard/support process for key management. No documented key-issuance or player OAuth API was found, so 哥布林大調查 does not implement or claim one.

HenrikDev is an unofficial provider. Its documented capability is not equivalent to verified live field coverage. `docs/REAL_DATA_FIELD_AUDIT.md` must be created only after a successful consenting three-match production import.

## Phase 1 storage

No database is introduced. The server is stateless. The browser stores only the sanitized normalized dataset under a versioned key. This is sufficient for one player to review imported data on one browser and avoids creating a shared identity database before retention and deletion operations are mature.

A database becomes necessary only when the product intentionally supports shared rankings across devices or scheduled synchronization. That later design must add an explicit identity/consent record, retention period, deletion workflow, access control, and encryption strategy.

## Rollback

The pre-migration state is tagged `checkpoint-pages-before-api-02`. GitHub Pages remains deployed from `main` during migration and continues in demo mode when `/api` is unavailable. Do not disable Pages or redirect it until the Vercel production checks and the controlled three-match test pass.
