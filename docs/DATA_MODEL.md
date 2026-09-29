# Data model

TASK-001 uses a deterministic fictional dataset. It contains no private player identifiers, Riot API data, or third-party match data.

## Entities

### `Player`

Stable profile metadata stored in `src/data/players.ts`:

- `id`: internal stable key used by routes and joins
- `handle` and `displayName`: fictional display labels
- `role`: Duelist, Initiator, Controller, or Sentinel
- `agents`: the fictional player's demonstrated agent pool
- `accent`, `tagline`, and `playstyle`: presentation metadata

### `MatchRecord`

One row per fictional squad match in `src/data/demoMatches.ts`:

- stable match ID and ISO timestamp
- map and fictional opponent
- squad and opponent round scores
- win/loss state and duration
- five `MatchPerformance` rows, one for each squad member in the lineup

The fixture produces 32 unique matches. Five of eight players participate in each match, giving every player 20 appearances. The match generator is deterministic so tests and screenshots are reproducible.

### `MatchPerformance`

The raw player-match grain. Required fields are kills, deaths, assists, ACS, ADR, KAST, agent, and player ID. HS%, first kills, first deaths, clutch attempts, and clutch wins are optional to exercise missing-data behavior.

### `RawPlayerStats`

`src/utils/aggregateStats.ts` aggregates player-match rows. Totals are additive. ACS, ADR, and KAST are round-weighted averages. HS% is kill-weighted when present. Ratios use safe division and return a finite fallback when the denominator is zero.

### `PlayerScores`

`src/scoring/` converts aggregated statistics into the initial 0–100 Firepower, Entry, Teamplay, Clutch, and Consistency categories. Overall is a weighted combination of those categories. Confidence is stored alongside the scores but is never included in Overall.

## Data flow

```text
fictional player metadata + 32 fictional matches
  -> aggregatePlayerStats
  -> role-aware normalization
  -> category scores
  -> overall score + separate confidence
  -> dashboard, leaderboard, and profile UI
```

## Data-source boundary

`src/dataSources/types.ts` defines `AnalyticsDataSource` and `NormalizedAnalyticsDataset`. `DemoDataSource` currently provides the deterministic local fixtures. `RiotDataSource` is a deliberately non-operational future adapter boundary; it contains no HTTP client or credential handling.

Future official data follows this flow:

```text
Riot API DTO -> server-side Riot adapter -> normalized internal model
  -> aggregation -> derived metrics -> scoring -> UI
```

Scoring and React components must not import Riot DTOs directly. See `docs/RIOT_API_CAPABILITY.md`.

## Browser-local emoji identity

Every `Player` has a required `defaultEmoji`. `AvatarRepository` stores only an optional allow-listed emoji override keyed by internal player ID. `BrowserAvatarRepository` serializes the versioned override map under `valorant-squad-analytics:emoji-avatars:v1` in localStorage. The setting is local to one browser profile and is not part of the analytics dataset, Git repository or GitHub Pages deployment.

Resolution order is browser override, then the player's committed default emoji. The previous uploaded-image blob path is no longer read. Legacy IndexedDB records are left untouched rather than deleted automatically.

Malformed JSON, an unknown storage version, or a record with an emoji outside the allow-list is ignored and resolves to the player's default emoji. Selecting the default emoji or pressing `重設頭像` removes that player's override from the versioned map. Legacy image-avatar IndexedDB data is safely retired: active application code neither reads nor writes it, and automatic destructive deletion is intentionally avoided.

## Third-party spike boundary

`src/dataSources/thirdParty/henrikV4.ts` validates and summarizes provider-shaped v4 match envelopes without importing them into scoring or React components. `scripts/probe-henrik-api.mjs` is a dormant local diagnostic scaffold for the future TASK-API-01. It is not required by the application and was not used for real-account or real-match validation. The deployed application does not call the provider.

## Missing data

- Optional statistics remain `undefined`; they are not silently converted to observed zero.
- A category renormalizes its available weights when one optional input is missing.
- A category with no usable inputs returns the documented neutral fallback of 50.
- A zero denominator returns a finite fallback rather than `Infinity` or `NaN`.

## Future-compatible fields

Economy, utility, trade, impact, and synergy evidence are deliberately absent from TASK-001 because the fixture does not support them. Later tasks can add new raw fields and derived modules without placing calculation logic in React components.
