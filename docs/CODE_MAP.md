# Code map

## TASK-DATA-PERFORMANCE-SCORE-01

- `server/evidence/shapeInspector.ts` (provider-shape-inspector-v1): value-free path discovery. `HenrikDataProvider.auditPerformanceScoreShape` plus `mode: "performance-score"` on `api/valorant/provider/audit.ts` (non-production only, ≤ 2 logical requests). Tests: `tests/providerShapeInspector.test.ts`. See [PERFORMANCE_SCORE.md](PERFORMANCE_SCORE.md).


## TASK-DATA-03B.2C full-tracked analytics

- `src/analytics/summary.ts` (selection-summary-v1, `summarizeSelection`): the page aggregates. It is
  shared by the browser (Demo/local) and `server/dataset/analysisService.ts` (server-analysis-v2:
  chunked full phase 2, server-side summary and Synergy).
- `src/analytics/rankings.ts` `rankAnalytics` / `insufficientFromAnalytics`; `src/analytics/analysis.ts`
  `computeBadgesFromSummary`.
- `src/hooks/useScopedAnalysis.ts` exposes `summary` and `useSynergyResults`.
- `server/dataset/analyticsContext.ts` `analyticsFacetsSql` (identifier-free facets).
- See [FULL_TRACKED_ANALYTICS.md](FULL_TRACKED_ANALYTICS.md).

## TASK-WEAPON-01 weapon analytics

- src/analytics/weapons/catalog.ts (weapon-catalog-v2; v2 adds Warden → Rifle; tests/weaponCatalog.test.ts), engine.ts (weapon-analytics-v1: aggregates → result,
  canonical identity, coverage, calibration, unsupported list), local.ts (Demo facts + local scopes).
- server/dataset/weaponAnalytics.ts (parseWeaponRequest, GROUPING SETS SQL, WeaponAnalyticsService); runtime.ts;
  api/valorant/dataset.ts dispatch.
- src/dataSources/server/weaponContract.ts (validator); src/hooks/useWeaponAnalytics.ts; src/pages/WeaponsPage.tsx;
  src/components/WeaponSummaryCard.tsx (Profile).
- tests/weaponAnalytics.test.ts, tests/weaponUi.test.tsx.

## TASK-IDENTITY-01B member naming

- migrations/0009_member_nickname.sql; server/identity/memberAdminService.ts `validateNickname`, `setNickname`,
  `clearNickname`, `planCommunityNames`, `applyCommunityNames`; scripts/member-admin.ts (args validated before DB).
- ops/community-names-2026-10-06.json (approved Riot game name → community name; no ids).
- src/components/MemberNickname.tsx (secondary nickname); tests/memberNickname.test.ts.

## TASK-IDENTITY-01 member identity

- migrations/0008_member_multi_account_identity.sql (members, 1:1 backfill, trigger, primary index).
- server/dataset/datasetProjectionService.ts `membersFromRows`, `hasMemberCollision`; postgresDatasetReadRepository.ts
  `activePlayers` (+ member columns); analysisService.ts (member-keyed skeletons).
- server/identity/memberAdminService.ts + scripts/member-admin.ts (`npm run member:admin`, operator only).
- server/deletion/revocationDeletionService.ts (legacy member name scrub and archive on account deletion).
- src/types/valorant.ts `PublicAccount`, `Player.accounts/nameSource`, `MatchPerformance.accountId`;
  src/analytics/identity.ts; src/components/MemberAccounts.tsx; RecentRefreshPanel (account-scoped).
- tests/memberIdentity.test.ts, tests/memberIdentityUi.test.tsx.

## TASK-DATA-FASTSYNC-01 recent refresh

- server/sync/recentRefresh.ts (recent-refresh-v1 pure decision and outcome type).
- server/sync/historicalSyncService.ts `refreshIfStale`; server/sync/postgresSyncStore.ts `recentRefreshState`,
  `acquireCursorLease(..., expectedVersion)`; server/validation.ts `intent`; api/valorant/sync/start.ts.
- src/contexts/DatasetProvider.tsx `refreshRecent` (per-tab auto dedupe, reload on new matches);
  src/components/RecentRefreshPanel.tsx (Profile); copy in src/analytics/presentation.ts, time in src/utils/format.ts.
