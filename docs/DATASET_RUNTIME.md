# Durable dataset runtime

Status: **TASK-DATA-02 COMPLETE — SDD STRICT**

## Boundary

```text
Neon durable evidence
  -> PostgresDatasetReadRepository (six set-based queries, newest 300 matches)
  -> EventMetricEngine (`event-metrics-v1`)
  -> DatasetProjectionService (`event-metrics-projection-v1`)
  -> GET /api/valorant/dataset (schema version 2)
  -> DatasetProvider
  -> buildAnalytics(dataset)
  -> existing routes and analysis UI
```

`REAL_DATASET_READ_MODE` must equal the exact value `public` before the route reads Neon. Missing, `enabled`, `true`, `1`, misspelled or any other value returns a small `state: disabled` response with no player, match or count information. Public visitors need no login, cookie, Authorization header, access code or consent-management credential. That credential remains destructive management authority only.

Vercel is the canonical PUBLIC REAL runtime. GitHub Pages deliberately uses `DemoDataSource` without calling production `/api`. Demo and REAL are never merged. An initial API error remains an explicit REAL-server error; a refresh error retains the last successful REAL snapshot as `stale`.

## Active visibility

An exposed player must be non-anonymized, have active squad membership, and have exactly one active consent whose method is `self_asserted` and whose version equals `2026-10-02-public-v1`. A match enters the bounded window only when at least one such player participated. Browser performances include only those current-policy players. An obsolete-policy player and a match visible solely through that player are omitted. The projection uses full anonymous participant/team/round/event topology server-side to reconstruct a consenting player's metrics, but it does not return non-consenting participant rows, team topology, provider identifiers, event rows, coordinates or calculation traces.

The response excludes PUUIDs, provider match IDs, lookup HMACs, database internal UUIDs, consent-management material and round/kill/assistant/economy/location detail. Player IDs and migration `0004` match `public_id` values are independent public application IDs.

## Contract

The successful versioned response contains:

- `schemaVersion: 2`;
- `state: ready | empty`;
- opaque content-derived `snapshot.version`;
- `snapshot.generation: dataset-read-v2`;
- `snapshot.source: durable-neon`;
- `snapshot.projectionVersion: event-metrics-projection-v1`;
- bounded coverage metadata with `lifetimeComplete: false`;
- explicit compatibility and advanced-metric evidence availability;
- one normalized `mode: REAL`, `isDemo: false` dataset.

The snapshot version hashes only browser-visible dataset, coverage and evidence content. It changes when that projected content changes and does not expose a database timestamp or internal ID. The window is the most recent 300 durable matches across currently visible members. It is an operational bound, not a lifetime-history claim.

The REAL response is `Cache-Control: no-store`. Revocation therefore takes effect on the next server request without a configured browser/CDN TTL. The React provider performs an initial load and explicit refresh; route reloads create a new load. It does not poll and does not persist a full REAL dataset in localStorage. An already-open page may retain the last in-memory snapshot until refresh/reload.

## Versioned metric projection

- A browser `MatchPerformance` is emitted only when match-level stats evidence is `observed`, the agent and K/D/A/score/damage fields are observed finite numbers, at least one durable round exists, and the player has round-presence evidence for every durable round in the match.
- Missing core or round evidence omits the performance instead of manufacturing numeric zero. A match with no usable visible performance is also omitted; active player profiles may remain visible independently.
- `ACS = match participant score / observed durable rounds`
- `ADR = damage dealt / observed durable rounds`
- `HS% = headshots / (headshots + bodyshots + legshots)` only when all three persisted shot counts are observed; an incomplete tuple omits optional HS% and marks its dataset evidence `partial`
- a completely observed shot tuple whose total is zero produces the legitimate measured value `HS% = 0`
- KAST counts a round when the player killed, assisted, survived, or was traded under `event-metrics-v1`
- a traded death means a teammate killed the original killer in the same round within 5,000 ms after the death; a single retaliation event is counted once even if it trades multiple deaths
- FK/FD uses the earliest event by round time, then durable event sequence for deterministic ties
- Trade, 1v1–1v5 clutch, objective, ability-cast, economy-efficiency and kill-context aggregates carry explicit `reconstructed`, `derived`, `partial` or `unavailable` status

