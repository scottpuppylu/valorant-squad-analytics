import type { Dimension } from './versions.js';
import type { ComponentMetric } from './benchmarks.js';
import type { PlayerRole } from '../types/valorant.js';
export type MetricWeight = readonly [ComponentMetric, number];
export const categoryMetricWeights: Record<Exclude<Dimension,'roleValue'>, readonly MetricWeight[]> = {
  firepower:[['acs',.35],['adr',.30],['kpr',.20],['kd',.15]],
  roundImpact:[['disadvantage',.25],['tradeKills',.20],['clutchState',.20],['multiKill',.20],['wonKills',.15]],
  entry:[['firstKillsPerRound',.45],['fdpr',.35],['kpr',.20]],
  teamplay:[['kast',.35],['apr',.25],['tradeAssists',.20],['tradeKills',.20]],
  clutch:[['shrunkClutch',.80],['difficultWins',.20]],
  economy:[['damageEfficiency',.65],['killEfficiency',.35]],
  consistency:[['acsCv',.60],['kastSd',.40]],
};
export const roleWeights: Record<PlayerRole, readonly MetricWeight[]> = {
  Duelist:[['firstKillsPerRound',.30],['kpr',.25],['disadvantage',.20],['tradeKills',.15],['kast',.10]],
  Initiator:[['apr',.30],['kast',.25],['tradeAssists',.25],['tradeKills',.10],['objectives',.10]],
  Controller:[['kast',.30],['apr',.25],['tradeAssists',.20],['objectives',.15],['damageEfficiency',.10]],
  Sentinel:[['kast',.30],['shrunkClutch',.20],['objectives',.20],['apr',.15],['tradeAssists',.15]],
};
