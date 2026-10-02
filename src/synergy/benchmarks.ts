export const SYNERGY_RULE_VERSION = 'duo-synergy-v1';
export const SYNERGY_BENCHMARK_VERSION = 'duo-synergy-benchmarks-v1';
export const synergyPriorStrength = 8;
export const synergyCoverageGate = .75;
/** Product-design ranges, not population percentiles. */
export const synergyBenchmarks = {
  overall: { weight: .60, range: 8 },
  kast: { weight: .25, range: .05 },
  winRate: { weight: .15, range: .15 },
} as const;
