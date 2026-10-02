# Versioned metric reconstruction

Status: **IMPLEMENTED; PRODUCTION VALIDATION PENDING — SDD STRICT**

`event-metrics-v1` reconstructs evidence at player-match grain. It does not create a new Overall formula, an Impact Score, an Economy Score, a Role Value Score, MMR or Elo. Provider schema (`HenrikDev v4`), durable normalization (`durable-evidence-v2`), public projection (`event-metrics-projection-v1`) and future scoring versions are separate contracts.

## Evidence status

- `reconstructed`: complete ordered/topological evidence satisfies the documented event rule.
- `derived`: deterministic arithmetic or direct retained match evidence satisfies the documented rule.
- `partial`: some evidence exists, but a complete value cannot be claimed. A partial metric may retain a specifically reconstructable component, such as a clutch attempt with an unknown round winner.
- `unavailable`: the required evidence was not observed or the denominator is invalid.

Missing evidence never becomes a measured zero. In the compact public payload, zero-valued count objects can be omitted only when the domain's evidence status is `reconstructed` or `derived`; consumers must inspect `evidence` before interpreting omission as zero. `coverage` reports eligible, reconstructed and omitted rounds once per player-match payload. Internal calculation traces retain only rule branches, round number, event sequence, counts and safe reasons—never internal UUIDs, HMACs, PUUIDs, provider match IDs, raw timelines or coordinates.

## Trade

The trade window is exactly 5,000 milliseconds. If V dies to K at time T, V's death is traded when V's teammate kills K in the same round at `T <= kill time <= T + 5000`. Events sort by `time_in_round_ms`, then `event_sequence`; at an equal millisecond the retaliation must not precede the death's sequence.

A death is traded at most once. The earliest qualifying retaliation wins. One physical retaliation event counts as one Trade Kill even if it trades multiple teammate deaths; each qualifying death independently counts as a Traded Death. A Trade Assist requires an assistant on that already-classified Trade Kill who is on the trader's team, counted at most once per assistant/event.

Outputs: Trade Kills, Traded Deaths, Trade Assists, deaths eligible for trade and unique trade-kill events. No Trade Score exists.

## KAST and opening events

For each reconstructable eligible round:

- K: at least one kill;
- A: appears in at least one kill's assistant list;
- S: no death event;
- T: death classified as traded by the v1 trade rule.

`KAST = qualified eligible rounds / reconstructed eligible rounds`. Opening Kill/Death uses the first ordered kill in each round with the same time/sequence tie-break. Incomplete collection or round-presence evidence returns partial/unavailable without a numeric substitute. Complete fixtures retain parity with the former compatibility implementation; the public projection now uses this engine as the single production implementation.

## Clutch

Each reconstructable round starts with the observed round-presence participants alive. Ordered kills remove victims. Unknown victims, impossible duplicate deaths, dead killers or missing participant topology make the round non-reconstructable.

A player's attempt begins the first time, after processing an event, that the player is alive, is the only alive member of their team, and faces 1–5 alive opponents. At most one attempt is counted per player/round and the opponent count is retained. The attempt is a win when the recorded round winner is the player's team; final-frame survival is not required. Without `winning_team`, the attempt remains reconstructed but win evidence is partial and omitted.

Outputs are attempts/wins plus 1v1–1v5 breakdowns. No Clutch score or sample shrinkage is introduced here.

## Objectives and abilities

Plants and defuses count only when the respective status is `present` and its participant reference resolves. Explicit `absent` supports a measured zero; missing/unavailable evidence does not.

Match-level `ability1`, `ability2`, `grenade` and `ultimate` casts are retained as counts. Observed zero remains zero. These counts do not establish flash assists, healing, smoke, reveal, utility impact or Role Value.

## Economy

When `spent_total > 0`:

```text
damagePer1000Spent = 1000 × damage_dealt / spent_total
killsPer1000Spent  = 1000 × kills / spent_total
```

No internal rounding is applied. `spent_total = 0`, missing spend or malformed spend makes each ratio unavailable; it never produces Infinity or a fabricated zero. Loadout/spend totals and averages remain direct context. Purchase history, drops, refunds, transfers, utility-cost ledger and Eco Round Impact are **NOT IMPLEMENTED**.

## Impact context and role inputs

For each kill the engine may classify:

- opening kill;
- trade kill;
- man-disadvantage kill (killer's team had fewer alive players immediately before the kill);
- clutch-state kill (killer was their team's sole survivor immediately before the kill);
- multi-kill index within the round;
- whether the killer's team won the round.

Player-match aggregates include opening, trade, man-disadvantage, clutch-state and won-round kill counts plus multi-kill, exactly-two-kill and three-plus-kill rounds. These are transparent context components, not a validated Impact Score.

Role-value evidence availability is prepared from agent, assists, damage, objectives, trade assists, KAST/survival and direct cast counts. Utility-effect evidence remains unavailable. TASK-002B—not this task—owns role benchmarks, weights, score availability, confidence and final calculation traces.

## Persistence and backfill semantics

Migration `0006_metric_evidence_status.sql` adds only evidence-status columns. Existing ability/economy value columns are reused. `durable-evidence-v2` populates ability/economy evidence and records observed/missing/unavailable status for match rounds, match kills and round participant collections.

Existing `durable-evidence-v1` rows retain migration defaults of `missing`; they are not treated as if v2-only evidence exists. A future authorized overlap/import can update a match to v2. TASK-METRICS-01 does not force a provider re-download.

## Privacy and public contract

The server reads full anonymous participant/team/round/event topology in six bounded set-based queries. Only current-policy consenting players receive public performances. Non-consenting internal IDs, identities and raw events never serialize. Revocation removes a player from the next public response while retained anonymous shared-match topology may continue supporting another consenting player's legitimate metrics.

Public dataset schema is `2`; snapshot generation is `dataset-read-v2`; projection is `event-metrics-projection-v1`. The browser receives compact aggregate evidence only, never an event timeline. Demo may omit `advancedMetrics` and must not fabricate REAL evidence.

`aggregateAdvancedMetrics()` is a pure domain function. It sums additive counts, retains evidence coverage, and recomputes economy ratios from total damage/kills and total spend rather than averaging match ratios.

## Verification checkpoint

Starting HEAD: `6087edf00d6922d052c3871bc96af470fab4b127`, preserved as `checkpoint-before-metrics-01`. The baseline worktree was clean on `main`, tracking `origin/main`.

Baseline checks: lint passed; 16 test files / 149 tests passed in 28.44 seconds; build passed with 689 modules in 4.63 seconds; npm audit found zero vulnerabilities; database validation passed 13 tests in 16.25 seconds. Baseline public response sizes were 13,234 and 292,133 bytes for the bounded fixtures.

Implementation checks: lint passed; 17 test files / 167 tests passed in 23.91 seconds; build passed with 689 modules in 2.86 seconds; secret-boundary source and bundle scans passed; npm audit found zero vulnerabilities. Fifteen dedicated reconstruction tests cover event rules, impossible topology, incomplete evidence, zero values and aggregation. All tests use fixtures/PGlite and call neither production Henrik nor Neon.

Database validation: 1 file / 15 tests passed in 17.22 seconds. Production migration 0006, CI and deployment checks are pending. Vercel database UI currently requires operator 2FA; the CLI authorization session is pending. No production migration has been applied at this checkpoint and no player was reconnected. Non-empty production advanced-metric behavior remains **NOT VERIFIED**.
