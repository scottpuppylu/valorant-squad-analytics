import type { PlayerRole } from '../types/valorant';

export type ScoredMetric =
  | 'acs'
  | 'adr'
  | 'kd'
  | 'kpr'
  | 'apr'
  | 'kast'
  | 'firstKillsPerRound'
  | 'fkFd'
  | 'winRate';

type MetricRange = readonly [minimum: number, target: number];

export const roleBenchmarks: Record<PlayerRole, Record<ScoredMetric, MetricRange>> = {
  Duelist: {
    acs: [175, 275],
    adr: [120, 175],
    kd: [0.78, 1.35],
    kpr: [0.58, 0.9],
    apr: [0.12, 0.32],
    kast: [0.64, 0.8],
    firstKillsPerRound: [0.08, 0.2],
    fkFd: [0.65, 1.7],
    winRate: [0.35, 0.72],
  },
  Initiator: {
    acs: [160, 235],
    adr: [112, 152],
    kd: [0.76, 1.22],
    kpr: [0.52, 0.76],
    apr: [0.24, 0.5],
    kast: [0.67, 0.83],
    firstKillsPerRound: [0.05, 0.14],
    fkFd: [0.65, 1.6],
    winRate: [0.35, 0.72],
  },
  Controller: {
    acs: [150, 220],
    adr: [108, 146],
    kd: [0.76, 1.22],
    kpr: [0.5, 0.72],
    apr: [0.23, 0.48],
    kast: [0.69, 0.85],
    firstKillsPerRound: [0.035, 0.11],
    fkFd: [0.65, 1.55],
    winRate: [0.35, 0.72],
  },
  Sentinel: {
    acs: [155, 225],
    adr: [110, 150],
    kd: [0.8, 1.3],
    kpr: [0.52, 0.75],
    apr: [0.14, 0.36],
    kast: [0.69, 0.85],
    firstKillsPerRound: [0.035, 0.12],
    fkFd: [0.7, 1.65],
    winRate: [0.35, 0.72],
  },
};
