/**
 * improvement-benchmarks-v1 — PRODUCT-DESIGN CALIBRATION, not population percentiles.
 * Every constant is documented in docs/PROGRESS_INDEX.md and boundary-tested.
 */
export const IMPROVEMENT_INDEX_VERSION = 'improvement-index-v1' as const;
export const IMPROVEMENT_BENCHMARK_VERSION = 'improvement-benchmarks-v1' as const;

export const improvementBenchmarks = {
  /** Demonstrated performance change (Overall points) that maps to ±100. */
  performanceRange: 5,
  /** Shrink strength in effective rounds: shrink = rEff / (rEff + K), rEff = rCur·rBase/(rCur+rBase). */
  shrinkRounds: 100,
  /** |value| below this is "stable / no demonstrated change". */
  stableBand: 10,
  /** Minimum profile weight of dimensions numeric in BOTH windows for a numeric delta. */
  minDimensionCoverage: 0.25,
  /** Coverage at/above which the dimension overlap counts as complete for status/confidence. */
  fullDimensionCoverage: 0.75,
  /** Share of leave-one-match-out runs that must be scoreable to assess trend stability. */
  minJackknifeShare: 0.8,
  /** Sample confidence saturates at this many rounds in each window. */
  confidenceRounds: 200,
  /** Comparability multipliers by Act policy. */
  comparability: { same_act: 1, act_unknown: 0.85, previous_act_fallback: 0.7 } as const,
  /** Overall confidence below this keeps a numeric result `partial`. */
  availableConfidence: 0.5,
  /** Future rank component (TASK-DATA-RANK-01): weight when real rank evidence exists, tier range for ±1. */
  rank: { weight: 0.25, tierRange: 3 },
} as const;
