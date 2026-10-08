# Static public read model — TASK-INFRA-STATIC-DATA-PUBLISH-01 / TASK-INFRA-STATIC-QUERY-PARITY-01

> **Query parity (TASK-INFRA-STATIC-QUERY-PARITY-01):** every normal visible filter, including multi-filter combinations
> and custom dates, is served from the snapshot's public facts by the SHARED server analysis core. See §10. The
> precomputed catalog of §2 is now an optional first-paint cache.

**Status:** local implementation, synthetic data only. Nothing has been published. Production data was not used.

```
Henrik API → local sync worker → local PostgreSQL (SOURCE OF TRUTH)
          → static exporter (one READ ONLY snapshot, privacy gate) → immutable versioned JSON snapshot
          → publisher (manifest LAST) → static host (GitHub Pages data repo / NAS / local web root)
          → browser: fetch manifest on load/refresh → fetch only the needed files of THAT snapshot
```

- **PostgreSQL is the only authoritative state.** Public JSON is a derived, disposable cache. If it is lost, re-export
  it from PostgreSQL. Nothing ever reads public JSON back into PostgreSQL: the exporter's transaction is
  `READ ONLY`, and guards in `tests/databaseArchitecture.test.ts` enforce this. Git history is never a match
  database.
- **Static distribution needs no inbound networking.** No public Node API, no public PostgreSQL, no port forwarding,
  and no CGNAT resolution are required to serve the public read views. CGNAT therefore no longer blocks the public
  site; it only blocks the old "self-hosted public API" path.
- **The browser is read-only.** A page view never calls Henrik or Riot, never writes, and never triggers
  publication, so provider rate limits are decoupled from traffic.

## 1. Current read-path inventory

Every public read goes through `DatasetApiClient` (`src/dataSources/server/DatasetApiClient.ts`), which is the data
provider seam. Pages never call `fetch` themselves.

| Page / component | Hook → client call | Live endpoint | Static |
|---|---|---|---|
| Bootstrap (all pages): players, newest-300 transport snapshot | `DatasetProvider` → `load()` | `GET /api/valorant/dataset` | **STATIC_SAFE** → `dataset.json` |
| Filter options, tracked counts, Act / rank evidence (Dashboard, Synergy, Connect, filter bar) | `loadAnalyticsContext()` | `?view=analytics` | **STATIC_SAFE** → `analytics.json` |
| Dashboard, Leaderboard, Compare, Profile scores (`currentStrength` / `lifetimeTotals` / `fixedRecent` / `actOverview`) | `useScopedAnalysis` → `loadAnalysis()` | `?view=analysis&feature=…` | **STATIC_REQUIRES_TRANSFORM**: query-keyed catalog. `form` is served by the form superset |
| Maps (`mapStats`), Agents / roles (`agentStats`) | `useScopedAnalysis` | `?view=analysis` | **STATIC_REQUIRES_TRANSFORM** (catalog) |
| Synergy (`synergy`) | `useSynergyResults` | `?view=analysis&feature=synergy` | **STATIC_REQUIRES_TRANSFORM** (catalog) |
| Profile progress (`improvementIndex`) | `useProgressIndex` | `?view=analysis&feature=improvementIndex` | **STATIC_REQUIRES_TRANSFORM** (per member) |
| Weapons page, profile weapon card | `useWeaponAnalytics` → `loadWeaponAnalytics()` | `?view=analysis&feature=weaponAnalytics` | **STATIC_REQUIRES_TRANSFORM** (catalog) |
| Match history (Matches) | `useTrackedHistory` → `loadHistory()` | `?view=history` (HMAC-signed cursor) | **STATIC_REQUIRES_TRANSFORM**: page files with static tokens `page:NNNN` |
| Custom date ranges; combinations of 2+ filters; Synergy by map / mode / dates | same hooks | `?view=analysis` | [SUPERSEDED by TASK-INFRA-STATIC-QUERY-PARITY-01: **STATIC via public facts**, see §10] DYNAMIC_REQUIRED (not precomputed) |
| Recent refresh (更新戰績), Connect / import / sync / consent revoke / deletion, provider status | `refreshRecent`, `valorantBackendClient.*` | `POST /api/valorant/…` | **DYNAMIC_REQUIRED**: mutations and operator flows. Absent in static mode; never JSON |
| Riot provider, demo-only local analytics | — | — | **NOT_CURRENTLY_USED** in REAL static mode (Demo keeps its local data) |

Dictionary, About and Privacy have no dynamic data beyond the bootstrap.

**No analytics are recomputed.** Every static file is the exact payload that the live route returns for that URL:
`server/staticExport/sources.ts` calls the same services through the route's own parsers. The browser keeps running
only what it already runs today (score formulas on the received aggregates).

