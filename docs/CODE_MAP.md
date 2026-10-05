# Code map

## DATA-05A persistent orchestration

- api/valorant/cron/{recent,history}.ts -> server/sync/cronHandler.ts: fail-closed server-only bearer auth.
- server/sync/scheduledSyncService.ts: serial eligibility/work budget/aggregate response.
- server/sync/scheduledRuntime.ts and postgresSyncStore.ts: shared advisory lock, due policy, terminal cooldown/reset and scheduled audit.
- deepHistoryChunk.ts / historicalSyncService.ts: repeated-page pause/backoff, stored fallback and partial terminal sweeps.
- tests/scheduledSync.test.ts and historicalSync.test.ts: mocks/disposable Postgres only.
- docs/PERSISTENT_SYNC.md: activation gate and pending UTC schedule (not registered yet).

This map records the completed DATA-02 PUBLIC REAL runtime, durable evidence/sync/deletion foundations and TASK-METRICS-01 reconstruction boundary.

## Current runtime

```text
React routes/components
  -> DatasetProvider (loading/ready/stale/empty/error/demo)
  -> GET /api/valorant/dataset OR deliberate DemoDataSource
  -> src/data/analytics.ts buildAnalytics(dataset)
  -> PerformanceEntry selection/filtering
  -> aggregatePlayerStats
  -> scoring modules
  -> presentation formatters

#/connect
  -> ValorantBackendClient
  -> /api/valorant/account/resolve + /matches/import
  -> HenrikDataProvider
  -> HenrikDev v4
  -> normalized durable evidence in Neon

GET /api/valorant/dataset
  -> exact REAL_DATASET_READ_MODE=public fail-closed gate
  -> PostgresDatasetReadRepository (six set-based reads)
  -> EventMetricEngine (event-metrics-v1)
  -> DatasetProjectionService (evidence-decoupled-projection-v1)
  -> public browser-safe REAL dataset, coverage and opaque snapshot

#/connect durable sync controls
  -> /api/valorant/sync/start | continue | status
  -> HistoricalSyncService
  -> PostgresSyncStore durable cursor + expiring lease
  -> bounded HenrikDev v4 size/start page
  -> DurableEvidenceService per-match transactions
  -> normalized Neon evidence + safe aggregate progress
```

Current limitations:

- Vercel REAL reads are public without viewer authentication, while all non-`public` mode values fail closed;
- only current `2026-10-02-public-v1` self-asserted consent plus active membership authorizes visibility or provider writes;
- the projection is bounded to the newest 300 eligible durable matches and is not lifetime history;
- versioned Trade/Clutch/Economy/Impact-context/Role-input evidence and TASK-002B eight-dimensional scores exist; non-empty production scoring and pair analytics remain NOT YET EXERCISED;
- the legacy browser REAL envelope remains only for cleanup/tests/rollback and is not read by the product;
- the provider audit endpoint emits only structural evidence outside production and is disabled in production.

## Current ownership

| Area | Files | Responsibility |
|---|---|---|
| Public routes | `src/App.tsx`, `src/routes.ts`, `src/components/AppShell.tsx` | Hash routes and product navigation |
| Public privacy policy | `shared/privacyPolicy.ts` | One browser-safe current public consent version shared by request and server validation |
| Active dataset | `src/contexts/DatasetProvider.tsx`, `src/data/analytics.ts` | Own runtime state and build deterministic analysis from an injected dataset |
| Durable read API | `api/valorant/dataset.ts`, `server/dataset/**` | Fail-closed gate, bounded set-based rows, privacy-safe projection and snapshot |
| Metric reconstruction | `server/metrics/**`, `src/types/advancedMetrics.ts` | Versioned event rules, evidence states, coverage and safe internal trace |
| Legacy browser dataset | `src/dataSources/real/BrowserRealDatasetRepository.ts` | Cleanup/tests/rollback only; not a production source of truth |
| Deletion recovery | `src/dataSources/real/BrowserConsentCredentialRepository.ts`, `BrowserDeletionSessionService.ts` | Migrate active credential state, persist deletion-only job recovery, clear REAL immediately and destroy credential only on completion |
| API client | `src/dataSources/server/ValorantBackendClient.ts`, `DatasetApiClient.ts` | Same-origin account/import/sync/deletion and dataset-read requests |
| Server routes | `api/valorant/**` | Consent, validation, throttling and provider calls |
| Provider adapter | `server/henrikDataProvider.ts`, `src/dataSources/thirdParty/henrikV4.ts` | Fetch, structural audit and normalization boundary |
| Normalization | `server/normalizeHenrikMatches.ts` | Provider DTO to browser-safe dataset |
| Durable evidence normalization | `server/evidence/**` | Raw response in memory to HMAC-keyed relational evidence |
| Database/migrations | `server/db/**`, `migrations/**`, `scripts/migrate.ts` | Neon adapter, transactions and deterministic schema versions |
| Persistence repositories | `server/repositories/**`, `server/persistence/**` | Player, consent and one-match idempotent durable writes |
| Historical sync | `server/sync/**`, `api/valorant/sync/**` | Run/cursor state, leases, bounded pages, retries, coverage and safe status |
| Analytics | `src/analytics/**`, `src/utils/aggregateStats.ts` | Selection, aggregation, rankings, advanced evidence aggregation and summaries |
| Scoring | `src/scoring/**` | Benchmarks, category formulas, weights and confidence |
| Presentation | `src/utils/format.ts`, `src/analytics/presentation.ts` | Display-only rounding and labels |

