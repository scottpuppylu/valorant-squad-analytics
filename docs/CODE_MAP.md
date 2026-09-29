# Code map

This map records the current runtime and the intended rebase after TASK-API-02.1. It is a dependency guide, not a claim that the future database exists.

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
```

Current limitations:

- one browser owns one imported real dataset;
- dataset selection occurs at module load and requires reload after replacement;
- imported normalized rows discard most round, kill and economy evidence;
- no durable sync cursor, shared squad dataset, revocation job or retention record exists;
- the provider audit endpoint emits only structural evidence and is rate-limited; it is not linked from product navigation.

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
| Analytics | `src/analytics/**`, `src/utils/aggregateStats.ts` | Selection, aggregation, rankings and summaries |
| Scoring | `src/scoring/**` | Benchmarks, category formulas, weights and confidence |
| Presentation | `src/utils/format.ts`, `src/analytics/presentation.ts` | Display-only rounding and labels |

## Intended durable runtime

```text
scheduled/manual sync command
  -> consent + membership authorization
  -> provider adapter with bounded cursor
  -> raw-response quarantine (optional, encrypted, short retention)
  -> normalized relational transaction
  -> metric evidence/reconstruction jobs
  -> versioned aggregate/materialized views
  -> read-only dataset API
  -> React query/provider
  -> existing filters/rankings/pages
```

## Task ownership

### TASK-DATA-01 — durable normalized evidence store

- Add Neon Postgres and migrations for squad, player, membership, consent, sync run, source match, participant, round, kill, economy and rank observations.
- Store provider identifiers only as server-side keyed identifiers; never expose them to the browser.
- Add idempotent initial backfill and incremental sync with coverage windows and audit logs.
- Add revocation/deletion transaction and retention enforcement.
- Keep scores out of ingestion tables.

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

