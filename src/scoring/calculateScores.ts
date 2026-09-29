import type { MatchRecord, Player, PlayerAnalytics, PlayerScores, RawPlayerStats } from '../types/valorant';
import { aggregatePlayerStats, getRecentPerformances } from '../utils/aggregateStats';
import { clamp, round, safeDivide, standardDeviation } from '../utils/number';
import type { ScoredMetric } from './benchmarks';
import { normalizeForRole, normalizeRange, weightedAvailableScore } from './normalize';
import { categoryMetricWeights, overallWeights } from './weights';

function metricValue(stats: RawPlayerStats, metric: ScoredMetric): number | undefined {
  switch (metric) {
    case 'acs':
    case 'adr':
    case 'kd':
    case 'kpr':
    case 'apr':
    case 'kast':
      return stats[metric];
    case 'firstKillsPerRound':
      return stats.firstKills === undefined ? undefined : safeDivide(stats.firstKills, stats.rounds);
    case 'fkFd':
      return stats.fkFd;
    case 'winRate':
      return safeDivide(stats.wins, stats.matches);
  }
}

function categoryScore(
  player: Player,
  stats: RawPlayerStats,
  weights: ReadonlyArray<{ metric: ScoredMetric; weight: number }>,
): number {
  return weightedAvailableScore(
    weights.map(({ metric, weight }) => {
      const value = metricValue(stats, metric);
      return {
        weight,
        score: value === undefined ? undefined : normalizeForRole(metric, value, player.role),
      };
    }),
  );
}

export function calculateConsistencyScore(acsValues: number[], kastValues: number[]): number {
  if (acsValues.length === 0 || kastValues.length === 0) {
    return 50;
  }

  const meanAcs = acsValues.reduce((total, value) => total + value, 0) / acsValues.length;
  const acsCoefficient = safeDivide(standardDeviation(acsValues), Math.max(meanAcs, 1));
  const kastDeviation = standardDeviation(kastValues);
  return round(clamp(100 - acsCoefficient * 180 - kastDeviation * 320), 1);
}

export function calculateConfidence(matches: number): number {
  return round(clamp(Math.sqrt(Math.max(matches, 0) / 30) * 100), 1);
}

export function calculatePlayerScores(player: Player, stats: RawPlayerStats, matches: MatchRecord[]): PlayerScores {
  const playerPerformances = matches
    .flatMap((match) => match.performances)
    .filter((performance) => performance.playerId === player.id);
  const firepower = categoryScore(player, stats, categoryMetricWeights.firepower);
  const entry = categoryScore(player, stats, categoryMetricWeights.entry);
  const teamplay = categoryScore(player, stats, categoryMetricWeights.teamplay);
  const clutchRate = stats.clutchAttempts === undefined || stats.clutchAttempts === 0 || stats.clutchWins === undefined
    ? undefined
    : stats.clutchWins / stats.clutchAttempts;
  const clutchWinsPerMatch = stats.clutchWins === undefined ? undefined : safeDivide(stats.clutchWins, stats.matches);
  const clutch = weightedAvailableScore([
    { score: clutchRate === undefined ? undefined : normalizeRange(clutchRate, 0.08, 0.58), weight: 0.75 },
    { score: clutchWinsPerMatch === undefined ? undefined : normalizeRange(clutchWinsPerMatch, 0.03, 0.5), weight: 0.25 },
  ]);
  const consistency = calculateConsistencyScore(
    playerPerformances.map((performance) => performance.acs),
    playerPerformances.map((performance) => performance.kast),
  );
  const overall = weightedAvailableScore([
    { score: firepower, weight: overallWeights.firepower },
    { score: entry, weight: overallWeights.entry },
    { score: teamplay, weight: overallWeights.teamplay },
    { score: clutch, weight: overallWeights.clutch },
    { score: consistency, weight: overallWeights.consistency },
  ]);

  return {
    overall,
    firepower,
    entry,
    teamplay,
    clutch,
    consistency,
    confidence: calculateConfidence(stats.matches),
  };
}

export function buildPlayerAnalytics(players: Player[], matches: MatchRecord[]): PlayerAnalytics[] {
  return players
    .map((player) => {
      const stats = aggregatePlayerStats(player, matches);
      return {
        player,
        stats,
        scores: calculatePlayerScores(player, stats, matches),
        recent: getRecentPerformances(player.id, matches),
      };
    })
    .sort((a, b) => b.scores.overall - a.scores.overall);
}