## Active durable runtime foundation

```text
scheduled/manual sync command
  -> consent + membership authorization
  -> provider adapter with bounded cursor
  -> raw response validated and normalized in memory, then discarded
  -> normalized relational transaction
  -> METRICS-01 versioned evidence reconstruction
  -> versioned read-only dataset API
  -> React DatasetProvider
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
- `src/dataSources/real/BrowserConsentCredentialRepository.ts`: versioned active/deletion-only credential record, separate from analytics data.
- `src/dataSources/real/BrowserDeletionSessionService.ts`: immediate REAL cleanup, reload-safe status/continue and terminal credential destruction.
- `src/pages/ConnectPage.tsx`: Chinese two-step confirmation plus pending-deletion recovery UI that hides provider access until completion.
- Shared-match deletion rotates both participant HMACs and affected killer/victim event HMACs to random tombstones while retaining random internal UUID topology for future Trade/KAST/Clutch/Impact reconstruction.
- `scripts/provision-consent-management.ts`: explicit operator-only legacy provisioning to a new file outside the repository; never a public route.
- `server/deletion/retentionService.ts` and `scripts/purge-expired-deletion-audits.ts`: bounded expiry of 90-day aggregate audit and orphan-free tombstone cleanup.
- Production destructive validation completed on 2026-10-01 after explicit approval. The one-time operator route used for the legacy consent was removed before the clean redeploy and is not part of this code map or Git history.

### TASK-DATA-02 — dataset runtime rebase

- DATA-02A complete: migration `0004`, versioned read endpoint, six-query bounded projection, opaque snapshot and React DatasetProvider.
- DATA-02A complete: explicit loading/ready/stale/empty/error/demo states and deliberate Pages Demo; DATA-02B later enabled public Vercel REAL.
- DATA-02A complete: legacy REAL localStorage cleanup, page migration, privacy/parity/performance tests.
- DATA-02B complete: PUBLIC REAL without login/access code, current-policy consent-only projection, `no-store`, explicit refresh/reload and deliberate production enablement.
- Migration `0005` guarantees at most one active consent per player across policy versions.
- GitHub Pages stays Demo-only; Vercel is the canonical PUBLIC REAL runtime.

### TASK-METRICS-01 — event reconstruction

- Complete: `durable-evidence-v2` plus migration `0006` persist collection and direct-value evidence states without rewriting older migrations.
- Complete: `server/metrics/EventMetricEngine` reconstructs Trade, KAST/opening, 1v1–1v5 clutch, objectives and impact context; direct ability/economy evidence uses explicit invalid-denominator handling.
- Complete: public schema 2 / `dataset-read-v2` / `event-metrics-projection-v1` exposes compact aggregates, coverage and statuses without raw timelines or identifiers.
- Complete: `src/analytics/advancedMetrics.ts` aggregates additive counts and recomputes ratios from totals.
- Internal calculation traces remain server-only. Role-utility effects stay unavailable because they were not observed.
- No score category, benchmark or weight changed; that remains TASK-002B.

### TASK-002B — evidence-aware scoring correctness

- Consume only versioned metric evidence from DATA/METRICS layers.
- Remove neutral-50 substitution for unavailable categories.
- Add minimum samples, uncertainty, trace output and precision-safe aggregation.
- Do not depend on lifetime-complete history.

### TASK-SYNERGY-01

Schema 3 supplies match-local same-team identity and per-performance outcome. EventMetricEngine retains internal direct-trade edges from the existing event-metrics-v1 classifier; DatasetProjectionService exposes compact consenting-only index tuples. No query or migration added.

`src/synergy/{types,benchmarks,index,analytics,tradeEvidence,presentation}.ts` owns pure context selection, observed-pair enumeration, independent baselines, reusable individual Overall windows, calibrated index, sample gates, confidence and trace. `src/dataSources/server/synergyContract.ts` validates the browser trust boundary. `SynergyPage` and `SynergyDetail` render selectors, matrix, shortlist and directional details without scoring formulas. `tests/synergy.test.ts`, datasetRead, metricsReconstruction and datasetRoutes cover domain, projection, privacy, event edges and UI states. Synergy does not enter the individual scoring engine.

## TASK-002B scoring boundary

`src/scoring/versions.ts`, `types.ts`, `profiles.ts`, `benchmarks.ts`, `weights.ts`, `normalize.ts`, `components.ts`, `calculateScores.ts` are the authoritative eight-dimensional scoring engine. `src/analytics/advancedMetrics.ts` aggregates evidence without scoring. `src/data/scoringDefinitions.ts` replaces obsolete dictionary definitions. `ScoreExplanation` is aggregate trace presentation; `GapRadarShape` prevents null vertices being drawn at zero. No database/provider module or migration changed.

## TASK-UI-01 presentation boundary

- `AppShell` and `i18n/zhTW.ts`: six primary routes, More/mobile disclosure,
  keyboard Escape/return focus, skip link and route focus/scroll reset. No route removed.
- `SourceBadge`, `StatusBadge`, `EmptyState` / `LoadingPanel` and `PageErrorBoundary`:
  source/evidence language and safe recovery; `DatasetRuntimeBoundary` keeps stale
  data visible and never substitutes Demo for REAL failure/empty.
- `App.tsx`: module-level lazy pages and Suspense; Dashboard remains eager.
  Existing radar imports stay lazy; non-chart routes do not import Recharts.
- `CompareTables`: transposed score/core table plus closed raw-stat detail, with
  sample headers, table scopes and keyboard-scrollable containers.
- `ComparisonRadar`: external compact text legend, honest null gaps and partial dashes.
  Long legend names retain full title and accessible summary without stretching the chart.
- `index.css`: shared tokens, responsive containers, sticky ranking identity columns,
  visible focus and reduced motion; no external assets, fonts, tracking or UI framework.
- Analytical pages consume the same selection/scoring interfaces. Connect handlers,
  consent text and deletion authorization are unchanged; Privacy changes headings only.
- `tests/uiV1.test.tsx`: focused UI/accessibility/state tests without pixel snapshots
  or a new test dependency. Runtime/navigation regression tests retain prior cases.
- Conventions, before/after bundles and browser acceptance: `docs/UI_V1.md`.
# Deep historical acquisition — DATA-03A

- `server/sync/historicalDiscoveryProvider.ts`: provider-neutral live/index/detail boundary.
- `server/henrikDataProvider.ts`: encoded routes; sync runtime disables internal retries.
- `server/sync/deepHistoryChunk.ts`: bounded two-phase discovery/overlap/detail recovery.
- `historicalSyncService.ts` / `postgresSyncStore.ts`: independent kind, consent/lease, cursor/status/backoff.
- `migrations/0007_deep_historical_acquisition.sql`: append-only phase/counter extension.
- `src/dataSources/server/deepSyncSession.ts`: minimal versioned public-ID recovery/retry spacing.
- `src/pages/ConnectPage.tsx`: explicit start/resume, automatic bounded continue, pause/unmount cleanup.
- Tests: historicalSync, historicalDiscoveryProvider, deepSyncSession, databaseFoundation; fixtures only.
- Specification and production gate: `docs/DEEP_HISTORY.md`.

Dataset read, reconstruction, scoring and Synergy are unchanged.

# Schema-4 hotfix consumer boundary

`src/dataSources/server/datasetContract.ts` validates exact schema/generation/
projection and REAL eventEvidence/value consistency. DatasetProvider consumes
that validator. DatasetProjectionService explicitly checks distinct visible
participant round presence independently of EventMetricEngine topology.
Aggregation and UI preserve optional KAST. Existing scoring and Synergy formulas
remain unchanged; independently complete direct domains remain scoreable.
Regression fixtures live in tests/evidenceDecoupling.test.ts; release evidence
is tracked in RELEASE_V1.md. Historical implementation checkpoints above retain
their original versions.
