# Code map

This map records the active browser runtime, the production-validated TASK-DATA-01A evidence foundation, the TASK-DATA-01B durable sync path and the later runtime rebase.

## Current runtime

```text
React routes/components
  -> src/data/analytics.ts (dataset chosen at module load)
  -> BrowserRealDatasetRepository OR DemoDataSource
  -> PerformanceEntry selection/filtering
  -> aggregatePlayerStats
  -> scoring modules
  -> presentation formatters

#/connect
  -> ValorantBackendClient
  -> /api/valorant/account/resolve + /matches/import
  -> HenrikDataProvider
  -> HenrikDev v4
  -> normalizeHenrikMatches
  -> sanitized browser-local REAL dataset

#/connect durable sync controls
  -> /api/valorant/sync/start | continue | status
  -> HistoricalSyncService
  -> PostgresSyncStore durable cursor + expiring lease
  -> bounded HenrikDev v4 size/start page
  -> DurableEvidenceService per-match transactions
  -> normalized Neon evidence + safe aggregate progress
```

Current limitations:

- one browser owns one imported real dataset;
- dataset selection occurs at module load and requires reload after replacement;
- imported normalized rows discard most round, kill and economy evidence;
- durable backfill/incremental sync and DATA-01C deletion execution exist; DATA-01C production destructive validation and DATA-02 reads do not;
- the provider audit endpoint emits only structural evidence outside production and is disabled in production.

## Current ownership

| Area | Files | Responsibility |
|---|---|---|
| Public routes | `src/App.tsx`, `src/routes.ts`, `src/components/AppShell.tsx` | Hash routes and product navigation |
| Active dataset | `src/data/analytics.ts` | Choose REAL browser envelope or Demo fallback |
| Browser persistence | `src/dataSources/real/BrowserRealDatasetRepository.ts` | Validate, store and remove one sanitized REAL dataset |
| API client | `src/dataSources/server/ValorantBackendClient.ts` | Same-origin account/import requests and public errors |
| Server routes | `api/valorant/**` | Consent, validation, throttling and provider calls |
| Provider adapter | `server/henrikDataProvider.ts`, `src/dataSources/thirdParty/henrikV4.ts` | Fetch, structural audit and normalization boundary |
| Normalization | `server/normalizeHenrikMatches.ts` | Provider DTO to browser-safe dataset |
| Durable evidence normalization | `server/evidence/**` | Raw response in memory to HMAC-keyed relational evidence |
| Database/migrations | `server/db/**`, `migrations/**`, `scripts/migrate.ts` | Neon adapter, transactions and deterministic schema versions |
| Persistence repositories | `server/repositories/**`, `server/persistence/**` | Player, consent and one-match idempotent durable writes |
| Historical sync | `server/sync/**`, `api/valorant/sync/**` | Run/cursor state, leases, bounded pages, retries, coverage and safe status |
| Analytics | `src/analytics/**`, `src/utils/aggregateStats.ts` | Selection, aggregation, rankings and summaries |
| Scoring | `src/scoring/**` | Benchmarks, category formulas, weights and confidence |
| Presentation | `src/utils/format.ts`, `src/analytics/presentation.ts` | Display-only rounding and labels |

## Intended durable runtime

```text
scheduled/manual sync command
  -> consent + membership authorization
  -> provider adapter with bounded cursor
  -> raw response validated and normalized in memory, then discarded
  -> normalized relational transaction
  -> metric evidence/reconstruction jobs
  -> versioned aggregate/materialized views
  -> read-only dataset API
  -> React query/provider
  -> existing filters/rankings/pages
```

## Task ownership

### TASK-DATA-01A — durable database and consent foundation

- Implemented Neon-compatible migrations for squad, player, membership, consent, sync run/cursor, source match, participant, round, kill, economy, rank observations and deletion jobs.
- Implemented server-only HMAC lookup identifiers, match-scoped non-member pseudonyms and one-match transactions.
- Production Neon migration `0001` and a bounded one-match write/rewrite are verified; set-based child writes keep the measured path to 15 SQL statements and about five seconds.
- Kept scores out of ingestion tables and kept the browser runtime active.

### TASK-DATA-01B — history and incremental sync

- Complete: bounded newest-to-oldest pagination, coverage windows, retry/backoff, monotonic cursor execution and expiring Postgres lease coordination.
- Complete: newest-overlap incremental sync, public application-ID APIs and production aggregate validation.
- See `docs/HISTORICAL_SYNC.md` for the exact state machine, termination contract and measured capacity.

### TASK-DATA-01C — revocation execution

- `server/consentManagementCredential.ts`: one-time random credential generation, domain-separated HMAC and constant-time verification.
- `server/deletion/`: atomic revocation, deletion lease/state machine, exclusive deletion, shared-match anonymization and privacy-safe progress.
- `api/valorant/consent/revoke.ts` and `api/valorant/deletion/*`: authenticated POST-only public boundaries.
- `src/dataSources/real/BrowserConsentCredentialRepository.ts`: sensitive browser credential storage, separate from analytics data.
- `src/pages/ConnectPage.tsx`: Chinese two-step confirmation and browser cleanup.
- `scripts/provision-consent-management.ts`: explicit operator-only legacy provisioning to a new file outside the repository; never a public route.
- `server/deletion/retentionService.ts` and `scripts/purge-expired-deletion-audits.ts`: bounded expiry of 90-day aggregate audit and orphan-free tombstone cleanup.
- Production destructive validation remains gated and pending.

### TASK-DATA-02 — dataset runtime rebase

- Add read-only versioned dataset endpoints and a React dataset provider.
- Replace module-load localStorage selection with explicit loading/error/stale states.
- Preserve Demo fallback and GitHub Pages rollback.
- Add cache/version invalidation and end-to-end tests.

### TASK-METRICS-01 — event reconstruction

- Implement versioned trade, KAST, clutch, economy and impact event derivations from normalized evidence.
- Emit calculation traces and evidence coverage.
- Keep role-utility components unavailable when effects are absent.

### TASK-002B — evidence-aware scoring correctness

- Consume only versioned metric evidence from DATA/METRICS layers.
- Remove neutral-50 substitution for unavailable categories.
- Add minimum samples, uncertainty, trace output and precision-safe aggregation.
- Do not depend on lifetime-complete history.

### Future Synergy

Synergy remains after durable shared match/membership evidence and TASK-002B. It must not be inferred from one browser-local player import.
