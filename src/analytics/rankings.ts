import { calculatePlayerScores } from '../scoring/calculateScores';
import type { MatchRecord, PlayerAnalytics } from '../types/valorant';
import { aggregatePlayerStats, getRecentPerformances } from '../utils/aggregateStats';
import { safeDivide } from '../utils/number';
import type { AnalysisFilters, PerformanceEntry, RankedPlayer, RankingMetric, SelectionResult, SortDirection } from './types';

export const rankingMetricLabels: Record<RankingMetric, string> = {
  overall: '綜合表現', firepower: '火力', entry: '開戰影響', teamplay: '團隊貢獻', clutch: '殘局能力', consistency: '穩定度',
  acs: 'ACS', adr: 'ADR', kd: 'K/D', kpr: 'KPR', apr: 'APR', kast: 'KAST', headshotPercentage: 'HS%',
  firstKills: '首殺', firstDeaths: '首死', fkFd: 'FK/FD', clutchConversion: '殘局轉換率', winRate: '勝率',
};

export const lowerIsBetterMetrics = new Set<RankingMetric>(['firstDeaths']);

function matchesFromEntries(entries: PerformanceEntry[]): MatchRecord[] {
  return entries.map(({ match, performance }) => ({ ...match, performances: [performance] }));
}

export function aggregateSelection(selection: SelectionResult): PlayerAnalytics[] {
  return [...selection.byPlayer.values()].flatMap((entries) => {
    const player = entries[0]?.player;
    if (!player || entries.length === 0) return [];
    const matches = matchesFromEntries(entries);
    const stats = aggregatePlayerStats(player, matches);
    return [{ player, stats, scores: calculatePlayerScores(player, stats, matches), recent: getRecentPerformances(player.id, matches) }];
  });
}

export function rankingValue(analytics: PlayerAnalytics, metric: RankingMetric): number | undefined {
  if (metric in analytics.scores) return analytics.scores[metric as keyof typeof analytics.scores];
  if (metric === 'clutchConversion') {
    return analytics.stats.clutchAttempts && analytics.stats.clutchWins !== undefined
      ? analytics.stats.clutchWins / analytics.stats.clutchAttempts : undefined;
  }
  if (metric === 'winRate') return safeDivide(analytics.stats.wins, analytics.stats.matches);
  const value = analytics.stats[metric as keyof typeof analytics.stats];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function rankPlayers(
  selection: SelectionResult,
  filters: AnalysisFilters,
  metric: RankingMetric,
  direction: SortDirection = lowerIsBetterMetrics.has(metric) ? 'asc' : 'desc',
): RankedPlayer[] {
  const factor = direction === 'asc' ? 1 : -1;
  return aggregateSelection(selection)
    .filter(({ stats }) => stats.matches > 0 && stats.rounds > 0 && stats.matches >= filters.minMatches && stats.rounds >= filters.minRounds)
    .flatMap((analytics) => {
      const value = rankingValue(analytics, metric);
      return value === undefined || !Number.isFinite(value) ? [] : [{ analytics, value, metric }];
    })
    .sort((a, b) => factor * (a.value - b.value) || a.analytics.player.handle.localeCompare(b.analytics.player.handle));
}

export function insufficientPlayers(selection: SelectionResult, filters: AnalysisFilters): string[] {
  return aggregateSelection(selection)
    .filter(({ stats }) => stats.matches < filters.minMatches || stats.rounds < filters.minRounds)
    .map(({ player }) => player.id);
}