## 2. Snapshot layout (`static-snapshot-v1`)

```
<root>/manifest.json                         the ONLY mutable file (published LAST)
<root>/versions/<snapshotId>/index.json      catalog: canonical request key → file
                             dataset.json    bootstrap (same as GET /api/valorant/dataset)
                             analytics.json  aggregate facts (view=analytics)
                             history/page-0001.json …   50 matches per page, strictly older than the bootstrap
                             analysis/a00001.json …     one file per precomputed analysis request
                             weapons/w00001.json …      one file per precomputed weapon request
                             integrity.json  SHA-256 + bytes of every file (publisher verification)
```

**Manifest** (`src/dataSources/static/contract.ts`, validated by `isStaticManifest`):

```json
{ "schemaVersion": 1, "snapshotVersion": "static-snapshot-v1", "snapshotId": "s-<20 hex>", "dataVersion": "<projection version>", "generatedAt": "<ISO>" }
```

- **`snapshotId`** is content-addressed: SHA-256 over every file hash plus the catalog. The same durable data gives
  byte-identical files and the same id (deterministic). A version directory is immutable; re-exporting reuses it.
- **Browser flow:** fetch `manifest.json` (`cache: 'no-cache'`, revalidated), fetch `versions/<id>/index.json`, then
  only the files a page needs. `StaticSnapshotClient` pins one snapshot per `load()`. Requests issued in the same
  tick bind to the new pin, so two versions are never mixed. Refresh (`load()` again) discovers a new manifest.
  The Dashboard never fetches history.
- **Catalog** (`server/staticExport/catalog.ts`, `static-catalog-v1`):
  - **core** (default):
    - every page's default request;
    - every period (目前實力, 全部已追蹤, 最近 10/30, each Act) for the whole community and for each member;
    - every map (Maps) and every agent and role (Agents);
    - Synergy overall and per Act;
    - progress per member;
    - weapons per member × scope (all / current / each Act).
  - **extended**: core plus every single-filter slice (one of member / map / agent / role / mode) for every
    period, Synergy by map, and weapons by map and agent.
  - **Keys:** canonical request keys come from the same `analysisSearchParams` / `weaponSearchParams` the live
    client uses, so they cannot drift.
- **Form-superset transform:** scope features are exported with recent-form windows. The form-less answer is
  exactly that answer minus `forms` (test-proven), so one file serves both.

## 3. Public export security model

The GitHub data repository, Pages and any static host are **public Internet data**. Export is schema-driven and
never serializes rows.

1. **Contract:** each artifact must pass its existing public validator (`isDatasetResponse`,
   `isDatasetAnalysisResponse`, …).
2. **Allowlist** (`server/staticExport/publicAllowlist.ts`, `public-export-allowlist-v1`):
   - every key path must be explicitly allowlisted per artifact kind;
   - any unknown field fails the export (fail closed) until it is reviewed;
   - `*` marks only public dynamic keys: map names, role names, clutch opponent counts.
3. **Forbidden-name semantics** (`privacy.ts`):
   - word-based, so e.g. `blockedRounds` does not match `lock`;
   - rejects `puuid`, `hmac`, `secret`, `password`, `token`, `cursor`, `lease`, `lock`, `credential`, `auth`,
     `session`, `consent`, `revocation`, `email`, `ip`, `fingerprint`, `internal`, `api key`, `database url`,
     `provider id`, `lookup`;
   - one explicit, value-checked exception: history `page.nextCursor` must be a static `page:NNNN` token.
