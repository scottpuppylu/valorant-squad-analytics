import type { AnalysisFilters, RankingMetric } from './types';
import { zhTW } from '../i18n/zhTW';
import { seasonLabel } from './scope/season';
import type { ScopeKind, ScopeReason, ScopeStatus, WindowSample } from './scope/types';
import { formatAcs, formatAdr, formatCount, formatPercent, formatRatio, formatScore } from '../utils/format';

/** Strength analytics labels (mode-eligibility-policy-v1: Competitive only). */
export const periodLabels = { current: '目前實力（自適應・排位）', all: '全部已追蹤排位', act: '指定 Act（排位）', recent10: '最近 10 場排位', recent30: '最近 30 場排位', custom: '自訂日期（排位）' } as const;
/** Match History browsing labels: every tracked mode. */
export const browsePeriodLabels = { current: '全部已追蹤', all: '全部已追蹤', act: '指定 Act', recent10: '最近 10 場', recent30: '最近 30 場', custom: '自訂日期' } as const;

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
  LIFETIME: '全部已追蹤排位', ACT: '指定 Act（排位）', RECENT: '最近 N 場', ADAPTIVE: '自適應觀察區間', PAIR: '搭檔情境',
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
  queue_restricted_by_policy: '僅使用排位模式；一般與娛樂模式不納入戰力分析',
  queue_excluded_by_policy: '此分析僅使用排位模式；指定的模式不納入戰力分析',
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
  low_progress_confidence: '比較信心過低，不顯示方向或數值',
};

/** e.g. "22 場 / 412 回合 / 18.4 小時 / 17 天". Display rounding only. */
export function describeWindow(sample: WindowSample): string {
  const days = sample.matches === 0 ? 0 : Math.max(1, Math.ceil(sample.spanDays));
  return `${formatCount(sample.matches)} 場 / ${formatCount(sample.rounds)} 回合 / ${(sample.minutes / 60).toFixed(1)} 小時 / ${formatCount(days)} 天`;
}

export const progressDirectionLabels = { improving: '進步中', stable: '持平（未顯示明確變化）', declining: '下滑中' } as const;
export const actPolicyLabels = { same_act: '同 Act 比較', previous_act_fallback: '同 Act 基準不足，改用前一個 Act', act_unknown: 'Act 證據不完整' } as const;

/** TASK-DATA-FASTSYNC-01 recent-refresh copy. Never claims complete Riot or lifetime history. */
export const recentRefreshLabels = {
  checking: '正在檢查最新戰績',
  fresh: '資料已是最新狀態',
  refreshedNew: '已更新最新戰績',
  refreshedNone: '資料已是最新狀態（資料來源沒有新的對戰）',
  morePending: '最新一批已更新，仍有近期資料待補',
  busy: '正在由其他請求更新，稍後可再更新',
  backoff: '更新暫時受到限制',
  unavailable: '目前無法更新此玩家戰績',
  retryLater: '稍後可再更新',
} as const;

/** TASK-WEAPON-01 weapon-analytics-v1 copy. Never claims complete lifetime, causality or per-weapon HS%/ADR. */
export const weaponScopeLabels = { all: '全部已追蹤排位', current: '目前實力區間（排位）', act: '指定 Act（排位）' } as const;
export const weaponEvidenceLabels = { available: '證據充足', partial: '部分證據', unavailable: '資料不足' } as const;
export const weaponReasonLabels: Record<string, string> = {
  small_sample: '樣本少，僅供參考',
  round_weapon_evidence_partial: '回合武器證據不完整',
  kill_weapon_evidence_partial: '擊殺武器證據不完整',
  act_not_observed: '此 Act 沒有已追蹤資料',
  member_not_visible: '此成員目前不公開',
  current_strength_adaptive_window: '沿用「目前實力」自適應區間',
};
