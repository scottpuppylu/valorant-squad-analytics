import { agentRoles } from '../utils/agentRoles.js';
import { dimensions } from '../scoring/versions.js';
import { zhTW } from '../i18n/zhTW.js';
import { calculatePlayerScores } from '../scoring/calculateScores.js';
import type { AgentName, MapName, MatchRecord, Player, PlayerAnalytics, PlayerRole } from '../types/valorant.js';
import { aggregatePlayerStats } from '../utils/aggregateStats.js';
import { safeDivide } from '../utils/number.js';
import type { BadgeAward, GroupSummary, PerformanceEntry, RecentForm, SelectionResult } from './types.js';
import { resolveAdaptiveWindow } from './scope/adaptiveWindow.js';
import { policyFor } from './scope/policies.js';
import { populationFromMatches } from './scope/resolveScope.js';
import type { AdaptiveWindowResult, ScopePopulation } from './scope/types.js';
import { summarizeSelection, type SelectionSummary } from './summary.js';

function summarize(id: string, label: string, entries: PerformanceEntry[]): GroupSummary {
  const rounds = entries.reduce((sum, entry) => sum + entry.rounds, 0);
  const kills = entries.reduce((sum, entry) => sum + entry.performance.kills, 0);
  const deaths = entries.reduce((sum, entry) => sum + entry.performance.deaths, 0);
  const weighted = (key: 'acs' | 'adr') => safeDivide(
    entries.reduce((sum, entry) => sum + entry.performance[key] * entry.rounds, 0), rounds,
  );
  const kastEntries = entries.filter((entry) => entry.performance.kast !== undefined
    && (!entry.performance.eventEvidence || entry.performance.eventEvidence.kast === 'reconstructed'));
  const kastRounds = kastEntries.reduce((sum, entry) => sum + entry.rounds, 0);
  const kast = kastRounds > 0 ? kastEntries.reduce((sum, entry) => entry.performance.kast === undefined ? sum : sum + entry.performance.kast * entry.rounds, 0) / kastRounds : undefined;
  return {
    id, label, appearances: entries.length,
    matches: new Set(entries.map((entry) => entry.match.id)).size,
    rounds, players: new Set(entries.map((entry) => entry.playerId)).size,
    wins: entries.filter((entry) => entry.match.won).length,
    winRate: safeDivide(entries.filter((entry) => entry.match.won).length, entries.length),
    acs: weighted('acs'), adr: weighted('adr'), kd: deaths > 0 ? kills/deaths : undefined, kast,
  };
}

export function groupEntries<T extends string>(entries: PerformanceEntry[], key: (entry: PerformanceEntry) => T): Map<T, PerformanceEntry[]> {
  const groups = new Map<T, PerformanceEntry[]>();
  for (const entry of entries) groups.set(key(entry), [...(groups.get(key(entry)) ?? []), entry]);
  return groups;
}

export function groupByMap(entries: PerformanceEntry[]): GroupSummary[] {
  return [...groupEntries(entries, (entry) => entry.match.map)].map(([id, group]) => summarize(id, id, group)).sort((a, b) => b.appearances - a.appearances || a.label.localeCompare(b.label));
}

export function groupByAgent(entries: PerformanceEntry[]): GroupSummary[] {
  return [...groupEntries(entries, (entry) => entry.performance.agent)].map(([id, group]) => summarize(id, id, group)).sort((a, b) => b.appearances - a.appearances || a.label.localeCompare(b.label));
}

export function groupByRole(entries: PerformanceEntry[]): GroupSummary[] {
  return [...groupEntries(entries, (entry) => agentRoles[entry.performance.agent] ?? '未知角色')].map(([id, group]) => summarize(id, id, group)).sort((a, b) => b.appearances - a.appearances || a.label.localeCompare(b.label));
}

export function comparePlayers(analytics: PlayerAnalytics[], playerIds: string[]): PlayerAnalytics[] {
  const unique = [...new Set(playerIds)];
  if (unique.length < 2 || unique.length > 4) throw new Error('玩家比較需要選擇 2 到 4 位玩家。');
  const byId = new Map(analytics.map((item) => [item.player.id, item]));
  return unique.flatMap((id) => byId.get(id) ?? []);
}

export function analyticsFromEntries(player: Player, entries: PerformanceEntry[]): PlayerAnalytics | undefined {
  if (entries.length === 0) return undefined;
  const matches: MatchRecord[] = entries.map(({ match, performance }) => ({ ...match, performances: [performance] }));
  const stats = aggregatePlayerStats(player, matches);
  return { player, stats, scores: calculatePlayerScores(player, stats, matches), recent: [] };
}

/**
 * Recent form: unchanged formula (Overall(current) − Overall(baseline), ±2 thresholds, numeric Overall
 * required in both). Since feature-scope-policy-v1 the two non-overlapping windows come from
 * adaptive-window-v1 `recentForm` (Competitive only) instead of a fixed newest-5 / remainder split.
 * Pass the player's context-filtered entries WITHOUT a time horizon applied.
 */
export function calculateRecentForm(player: Player, entries: PerformanceEntry[], population?: ScopePopulation): RecentForm {
  const window = resolveAdaptiveWindow(entries, policyFor('recentForm'), {
    population: population ?? populationFromMatches(entries.map((entry) => entry.match), 'unverified'),
  });
  return recentFormFromWindow(player, window);
}

