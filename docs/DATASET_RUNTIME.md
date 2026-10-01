# Durable dataset runtime

Status: **TASK-DATA-02A IMPLEMENTED — production exposure disabled by default**

## Boundary

```text
Neon durable evidence
  -> PostgresDatasetReadRepository (six set-based queries, newest 300 matches)
  -> DatasetProjectionService (`legacy-browser-projection-v1`)
  -> GET /api/valorant/dataset (schema version 1)
  -> DatasetProvider
  -> buildAnalytics(dataset)
  -> existing routes and analysis UI
```

`REAL_DATASET_READ_MODE` must equal `enabled` before the route reads Neon. Missing, misspelled or any other value returns a small `state: disabled` response with no player, match or count information. The consent-management credential is never a read credential. Enabling private REAL visibility is a separate operator decision and is not part of TASK-DATA-02A deployment.

GitHub Pages deliberately uses `DemoDataSource` without calling `/api`. Vercel in disabled mode also deliberately uses Demo. Demo and REAL are never merged. An initial API error remains an explicit REAL-server error; a refresh error retains the last successful REAL snapshot as `stale`.

## Active visibility

An exposed player must be non-anonymized and have both an active consent and active squad membership. A match enters the bounded window only when at least one such player participated. Browser performances include only active consenting squad players. The projection may use anonymous event topology server-side to reconstruct a consenting player's KAST/opening events, but it does not return non-consenting participant rows, team topology, provider identifiers or event rows.

The response excludes PUUIDs, provider match IDs, lookup HMACs, database internal UUIDs, consent-management material and round/kill/assistant/economy/location detail. Player IDs and migration `0004` match `public_id` values are independent public application IDs.

## Contract

The successful versioned response contains:

- `schemaVersion: 1`;
- `state: ready | empty`;
- opaque content-derived `snapshot.version`;
- `snapshot.generation: dataset-read-v1`;
- `snapshot.source: durable-neon`;
- `snapshot.projectionVersion: legacy-browser-projection-v1`;
- bounded coverage metadata with `lifetimeComplete: false`;
- explicit compatibility-metric evidence availability;
- one normalized `mode: REAL`, `isDemo: false` dataset.

The snapshot version hashes only browser-visible dataset, coverage and evidence content. It changes when that projected content changes and does not expose a database timestamp or internal ID. The window is the most recent 300 durable matches across currently visible members. It is an operational bound, not a lifetime-history claim.

## Compatibility projection

- `ACS = match participant score / observed durable rounds`
- `ADR = damage dealt / observed durable rounds`
- `HS% = headshots / (headshots + bodyshots + legshots)`; zero observed hits returns zero
- KAST counts a round when the player killed, assisted, survived, or was traded
- a traded death means a teammate killed the original killer in the same round within 5,000 ms after the death
- FK/FD uses the earliest event by round time, then durable event sequence for deterministic ties

KAST/FK/FD are marked `partial` when complete round presence evidence is not available. No Trade, Clutch, Economy, Impact or Role Value scoring engine is introduced here.

## React states

`DatasetProvider` owns `loading`, `ready`, `stale`, `empty`, `error` and `demo`. Analytics routes receive a dedicated loading/error/empty boundary. Player default and invalid routes do not assume a non-empty dataset. `src/data/analytics.ts` is a pure `buildAnalytics(dataset)` function and no longer selects a dataset at module load.

The retired key `goblin-survey:real-dataset:v1` is removed when the provider starts. Server-read REAL data is never written to localStorage. `BrowserRealDatasetRepository` remains only as legacy cleanup/test/rollback code; emoji overrides and the separate consent-management/deletion credential lifecycle are unchanged.

## Performance evidence

Disposable PGlite fixtures exercise the same repository and projection service:

| Fixture | SQL | DB time | Projection | Serialized response |
|---|---:|---:|---:|---:|
| 1 player / 30 matches | 6 | 21.80 ms | 1.80 ms | 13,234 bytes |
| 4 players / 300 matches | 6 | 192.40 ms | 7.03 ms | 292,133 bytes |

Times are one local test-run observation, not a Neon latency promise. The constant six-query plan avoids per-player and per-match N+1 reads.

## Deferred DATA-02B

TASK-DATA-02B may decide authorization/distribution policy, cache/revalidation policy, private squad selection and deliberate REAL production enablement. It must not silently enable `REAL_DATASET_READ_MODE`, reconnect the deleted production subject, or begin TASK-METRICS-01/TASK-002B/Synergy.
