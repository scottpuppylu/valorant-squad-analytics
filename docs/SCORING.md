# Initial scoring model

This is a transparent community performance model for a fictional friend-group dataset. It is not Riot MMR, Elo, an official rank, or a replacement for VALORANT's ranked system.

TASK-001 implements five initial categories plus Overall. The complete eight-dimension engine, adjustable settings, economy, trades, utility, synergy, and advanced role value remain roadmap work.

## Shared rules

All scores are deterministic and clamped to the inclusive range 0–100.

For a metric value `x` with role-specific lower bound `L` and target `T`:

```text
normalized(x) = clamp(100 * (x - L) / (T - L), 0, 100)
```

Role-specific ranges live in `src/scoring/benchmarks.ts`. They prevent identical raw fragging values from being treated as equally expected for every role. These are transparent prototype ranges, not population claims.

When an optional metric is missing, its weight is removed and the remaining available weights are renormalized. If an entire category has no usable input, its neutral fallback is 50.

## Derived raw rates

```text
K/D = kills / deaths
KPR = kills / rounds
APR = assists / rounds
KAST = round-weighted mean of player-match KAST
FK/FD = first kills / max(first deaths, 1)
First kills per round = first kills / rounds
Win rate = wins / matches
Clutch conversion = clutch wins / clutch attempts
Clutch wins per match = clutch wins / matches
```

Zero denominators return finite fallbacks. Optional rates remain unavailable if their underlying counts are unavailable.

## Category formulas

### Firepower

```text
35% role-normalized ACS
30% role-normalized ADR
20% role-normalized KPR
15% role-normalized K/D
```

### Entry

```text
45% role-normalized first kills per round
35% role-normalized FK/FD
20% role-normalized KPR
```

This initial entry score uses opening-kill evidence only. It does not yet claim trade quality or space-created value.

### Teamplay

```text
40% role-normalized KAST
35% role-normalized APR
25% role-normalized win rate
```

This is a first proxy for reliable team contribution. Utility, flash assists, trades, and survival context require future raw fields.

### Clutch

```text
75% normalized clutch conversion, range 8% to 58%
25% normalized clutch wins per match, range 0.03 to 0.50
```

If clutch attempts are unavailable, the available component is used. With no usable clutch evidence, the category returns 50.

### Consistency

Consistency uses player-match ACS and KAST dispersion:

```text
ACS coefficient of variation = population_stdev(ACS) / mean(ACS)
KAST deviation = population_stdev(KAST)

Consistency = clamp(
  100 - 180 * ACS coefficient of variation - 320 * KAST deviation,
  0,
  100
)
```

A single observation has zero measured dispersion, but low sample size remains visible through Confidence.

### Overall

```text
26% Firepower
16% Entry
22% Teamplay
14% Clutch
22% Consistency
```

Overall weights live in `src/scoring/weights.ts`, separate from normalization and UI code.

## Confidence

Confidence is descriptive sample-size context and never changes any performance score:

```text
Confidence = clamp(100 * sqrt(matches / 30), 0, 100)
```

Thirty matches reaches 100% under this initial rule. TASK-001's demo players each have 20 appearances.

## Limitations

- Benchmarks are prototype design values, not official or global population percentiles.
- Benchmarks are not yet versioned against a calibration dataset.
- Match outcomes and player statistics are fictional and deterministic.
- An entirely unavailable category currently receives the numeric fallback 50, which cannot be distinguished from genuinely measured neutral performance.
- Optional first-kill/death and clutch observations can be summed across only available matches while current rate denominators still cover all rounds or matches.
- Aggregates are rounded before they reach the scoring engine, losing calculation precision.
- Score outputs do not yet include component-level traces or evidence coverage.
- Entry does not yet measure traded deaths or space creation.
- Teamplay does not yet measure utility timing, flash assists, or trade participation, and Win Rate currently carries 25% of its weight.
- Clutch treats attempts equally, applies no small-sample shrinkage, and does not yet adjust for 1v2, 1v3, or economy state.
- One observation has zero measured dispersion and can therefore produce a perfect Consistency score.
- Economy, round impact, role value, trade, utility, and synergy scoring are deferred to later tasks.

TASK-002B owns corrections to these issues. TASK-002A documents current prototype behavior without silently changing the ranking model.
