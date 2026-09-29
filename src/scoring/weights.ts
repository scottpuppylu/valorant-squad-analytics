import type { ScoredMetric } from './benchmarks';

export interface MetricWeight {
  metric: ScoredMetric;
  weight: number;
}

export const categoryMetricWeights = {
  firepower: [
    { metric: 'acs', weight: 0.35 },
    { metric: 'adr', weight: 0.3 },
    { metric: 'kpr', weight: 0.2 },
    { metric: 'kd', weight: 0.15 },
  ],
  entry: [
    { metric: 'firstKillsPerRound', weight: 0.45 },
    { metric: 'fkFd', weight: 0.35 },
    { metric: 'kpr', weight: 0.2 },
  ],
  teamplay: [
    { metric: 'kast', weight: 0.4 },
    { metric: 'apr', weight: 0.35 },
    { metric: 'winRate', weight: 0.25 },
  ],
} satisfies Record<string, MetricWeight[]>;

export const overallWeights = {
  firepower: 0.26,
  entry: 0.16,
  teamplay: 0.22,
  clutch: 0.14,
  consistency: 0.22,
} as const;