- tests/fastSync.test.ts, tests/fastSyncUi.test.tsx.

## TASK-PROGRESS-01 improvement index

- src/analytics/progress/benchmarks.ts (improvement-benchmarks-v1), windows.ts (same-Act-first resolution, server-safe),
  improvementIndex.ts (improvement-index-v1 formula, browser).
- server/dataset/analysisService.ts feature `improvementIndex`; src/dataSources/server/analysisResult.ts `progressFromAnalysis`.
- src/hooks/useScopedAnalysis.ts `useProgressIndex`; src/components/ProgressIndexCard.tsx (Profile).
- tests/progressIndex.test.ts, tests/serverAnalysis.test.ts (improvementIndex), tests/serverAnalysisUi.test.tsx.

## TASK-DATA-03B.2B server analytics

- server/dataset/analysisService.ts: request parsing, phase-1 observation SQL, shared-engine resolution, phase-2 projection, response.
- api/valorant/dataset.ts `view=analysis` (+ Server-Timing); postgresDatasetReadRepository exports `selectedMatches`/`detailQueries`.
- src/dataSources/server/analysisResult.ts (contract, validator, selectionFromAnalysis, analysisQueryFor).
- src/hooks/useScopedAnalysis.ts (`useScopedAnalysis`, `useSynergyDataset`); src/components/AnalysisStatusNotice.tsx;
  DatasetProvider request cache + default prefetch.
- tests/serverAnalysis.test.ts, tests/serverAnalysisUi.test.tsx. Design: docs/SERVER_ANALYTICS.md.

## TASK-DATA-SEASON-01 season evidence

- server/evidence/seasonEvidence.ts: independent id/short validation; normalizeHenrikEvidence spreads it into DurableMatchEvidence.
- server/repositories/postgres.ts: source_matches upsert COALESCEs season_id/season_short.
- server/sync/postgresSyncStore.ts `fillKnownMatchSeasons` + deepHistoryChunk stored phase: season-only fill for known matches.
- server/dataset/analyticsContext.ts: season column counts and latestRecordedAct; tests/seasonEvidence.test.ts.

## DATA-03B.2A analytics scope engine

- src/analytics/scope/: versions, types, policies (feature-scope-policy-v1 registry), season (public Act keys),
  observations, adaptiveWindow (adaptive-window-v1), resolveScope (analysis-scope-v1, PAIR context).
- src/analytics/filters.ts `selectPerformances` -> `resolveScopeSelection`; src/analytics/analysis.ts recent form via `recentForm` policy.
- src/data/analytics.ts: population facts + `currentStrength` ranking population.
- server/dataset/analyticsContext.ts + api/valorant/dataset.ts `view=analytics`.
- src/components/ScopeExplanation.tsx (資料範圍 disclosure); AnalysisFilterBar scope/Act options.
- tests/analyticsScope.test.ts, tests/analyticsContext.test.ts. Design: docs/ANALYTICS_SCOPES.md, docs/PROGRESS_INDEX.md.

## DATA-03B.1 full-history pages

- api/valorant/dataset.ts: absent `view` → unchanged snapshot; `view=history` → keyset page (same function).
- server/dataset/historyCursor.ts: query parsing, signed position-only cursor (`dataset-history-cursor:v1`).
- server/dataset/postgresDatasetReadRepository.ts `readHistoryPage`: phase-1 keys+summary, phase-2 range reads.
- server/dataset/datasetProjectionService.ts `readHistory`: shared per-match `project()` with the snapshot.
- src/dataSources/server/historyMerge.ts, src/hooks/useTrackedHistory.ts, src/pages/MatchesPage.tsx: browse-only consumer.
- tests/datasetHistory.test.ts, tests/historyBrowse.test.tsx. Design: docs/TASK_DATA_03B_PLAN.md.

## DATA-05A persistent orchestration

- api/valorant/cron/[job].ts -> server/sync/cronHandler.ts: one function serves recent/history with fail-closed server-only bearer auth (12-function Hobby limit).
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

GET /api/valorant/dataset[?view=history]
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
