import type { AnalysisFilters, RankingMetric } from './types';
import { zhTW } from '../i18n/zhTW';
import { formatAcs, formatAdr, formatCount, formatPercent, formatRatio, formatScore } from '../utils/format';

export const periodLabels = { all: '全部期間', recent10: '最近 10 場', recent30: '最近 30 場', custom: '自訂日期' } as const;

export const gameModeLabels: Record<string, string> = {
  Competitive: '競技模式',
  Premier: 'Premier',
  Unrated: '一般模式',
  Custom: '自訂對戰',
};

export function activeFilterSummary(filters: AnalysisFilters): string[] {
  const summary: string[] = [];
  if (filters.playerId !== 'all') summary.push('指定玩家');
  if (filters.map !== 'all') summary.push(filters.map);
  if (filters.agent !== 'all') summary.push(filters.agent);
  if (filters.role !== 'all') summary.push(zhTW.roles[filters.role]);
  if (filters.gameMode !== 'all') summary.push(gameModeLabels[filters.gameMode] ?? filters.gameMode);
  if (filters.period !== 'all') summary.push(periodLabels[filters.period]);
  if (filters.period === 'custom' && (filters.dateFrom || filters.dateTo)) summary.push(`${filters.dateFrom ?? '…'} 至 ${filters.dateTo ?? '…'}`);
  if (filters.minMatches > 0) summary.push(`至少 ${filters.minMatches} 場`);
  if (filters.minRounds > 0) summary.push(`至少 ${filters.minRounds} 回合`);
  return summary;
}

export function formatRankingValue(metric: RankingMetric, value: number): string {
  if (['kast', 'headshotPercentage', 'clutchConversion', 'winRate'].includes(metric)) return formatPercent(value);
  if (['firstKills', 'firstDeaths'].includes(metric)) return formatCount(value);
  if (metric === 'acs') return formatAcs(value);
  if (metric === 'adr') return formatAdr(value);
  if (metric === 'kd' || metric === 'kpr' || metric === 'apr' || metric === 'fkFd') return formatRatio(value);
  return formatScore(value);
}