/** Formula half of recent form; the window may come from the browser or from server analysis. */
export function recentFormFromWindow(player: Player, window: AdaptiveWindowResult): RecentForm {
  const recentMatches = window.current.matches;
  const baselineMatches = window.baseline?.matches ?? 0;
  if (window.status === 'unavailable') return { status: 'insufficient', recentMatches, baselineMatches, window };
  const recentValue = analyticsFromEntries(player, window.currentEntries)?.scores.overall.value;
  const baselineValue = analyticsFromEntries(player, window.baselineEntries)?.scores.overall.value;
  if (recentValue === undefined || baselineValue === undefined) return { status: 'insufficient', recentMatches, baselineMatches, window };
  const delta = recentValue - baselineValue;
  return {
    status: delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat', delta,
    recentOverall: recentValue, baselineOverall: baselineValue,
    recentMatches, baselineMatches, window,
  };
}

export function mapExtremes(player: Player, entries: PerformanceEntry[], minimum = 2): { strongest?: MapName; weakest?: MapName } {
  const candidates = [...groupEntries(entries, (entry) => entry.match.map)]
    .filter(([, group]) => group.length >= minimum)
    .map(([map, group]) => ({ map, score: analyticsFromEntries(player, group)!.scores.overall.value }))
    .filter((item): item is { map: MapName; score: number } => item.score !== undefined)
    .sort((a, b) => b.score - a.score || a.map.localeCompare(b.map));
  return { strongest: candidates[0]?.map, weakest: candidates.length > 1 ? candidates.at(-1)?.map : undefined };
}

export function mostUsedAgent(entries: PerformanceEntry[]): AgentName | undefined {
  return groupByAgent(entries)[0]?.id as AgentName | undefined;
}

export function resolveWinners(values: Array<{ playerId: string; value: number }>, tieTolerance = 0.1): { playerIds: string[]; value: number } | undefined {
  const finite = values.filter((item) => Number.isFinite(item.value)).sort((a, b) => b.value - a.value || a.playerId.localeCompare(b.playerId));
  if (!finite[0]) return undefined;
  return { value: finite[0].value, playerIds: finite.filter((item) => Math.abs(item.value - finite[0]!.value) <= tieTolerance).map((item) => item.playerId) };
}

/**
 * `formSelection` must hold each player's context-filtered entries without a time horizon so the
 * recentForm policy chooses its own windows (defaults to `selection` for compatibility).
 */
export function computeBadges(selection: SelectionResult, minMatches = 5, minRounds = 100, formSelection: SelectionResult = selection, population?: ScopePopulation, formWindows?: Map<string, AdaptiveWindowResult>): BadgeAward[] {
  const forms = [...formSelection.byPlayer.values()].flatMap((entries) => {
    const player = entries[0]?.player;
    if (!player) return [];
    const window = formWindows?.get(player.id);
    return [{ playerId: player.id, form: window ? recentFormFromWindow(player, window) : calculateRecentForm(player, entries, population) }];
  });
  return computeBadgesFromSummary(summarizeSelection(selection), minMatches, minRounds, forms);
}

/**
 * TASK-DATA-03B.2C: badges from a selection summary (server or local) — identical rules: eligible
 * analytics, 地圖王 over each player's maps with >= 3 appearances, 近期進步最多 from recent forms.
 */
export function computeBadgesFromSummary(summary: SelectionSummary, minMatches = 5, minRounds = 100, forms: { playerId: string; form: RecentForm }[] = []): BadgeAward[] {
  const eligible = summary.analytics.filter(({ stats }) => stats.matches >= minMatches && stats.rounds >= minRounds);
  const specifications = [
    ...dimensions.map((key) => [key, zhTW.scores[key]+'領先', '🏅', key, (a: PlayerAnalytics) => a.scores[key].value ?? Number.NaN] as const),
    ['headshot', '爆頭王', '🎯', 'HS%', (a: PlayerAnalytics) => a.stats.headshotPercentage ?? Number.NaN],
  ] as const;
  const awards: BadgeAward[] = specifications.flatMap(([id, label, emoji, basis, value]) => {
    const result = resolveWinners(eligible.map((analytics) => ({ playerId: analytics.player.id, value: value(analytics) })));
    return result ? [{ id, label, emoji, metricBasis: basis, minMatches, minRounds, ...result, tieRule: '最高值 0.1 以內並列' }] : [];
  });

  const mapCandidates = summary.players.flatMap(({ playerId, maps }) => maps
    .filter((map) => map.appearances >= 3)
    .map((map) => ({ playerId, value: map.overall ?? Number.NaN })));
  const mapWinner = resolveWinners(mapCandidates);
  if (mapWinner) awards.push({ id: 'map', label: '地圖王', emoji: '🗺️', metricBasis: '單一地圖 Overall', minMatches: 3, minRounds: 0, ...mapWinner, tieRule: '最高值 0.1 以內並列' });

  const formWinner = resolveWinners(forms.flatMap(({ playerId, form }) => (form.delta === undefined ? [] : [{ playerId, value: form.delta }])));
  if (formWinner) awards.push({ id: 'form', label: '近期進步最多', emoji: '📈', metricBasis: '自適應現況區間 Overall − 不重疊基準區間 Overall（僅競技模式，adaptive-window-v1）', minMatches: 6, minRounds: 0, ...formWinner, tieRule: '最高變化 0.1 分以內並列' });
  return awards;
}

export type { MapName, PlayerRole };