4. **Content scan:**
   - configured secret values (`DATABASE_URL`, `HENRIK_API_KEY`, `IDENTIFIER_HMAC_KEY`, `CRON_SECRET`,
     `POSTGRES_PASSWORD` from the exporter's environment);
   - credentialed or `postgres://` URLs, `HDEV-` provider keys, `Bearer` tokens, private keys;
   - 70+ character opaque tokens (Riot-PUUID shape).
5. **Database cross-check:**
   - collects every UUID and 64-hex token in the snapshot;
   - asks PostgreSQL whether any of them is an internal id (any `uuid` column not named `*public_id`) or a stored
     HMAC / credential / token / fingerprint value;
   - columns are discovered from the live schema, so new sensitive columns are covered automatically.

**Public identity: `PUBLIC_PLAYER_IDENTIFIER_SAFE=YES`.**

- Routes and keys use `members.public_id`, a random UUID with no relation to the Riot PUUID or internal ids.
- Accounts use `players.public_id` and matches use `source_matches.public_id`.
- Riot `gameName#tag` is the consented, already-public account label.
- Never exported: PUUIDs (never stored), HMACs, consent / revocation / deletion records, sync runs, cursors, leases,
  provider identities, raw provider match ids, internal ids, error payloads, infrastructure details.

**Tests** (`tests/staticSnapshot.test.ts`) prove each of these:

- an injected `puuid` field, a provider match id, a secret value, a credentialed URL, a provider key, an opaque
  token, an internal row id and a stored HMAC each fail the export;
- a failed export finalizes nothing.

## 4. Exporter, publisher, atomic visibility

- **Export:** `npm run data:export -- --out <dir> [--tier core|extended]`.
  - Reads only a **local** `DATABASE_URL`: loopback, a private address or a Compose service name. Managed hosts
    such as Neon are refused.
  - Takes one `REPEATABLE READ, READ ONLY` snapshot (a sync committing meanwhile cannot mix data states) and writes
    to a staging directory.
  - Validates every file, then writes `index.json` and `integrity.json`, then atomically renames to
    `versions/<id>/`.
  - A failure removes the staging directory and leaves existing versions untouched.
  - Bounds: 5 MiB per file, 768 MiB and 20 000 files per snapshot, history pages ≤ tracked/50 + 2. Fails closed.
- **Publish:** `npm run data:publish:local -- --version <versions/<id>> --target <web root> [--keep N]`.
  - `SnapshotPublisher` interface: (1) copy the immutable version, (2) verify every SHA-256 at the destination,
    (3) replace `manifest.json` **last** (temp file + rename), (4) optionally prune.
  - A failure before step 3 leaves the previous manifest, and therefore the previous snapshot, active
    (test-proven, including a crash mid-upload and a corrupted source).
- **Host independence (`EXPORTER_GITHUB_COUPLING=NONE`):** the exporter has no network, Git or GitHub code
  (guarded). GitHub, a NAS or another host is only another `SnapshotPublisher`.

## 5. Cache model

| File | Policy |
|---|---|
| `manifest.json` | Short / no cache. The client always sends `cache: 'no-cache'` (conditional revalidation, cheap with ETag) |
| `versions/<id>/**` | Immutable by path. Long cache is safe (`max-age=31536000, immutable` where the host allows) |

No cache-busting query strings are used. GitHub Pages applies its own short `max-age` to every file and does not
allow custom headers. The manifest revalidation still discovers a new snapshot on reload, and version paths never
change content.

## 6. Frontend static mode

- **Build-time, public configuration only:**
  - `VITE_DATA_MODE=static`, plus optionally `VITE_STATIC_DATA_BASE=<URL of the directory holding manifest.json>`;
  - the default base is `<app base>public-data/`;
  - no URL is hardcoded, and no secret appears in a Vite variable (the bundle passes the secret-boundary check).
- **Defaults are unchanged:** without `VITE_DATA_MODE=static` the build behaves exactly as before. The current
  GitHub Pages workflow keeps building Demo; same-origin `/api` stays the default elsewhere. With static mode,
  `*.github.io` reads the snapshot instead of forcing Demo.
- **What static mode turns off:**
  - recent refresh, Connect / sync / consent / deletion mutations (dynamic only);
  - requests outside the catalog, which show an explicit notice.

## 7. Publication channel — recommendation

| | A. Data branch in this repository | B. Separate public data repository (Pages from branch) | C. Pages artifact channel |
|---|---|---|---|
| Per-refresh `main` push | No, but Pages serves one source per repo: serving the branch means coupling it into the source deploy workflow (or using raw.githubusercontent, which is not a hosting API) | **No**. Independent repository and Pages site | No main push, but one Pages artifact must hold frontend + data, so every data deploy redeploys the site and every source deploy must re-include data |
| Atomic snapshot | Version dirs + manifest commit | **Version dirs, then manifest commit** (manifest last); a Pages deploy swaps the whole site | Artifact swap is atomic, but two writers (source CI, data job) race |
| Git growth | Lands in the source repo (every clone pays) | **Isolated**: squash / orphan history without touching source history | No Git growth, but artifacts are rebuilt each time |
| Fetch / CORS | Same site only if wired into the deploy | **Same origin** (`https://<user>.github.io/<data-repo>/` vs `/<app-repo>/`): no CORS at all | Same origin |
| Credential scope / blast radius | Token can write the source repo (and `main`) | **Fine-grained token for the data repo contents only**; cannot touch source or `main` | Actions OIDC on the source repo |
| Local automation | Git push | **Git push of one commit** (or GitHub Contents API) | Requires running a workflow |
| Rollback | Re-point manifest / revert | **Re-point manifest to a retained version** (instant), or revert the commit | Redeploy previous artifact |
| Replace GitHub later | Medium | **Easy**: same directory layout on any static host | Hard (Pages-specific) |

**RECOMMENDED_PUBLICATION_CHANNEL = B (separate public data repository served by GitHub Pages).** Not created and
not pushed in this task. A future `GitHubDataRepositoryPublisher` implements `SnapshotPublisher`:

1. Commit `versions/<id>/**` (verify).
2. Commit `manifest.json` (last).
3. Push with a token scoped to that repository only.

## 8. Size measurements (synthetic, real PostgreSQL 16, 9 members)

Measured in WSL Docker Engine (PostgreSQL 16.15) with `scripts/rehearsal-seed.ts` (`REHEARSAL_ACCOUNTS=9`, fictional ids,
3 Acts, every queue class). No Henrik, no Production DB.

| Artifact | Current scale (840 matches), core | Current scale, extended | Large scale (10 000 matches), core |
|---|---|---|---|
| Files | 164 (105 analysis, 45 weapons, 11 history pages) | 1 140 (361 analysis, 765 weapons) | 348 (105 analysis, 45 weapons, 194 history pages) |
| Total raw / gzip | **29.9 MB / 2.78 MB** | 126.2 MB / 11.0 MB | **≈ 56.4 MB / ≈ 4.9 MB** |
| `manifest.json` | ~200 B | ~200 B | ~200 B |
| `index.json` | 16.9 KB | 146 KB | ≈ 17 KB (same catalog) |
| `dataset.json` (bootstrap, 300 matches) | 851 KB (largest file) | 851 KB | 851 KB |
| `analytics.json` | 2.9 KB | 2.9 KB | 2.9 KB |
| Leaderboard / Dashboard (`currentStrength`, community) | 743 KB | 743 KB | 743 KB |
| Player summary (`currentStrength`, one member) | 118 KB | 118 KB | ≤ 743 KB (currentStrength max) |
| Analysis median / max | 123 KB / 772 KB | 367 KB / 772 KB | 124 KB / 779 KB |
| History page (50 matches) max | 156 KB | 156 KB | 162 KB (194 pages, 27.7 MB total) |
| Synergy (largest) | 388 KB | 388 KB | 387 KB |
| Progress (one member) | 101 KB | 101 KB | 101 KB |
| Weapons (max, no synthetic weapon evidence) | 13.7 KB | 13.7 KB | 12.7 KB |
| Export time | 58–61 s | 216 s | Every non-weapon artifact in ≈ 4 min. **Weapons: 45–85 s per request** (existing weapon-analytics aggregate SQL). With the default 55 s statement timeout the export **fails closed**; with `DATABASE_STATEMENT_TIMEOUT_MS=900000` it reached 22/45 weapon files in 32 min and was stopped (projected > 60 min) |

**Determinism:** two exports of the same database, and an export of a freshly reseeded database, produced the
same `snapshotId` (`s-d477c24eb6f1dfe3bd73`). A WSL-built snapshot verified byte-for-byte on Windows.

Analysis files barely grow with history: they are aggregates plus bounded windows. Growth at scale is history
pages, which are linear (50 matches ≈ 140–160 KB each).

**Large-scale finding:** the existing weapon-analytics SQL (TASK-WEAPON-01) does not scale to 10 000 matches within the
55 s statement timeout. This is not an exporter defect. The same request would fail on the live API. It needs a
separate, SDD-authorized weapon-analytics scaling task. Until then a large export either fails closed or needs a
raised timeout.

**Target maximum file size: 1 MiB** (hard limit 5 MiB). Every measured file stays below 1 MiB. Payloads are
dominated by the transparent score traces of the existing public contract, and JSON compresses about 10×. A
Dashboard load is about 1.6 MB raw (manifest + index + dataset + analytics + one analysis), or about 150 KB
compressed, and never touches history.

## 9. Retention and growth

Basis: the current-scale core snapshot, 29.9 MB raw and 2.78 MB compressed (Git stores zlib-compressed blobs).
Worst case assumes no file deduplicates between snapshots. History pages shift as new matches arrive, and analysis
files change with any new match.

| Assumption | New bytes per day (compressed) | 30 days | 1 year |
|---|---|---|---|
| **4 publishes/day** (2 daily sync jobs + a few manual refreshes) | 11.1 MB | 334 MB | 4.1 GB |
| 24 publishes/day (hourly, upper bound) | 67 MB | 2.0 GB | 24 GB |
| Large-scale snapshot (10 000 matches), 4/day | 19.6 MB | 588 MB | 7.2 GB |

Unbounded Git history is therefore **not acceptable**: it would exceed GitHub's recommended repository size within
months. Retention policy:

- **Published tree:**
  - the current version plus the **3 previous versions** (rollback window), using
    `LocalFilesystemPublisher --keep 4`, or the same rule in a future remote publisher;
  - about 4 × 30 MB = 120 MB raw, well under the 1 GB GitHub Pages site limit.
- **Data repository history:** squashed. Each publication is one commit that replaces the tree (or there is a
  periodic squash), so repository size stays about 4 × 2.8 MB compressed.
  - This needs a force-push on the **data repository only**, never on this source repository. It needs explicit SDD
    authorization when the remote publisher is implemented.
- **No historical snapshot archive by default.** Checkpoints are unnecessary: PostgreSQL plus its rehearsed backups
  are the authoritative restore path, and any snapshot can be re-exported deterministically.
- **Rollback:** re-point `manifest.json` to a retained version (instant, no rebuild). Beyond the window, re-export
  from PostgreSQL.

## 10. Static query parity — TASK-INFRA-STATIC-QUERY-PARITY-01

**Rule:** a static architecture must not reduce normal user-visible functionality. The precomputed catalog alone
(§2) did: it served only single-filter queries. It is replaced by a **hybrid**: public facts plus the shared
analysis core run in the browser, with an optional small first-paint catalog.

### 10.1 Capability matrix (normal visible controls)

| Control (page) | Live API | Static before | Static now | Mechanism |
|---|---|---|---|---|
| Period: 目前實力 / 全部已追蹤 / 最近 10 / 最近 30 / 指定 Act (Leaderboard, Profile, Compare, Maps, Agents) | ✓ | ✓ (single filter) | ✓ | Shared core on facts; defaults precomputed in `common` |
| 自訂日期 from / to (same pages, Synergy) | ✓ | ✗ | ✓ | Shared core on facts: phase-1 skeletons, then only the matching match chunks |
| Member / map / agent / role / mode, any combination | ✓ | single only | ✓ | Shared core on facts |
| Recent form (`form`) (Dashboard, Leaderboard, Profile) | ✓ | ✓ (superset) | ✓ | Shared core (`form` windows) |
| Minimum matches / rounds; ranking metric; compare members; Agents agent/role view | client-side | ✓ | ✓ | Unchanged browser presentation over the result |
| Synergy map / mode / Act / dates; pair A/B; minimum shared | ✓ | Act only | ✓ | Shared core (duo-synergy-v1) on facts; A/B/min are client-side |
| Progress (improvement index) per member | ✓ | ✓ | ✓ | Shared core on facts |
| Weapons member × scope (all / current / Act) × map × agent × mode | ✓ | member × scope | ✓ | Shared weapon query on per-member weapon facts |
| Match history paging | ✓ | ✓ | ✓ | Static page files (unchanged) |
| Recent refresh, Connect, sync, consent, deletion | ✓ | — | — | Mutations (out of scope, dynamic by nature) |

**CURRENT_USER_VISIBLE_FILTER_CAPABILITY_PRESERVED = YES.** The "未預先計算" notice now appears only for an old
snapshot without facts.

### 10.2 Options evaluated

| | A. Precomputed catalog | B. Public facts only | C. Hybrid (selected) |
|---|---|---|---|
| Function parity | ✗ (combinations explode: about 3 500 weapon files alone) | ✓ | ✓ |
| Snapshot size | 29.9 MB at 840 (core) / 126 MB (extended, still incomplete) | 6.0 MB / 0.40 MB gz at 840; 70.7 MB / 4.6 MB at 10k | 9.3 MB / 0.70 MB gz at 840; 74.0 MB / 4.9 MB at 10k |
| Duplication | Score traces repeated in every file | History pages duplicate match facts | Same as B, plus a few first-paint files |
| Export time at 840 / 10k | 61 s / not completed (> 60 min, weapon SQL × 45) | 7.8 s / 117 s | 6.5 s / 139 s |
| Browser transfer / CPU | One file per view | Facts loaded lazily; CPU = the server's shared code | First paint like A; anything else like B |
| Formula reuse | Server only | 100 % shared core | 100 % shared core |
| Privacy surface | API payloads | + public facts (§10.3) | Same as B |
| 10k scale | Weapon SQL blocks | Feasible | Feasible |
| Weapon analytics impact | 45–85 s SQL per request | One fact pass per member | Same as B |

**Why C:** B gives parity with one shared implementation, and A's few first-paint files make the default
Dashboard / Profile / Synergy page cheap without loading facts.

### 10.3 Public fact model (`public-facts-v1`, `src/dataSources/static/publicFacts.ts`)

| File | Content | Why each field is needed |
|---|---|---|
| `facts/meta.json` | tracked match count; population evidence (Act keys, season / rank status); members as the analysis payload ships them, and as phase 1 sees them; chunk directory; weapon member list and observed Act keys | Exact inputs of `analysisPopulation`, `resolveAnalysisMatchIds`, `finalizeAnalysis` and the weapon reasons (`act_not_observed`, `member_not_visible`) |
| `facts/skeletons-NNNN.json` | Every eligible match: public match id, time, map, mode, opponent label, score, outcome, duration, public Act, (member id, agent) per visible performance | Phase 1 resolves EVERY population (adaptive windows, recent N, dates, filters) over all history; the server builds the identical skeletons |
| `facts/matches-NNNN.json` | Full public `MatchRecord`s (the same records history and analysis payloads already publish), plus `[roundEvidence, headshotEvidence]` per match | Phase 2 (scores, summaries, windows, Synergy); the flags reproduce the payload's `evidence` availability exactly |
| `facts/weapons-NNNN.json` | Per member and match: public account id, match id, map, agent, raw Act code (already public in weapon breakdowns), time, normalized game mode, raw map/agent-null flags; per round: won, weapon / loadout / stats evidence status, weapon `[id, name]`, loadout value, round score; per kill: weapon `[id, name]` | Exactly the SQL `participations` + `rr` + `kk` inputs of the weapon aggregates (`aggregateWeaponFacts`, the engine's tested SQL mirror) |

**Not present:** PUUIDs, internal ids, HMACs, consent / revocation / deletion records, sync cursors, leases,
credentials, raw provider match ids, error payloads.

**One new public field for SDD attention:** the Riot weapon content id (`weaponId`). It is a static game-asset
identifier, identical for every player and not personal data. The live API never echoed it, but the engine's
grouping and its `x-<hash>` keys for unknown weapons depend on it, so exact parity needs it.

**Gate:** every fact file passes the allowlist, forbidden-name, content and database cross-check layers (§3). Every
encoded skeleton and weapon fact must round-trip losslessly, or the export fails.

**Chunking:**
- matches: 200 per file, by `(playedAt, id)` ascending, so older chunks stay byte-identical as history grows;
- skeletons: 4 000 per file;
- weapon participations: 1 000 per file, per member.

### 10.4 Browser engine (`StaticQueryEngine`, Web Worker)

- **No analytics of its own.** It calls the core extracted from the server (`src/analytics/analysisCore.ts`, now
  used by `ServerAnalysisService` too) and the shared weapon query (`src/analytics/weapons/weaponQuery.ts`, now
  used by `WeaponAnalyticsService` too).
- **Lazy loading:**
  - meta and skeletons once per snapshot;
  - only the match chunks holding selected matches (binary search on the chunk ranges);
  - weapon chunks only for weapon views (the summary lists every member).
- **Off the main thread:** it runs in a module Web Worker, with an in-thread fallback.
- **Caching:** parsed chunks are cached per pinned snapshot. A new manifest means a new engine, so old facts are
  released.

### 10.5 Parity evidence (`tests/staticQueryParity.test.ts`)

The oracle is the live route's own services (`postgresExportSources`, i.e. exactly what `/api/valorant/dataset` returns).
They are compared with the browser engine over the exported facts, on synthetic data with seeded weapon evidence
(known, name-only, unknown and ability weapons, missing / unavailable rounds). Comparison is **byte-identical
JSON**, with no tolerance and no reordering.

| Run | Analysis cases | Weapon cases | Fail | Numeric values compared |
|---|---|---|---|---|
| CI (every `npm test`) | 365 | 42 | **0** | ≈ 311 000 |
| Full (`STATIC_PARITY_LEVEL=full`) | 1 301 | 100 | **0** | ≈ 2 180 000 |

Cases:
- every single filter value;
- greedy all-pairs over period × member × map × agent × role × mode × form;
- representative 3-way combinations;
- custom dates: full range, one day, from-only, to-only, empty future range, reversed range;
- recent 10 / 30 and every Act;
- Synergy map × mode × Act / dates;
- the improvement index per member;
- weapons member × scope (all / current / each Act / unobserved Act) × map × agent × mode.

The request mapping `analysisRequestOf` is also proven equal to the route parser for every case. All metrics the
UI renders are inside these payloads, so **METRIC_PARITY = PASS**.

### 10.6 Size, transfer and performance (synthetic, 9 members, real PostgreSQL 16)

| | 840 matches | 10 000 matches |
|---|---|---|
| Export, `common` tier, default 55 s statement timeout | 6.5 s | 139 s |
| Snapshot raw / gzip | 9.3 MB / 0.70 MB | 74.0 MB / 4.9 MB |
| — facts | 3.6 MB / 0.22 MB | 42.1 MB / 2.5 MB |
| — history pages | 1.6 MB | 27.7 MB |
| — first-paint summaries (14 files) | 3.2 MB | 3.3 MB |
| Largest file | 851 KB (dataset.json) | 888 KB (skeletons) |
| Dashboard first load (transfer) | not measured separately (same 5 files; dataset.json is the same 851 KB) | 131 KB (1.6 MB decoded), no facts |
| Profile first load (incremental, gz) | 93 KB | 549 KB |
| Multi-filter query, current × map × role (incremental, gz) | 138 KB | 264 KB |
| Multi-filter query over all history (incremental, gz) | 178 KB | 2.07 MB (every match chunk) |
| Custom 3-month range (incremental, gz) | 138 KB | 264 KB |
| History "load more" page (gz) | ≈ 11 KB | 11.7 KB |
| Unchanged snapshot reload | manifest revalidation only (322 B observed) | same |
| Engine latency p50 / p95, Node / V8 | 0.9 ms / 64 ms | 8.7 ms / 473 ms |
| Browser end to end (desktop, real UI) | every path < 0.5 s | typical 23–501 ms |
| Worst query | 688 ms (all-history Synergy, custom dates) | 6.6 s in the browser / 7.2 s in V8 (all-history Synergy, custom dates) |
| Main thread during the worst query | — | max timer lag 15 ms, no long task > 200 ms (Web Worker) |
| Peak fact bytes loaded (all facts, after lifetime and weapon queries) | 3.6 MB | 42.1 MB raw; worker heap ≈ 190 MB (V8 measurement) |

**The worst case is inherited, not introduced.**
- Profiling shows ≈ 7.0 of 7.3 s in the shared `aggregateAdvancedMetrics` scoring code, called by duo-synergy-v1 over
  36 pairs × paired / baseline windows.
- The server runs the identical code (production Synergy at 10k was measured at ≈ 6.3 s).
- Static mode keeps the UI responsive (worker) and precomputes the default Synergy views.
- Speeding up the shared aggregation is a separate scoring-performance task (TASK-SYNERGY-SCALING-01).

**Duplication.** History pages (27.7 MB at 10k) duplicate the match facts; serving history from facts is a possible
later optimization. Score traces exist only in the 14 first-paint files: 1.5 MB, against 10.4 MB (core) and
41.6 MB (extended) in the old catalog, an 86–96 % reduction.

### 10.7 Weapon analytics decision

The expensive `weaponAnalytics.ts` aggregate (`active_players → vis → collided` + GROUPING SETS, 45–85 s per request
at 10k) is **no longer needed per request** in the static architecture:
- one bounded `weaponFactsSql` statement per member exports the participations;
- the browser aggregates them with the engine's existing SQL mirror.

The 10k export completes in 118–139 s under the default timeout. **WEAPON_SQL_SCALING_BLOCKER_FOR_STATIC =
REMOVED_BY_ARCHITECTURE.** The live API path still uses the slow SQL; scaling it is a separate task only if the API
stays in use (TASK-WEAPON-ANALYTICS-SCALING-01).

### 10.8 Growth with the hybrid model

| Basis (compressed) | Per publish | 4 publishes/day: 30 days / 1 year |
|---|---|---|
| Current scale (840) | 0.70 MB | 84 MB / 1.0 GB |
| 10 000 matches | 4.9 MB | 588 MB / 7.2 GB (raw upper bound, no deduplication) |

Because match chunks are ordered by time, old chunks stay byte-identical between snapshots (only the newest chunk,
the skeletons and meta change), so Git deduplicates most fact blobs.

Retention stays bounded without assuming force-push (§9, revised). A future publisher keeps only the current
version plus N rollback versions in the published tree, using one of:
- generated branch replacement with an explicit lease;
- an orphan deployment branch;
- API-managed file replacement.

This is to be decided when the publisher is authorized.

## 11. Publication channel — TASK-INFRA-STATIC-PUBLICATION-CHANNEL-01 (synthetic data only)

**Channel:** a separate public data repository,
[`scottpuppylu/valorant-squad-analytics-data`](https://github.com/scottpuppylu/valorant-squad-analytics-data), served
by GitHub Pages from `main` / `/` (classic branch build) at
`https://scottpuppylu.github.io/valorant-squad-analytics-data/`.
- It is on the same `github.io` host as the app, so there is no CORS issue (Pages sends
  `Access-Control-Allow-Origin: *` anyway).
- The source repository and its Pages workflow are untouched.

**Content model:** `manifest.json`, `versions/<id>/…`, `README.md` (derived public data, not the source of truth,
generated, may be compacted), `.nojekyll`, `.gitattributes` (`* -text`, so files stay byte-exact).

### 11.1 Publisher (`server/staticPublish/gitDataRepositoryPublisher.ts`)

`GitHubDataRepositoryPublisher` implements `SnapshotPublisher`. It is pure transport; a guard enforces no
database, analytics or exporter imports.

1. Verify the local version (`integrity.json`).
2. Sync the disposable work clone to the remote head; that head is the **lease**.
3. Commit and push the immutable version.
4. Read every blob back from the pushed commit and SHA-256-verify it.
5. Commit and push `manifest.json` **last**.
6. Optional retention commit, only after step 5.

- **Lease semantics without force:** every push is a plain fast-forward from the verified head. A concurrent
  publisher makes it fail (test-proven), and nothing is ever force-pushed.
- `activate(<id>)`: rollback or roll-forward by moving the manifest only. The target version is re-verified first.
- `removeInactiveVersion(<id>)`: cleans up a never-activated upload. It refuses any snapshot that was ever active.
- **Audit:** every publish / activate writes `.local/publication-audit/*.json` (snapshot id, schema and fact
  versions, files, bytes, integrity root, privacy gate, previous and new manifest, version / manifest / retention
  commit SHAs, start, end, result, error).
- **Authentication:** the existing GitHub CLI session through a credential helper set on the work clone only
  (`credential.helper = ''` then `!gh auth git-credential`). No token is created, stored, printed or committed.
- **Commit identity:** a neutral `valorant-squad-analytics-publisher <publisher@valorant-squad-analytics.invalid>`,
  so no personal email lands in the public repository.
- **CLI:** `npm run data:publish:github -- --version <dir> [--keep N] | --activate <id> | --remove-inactive <id>`.
  It refuses the source repository as a target.
- **Windows finalize:** the exporter / local publisher renames retry a transient `EPERM` / `EACCES` / `EBUSY`
  (bounded, 10 attempts). A real `EPERM` on a just-written directory under Documents was hit during this task.

### 11.2 Real-Internet evidence (2026-10-07, synthetic snapshots)

| Test | Result |
|---|---|
| Independent privacy scan before publishing | PASS. UUIDs are only fixture-public kinds (member / account and match ids); 0 64-hex tokens outside `integrity.json`; no PUUID / HMAC / secret / credential strings; weapon ids are synthetic content ids |
| A published (`s-ca1b8b3e…`, 26 files, 4.17 MB) | PASS. 26/26 files SHA-256-verified over HTTPS from Pages |
| Remote frontend on A (app served locally, data from Pages): dashboard, profile + progress, history + load more, map, agent, weapon, Synergy, multi-filter, custom date, custom-date Synergy, form, weapon combination | 13/13 PASS. App server: 0 `/api` requests and 0 data served locally; the only runtime data host in the bundle is the data Pages URL; no provider host in the bundle |
| A → B (`s-8338f7b4…`): version commit, verify, then manifest commit | PASS. After a reload the browser read only B's files and showed B |
| Incomplete C: 14 of 27 files pushed, manifest untouched | PASS. Partial C was publicly served (200 after 44 s) while the browser stayed on B. The publisher refused to activate or publish over the incomplete C, then removed it (manifest unchanged) |
| Rollback B → A → B (manifest-only commits) | PASS. The browser showed A, then B |
| Manifest propagation (push to the plain URL serving the new id) | 32 s (A), 32 s (B), 55 s (rollback A), 23 s (B). Edges briefly disagree (eventual consistency); every answer is a complete version |

**Cache:** GitHub Pages sends `Cache-Control: max-age=600`, an ETag and `Last-Modified` for every file.
- **Manifest:** the client always fetches it with `cache: 'no-cache'`, so a refresh conditionally revalidates
  (`304`, 0 body bytes, about 400 B of headers) and discovers a new id as soon as the CDN serves it.
- **Version files:** never change content, so the 600 s browser cache (then a `304`) is always correct.

### 11.3 Retention and growth (measured)

After 8 commits (A, B, partial C, its removal, two activations) the whole history packs to **364.6 KiB**, while the
working tree is 8.3 MB (two 4.17 MB versions). Near-identical snapshots share most blobs and delta-compress, so
ordinary publications use normal commits.

- **Working set:** current + 3 rollback versions (`--keep 4`), pruned only after the new manifest is pushed.
- **Compaction (not needed now):** a future maintenance operation, run only when a measured threshold is crossed,
  under SDD's conditional force-with-lease authorization for the data repository only.
  - Proposed threshold: packed history larger than 20 × the packed working set, or 500 MB, whichever is smaller.
    Calibrate it with real-data deltas first.
  - Procedure: verify the remote head, build an orphan commit holding exactly the verified working set,
    `push --force-with-lease=main:<verified head>`, confirm Pages serves the manifest.

**Status:** awaiting SDD review. No real data has been published.
