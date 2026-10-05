import type { AnalysisFilters, RankingMetric } from './types';
import { zhTW } from '../i18n/zhTW';
import { seasonLabel } from './scope/season';
import type { ScopeKind, ScopeReason, ScopeStatus, WindowSample } from './scope/types';
import { formatAcs, formatAdr, formatCount, formatPercent, formatRatio, formatScore } from '../utils/format';

export const periodLabels = { current: '目前實力（自適應）', all: '全部已追蹤', act: '指定 Act', recent10: '最近 10 場', recent30: '最近 30 場', custom: '自訂日期' } as const;

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
  if (filters.period === 'act') summary.push(seasonLabel(filters.act));
  else if (filters.period !== 'all') summary.push(periodLabels[filters.period]);
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

export const scopeStatusLabels: Record<ScopeStatus, string> = { available: '樣本充足', partial: '部分樣本', unavailable: '資料不足' };

export const scopeKindLabels: Record<ScopeKind, string> = {
  LIFETIME: '全部已追蹤', ACT: '指定 Act', RECENT: '最近 N 場', ADAPTIVE: '自適應觀察區間', PAIR: '搭檔情境',
};

export const scopeReasonLabels: Record<ScopeReason, string> = {
  target_rounds_reached: '已達目標回合數',
  target_matches_reached: '已達目標場數',
  max_matches_reached: '已達場數上限',
  minimum_sample_reached: '樣本門檻已達',
  minimum_active_days_reached: '活躍天數門檻已達',
  time_span_cap_reached: '已達時間跨度上限（避免拉得太久）',
  lookback_exhausted: '回溯期間內已無更多符合對戰',
  act_boundary_respected: '未跨 Act',
  season_evidence_unavailable: '目前沒有 Act 證據，無法判斷 Act 邊界',
  season_evidence_partial: '僅部分對戰有 Act 證據',
  rank_evidence_unavailable: '沒有牌位證據（不影響選樣，只是無法使用牌位邊界）',
  rank_boundary_respected: '依牌位變化切分',
  insufficient_sample: '場數或回合數未達最低門檻',
  insufficient_active_days: '活躍天數未達最低門檻',
  insufficient_baseline: '基準區間樣本不足',
  queue_restricted_by_policy: '僅使用競技模式',
  queue_excluded_by_policy: '此範圍僅包含競技模式，目前模式篩選不適用',
  transport_window_truncated: '已追蹤戰績多於目前載入的分析快照，較舊資料未納入',
  population_coverage_unverified: '尚未確認快照是否涵蓋全部已追蹤戰績',
  no_matching_evidence: '沒有符合條件的對戰',
  season_crossed_in_baseline: '基準區間跨越 Act',
  stale_recent_evidence: '最近一場距今已有一段時間',
  server_population_limit: '符合條件的已追蹤戰績超過伺服器單次分析上限，只使用最新部分',
  same_act_baseline: '同 Act 比較',
  previous_act_fallback: '同 Act 基準不足，明示改用前一個 Act（可比性降低）',
  act_evidence_unknown: 'Act 證據不完整，無法確認是否同 Act',
  insufficient_dimension_overlap: '兩個區間共同可計分的表現維度不足',
  outlier_sensitive: '變化主要來自少數場次，已依穩健性收斂',
  trend_stability_unavailable: '無法評估趨勢穩定度',
};

/** e.g. "22 場 / 412 回合 / 18.4 小時 / 17 天". Display rounding only. */
export function describeWindow(sample: WindowSample): string {
  const days = sample.matches === 0 ? 0 : Math.max(1, Math.ceil(sample.spanDays));
  return `${formatCount(sample.matches)} 場 / ${formatCount(sample.rounds)} 回合 / ${(sample.minutes / 60).toFixed(1)} 小時 / ${formatCount(days)} 天`;
}

export const progressDirectionLabels = { improving: '進步中', stable: '持平（未顯示明確變化）', declining: '下滑中' } as const;
export const actPolicyLabels = { same_act: '同 Act 比較', previous_act_fallback: '同 Act 基準不足，改用前一個 Act', act_unknown: 'Act 證據不完整' } as const;