KAST/FK/FD are marked `partial` when any eligible candidate lacks complete round-presence evidence, including when that candidate is omitted and another member keeps the shared match visible. Observed numeric zeros remain zeros: zero kills, assists, score, damage, shots, FK, FD or a completely reconstructed zero KAST are not treated as missing. Compact zero-valued advanced objects may be omitted only when their evidence status establishes a measured zero. Missing evidence never becomes zero. Full semantics are in `METRICS_RECONSTRUCTION.md`.

Because the snapshot hashes the browser-visible dataset and evidence availability, omitting an unusable performance or match changes `snapshot.version`. TASK-METRICS-01 upgrades the response to schema version 2 and adds evidence-only migration `0006`; it does not alter the existing scoring formulas.

## React states

`DatasetProvider` owns `loading`, `ready`, `stale`, `empty`, `error` and `demo`. Analytics routes receive a dedicated loading/error/empty boundary. Player default and invalid routes do not assume a non-empty dataset. `src/data/analytics.ts` is a pure `buildAnalytics(dataset)` function and no longer selects a dataset at module load.

The retired key `goblin-survey:real-dataset:v1` is removed when the provider starts. Server-read REAL data is never written to localStorage. `BrowserRealDatasetRepository` remains only as legacy cleanup/test/rollback code; emoji overrides and the separate consent-management/deletion credential lifecycle are unchanged.

## Performance evidence

Disposable PGlite fixtures exercise the same repository and projection service:

| Fixture | SQL | DB time | Metric reconstruction | Projection total | Serialized response | Evidence rows |
|---|---:|---:|---:|---:|---:|---|
| 1 player / 30 matches | 6 | 23.73 ms | 1.36 ms | 3.90 ms | 24,033 bytes | 30 rounds / 60 presences / 30 events |
| 4 players / 300 matches | 6 | 147.17 ms | 14.05 ms | 31.11 ms | 692,632 bytes | 300 rounds / 1,500 presences / 300 events |

Times are one local test-run observation, not a Neon latency promise. Compared with the TASK-DATA-02 baseline, the serialized fixtures grew from 13,234 to 24,033 bytes (+10,799; +81.6%) and from 292,133 to 692,632 bytes (+400,499; +137.1%) because each consenting player-match now carries compact versioned aggregate evidence. Raw events still never enter the response. The constant six-query plan avoids per-player and per-match N+1 reads.

## Public consent policy

`shared/privacyPolicy.ts` is the single browser-safe source of truth for `PUBLIC_DATASET_PRIVACY_VERSION = 2026-10-02-public-v1`. Connection parsing requires both `consent=true` and that exact version before provider access. Explicit connection may transactionally replace an older active consent; import, sync, retries and dataset reads may not upgrade policy. Migration `0005` enforces one active consent per player across versions.

## Production state

The former test player was deleted by DATA-01C and was not reconnected. Public mode therefore validly returns `state=empty`, `dataset.mode=REAL`, `dataset.isDemo=false`, zero players and zero matches. The non-empty public production advanced-metric path is **NOT VERIFIED AFTER DATA-01C DELETION**; current-policy non-empty projection is covered by disposable database tests.

## Evidence-aware scoring runtime (TASK-002B)

METRICS-01 supplies event-metrics-v1 aggregate evidence; community-score-v2 computes frontend-only ScoreResult values, independent confidence and aggregate-only traces. Benchmark/profile versions are community-benchmarks-v1 and overall-profile-v1. No score persistence or migration; public server response remains unchanged and bounded. Current full 4-player/300-match fixture remains 680,332 bytes with six SQL queries. GitHub Pages uses deterministic fictional advanced evidence. Vercel keeps PUBLIC REAL with no Demo fallback for read errors/empty data; only the local Vite development runtime explicitly uses Demo. Non-empty production scoring NOT YET EXERCISED; no deleted player was reconnected. See SCORING.md for exact missing/partial/Overall gates.
