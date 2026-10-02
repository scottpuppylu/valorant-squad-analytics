import { agentRoles } from '../utils/agentRoles';
import { dimensions } from '../scoring/versions';
import { zhTW } from '../i18n/zhTW';
import { calculatePlayerScores } from '../scoring/calculateScores';
import type { AgentName, MapName, MatchRecord, Player, PlayerAnalytics, PlayerRole } from '../types/valorant';
import { aggregatePlayerStats } from '../utils/aggregateStats';
import { safeDivide } from '../utils/number';
import type { BadgeAward, GroupSummary, PerformanceEntry, RecentForm, SelectionResult } from './types';
import { aggregateSelection } from './rankings';

function summarize(id: string, label: string, entries: PerformanceEntry[]): GroupSummary {
  const rounds = entries.reduce((sum, entry) => sum + entry.rounds, 0);
  const kills = entries.reduce((sum, entry) => sum + entry.performance.kills, 0);
  const deaths = entries.reduce((sum, entry) => sum + entry.performance.deaths, 0);
  const weighted = (key: 'acs' | 'adr' | 'kast') => safeDivide(
    entries.reduce((sum, entry) => sum + entry.performance[key] * entry.rounds, 0), rounds,
  );
  return {
    id, label, appearances: entries.length,
    matches: new Set(entries.map((entry) => entry.match.id)).size,
    rounds, players: new Set(entries.map((entry) => entry.playerId)).size,
    wins: entries.filter((entry) => entry.match.won).length,
    winRate: safeDivide(entries.filter((entry) => entry.match.won).length, entries.length),
    acs: weighted('acs'), adr: weighted('adr'), kd: deaths > 0 ? kills/deaths : undefined, kast: weighted('kast'),
  };
}

function groupEntries<T extends string>(entries: PerformanceEntry[], key: (entry: PerformanceEntry) => T): Map<T, PerformanceEntry[]> {
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

function analyticsFromEntries(player: Player, entries: PerformanceEntry[]): PlayerAnalytics | undefined {
  if (entries.length === 0) return undefined;
  const matches: MatchRecord[] = entries.map(({ match, performance }) => ({ ...match, performances: [performance] }));
  const stats = aggregatePlayerStats(player, matches);
  return { player, stats, scores: calculatePlayerScores(player, stats, matches), recent: [] };
}

export function calculateRecentForm(player: Player, entries: PerformanceEntry[]): RecentForm {
  const ordered = [...entries].sort((a, b) => b.match.playedAt.localeCompare(a.match.playedAt));
  const recent = ordered.slice(0, 5);
  const baseline = ordered.slice(5);
  if (recent.length < 3 || baseline.length < 3) return { status: 'insufficient', recentMatches: recent.length, baselineMatches: baseline.length };
  const recentAnalytics = analyticsFromEntries(player, recent)!;
  const baselineAnalytics = analyticsFromEntries(player, baseline)!;
  const recentValue=recentAnalytics.scores.overall.value, baselineValue=baselineAnalytics.scores.overall.value;
  if (recentValue === undefined || baselineValue === undefined) return {status:'insufficient',recentMatches:recent.length,baselineMatches:baseline.length};
  const delta = recentValue - baselineValue;
  return {
    status: delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat', delta,
    recentOverall: recentValue, baselineOverall: baselineValue,
    recentMatches: recent.length, baselineMatches: baseline.length,
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

export function computeBadges(selection: SelectionResult, minMatches = 5, minRounds = 100): BadgeAward[] {
  const eligible = aggregateSelection(selection).filter(({ stats }) => stats.matches >= minMatches && stats.rounds >= minRounds);
  const specifications = [
    ...dimensions.map((key) => [key, zhTW.scores[key]+'領先', '🏅', key, (a: PlayerAnalytics) => a.scores[key].value ?? Number.NaN] as const),
    ['headshot', '爆頭王', '🎯', 'HS%', (a: PlayerAnalytics) => a.stats.headshotPercentage ?? Number.NaN],
  ] as const;
  const awards: BadgeAward[] = specifications.flatMap(([id, label, emoji, basis, value]) => {
    const result = resolveWinners(eligible.map((analytics) => ({ playerId: analytics.player.id, value: value(analytics) })));
    return result ? [{ id, label, emoji, metricBasis: basis, minMatches, minRounds, ...result, tieRule: '最高值 0.1 以內並列' }] : [];
  });

  const mapCandidates = [...new Set(selection.entries.map((entry) => entry.playerId))].flatMap((playerId) => {
    const playerEntries = selection.byPlayer.get(playerId) ?? [];
    const player = playerEntries[0]?.player;
    if (!player) return [];
    return [...groupEntries(playerEntries, (entry) => entry.match.map)]
      .filter(([, group]) => group.length >= 3)
      .map(([, group]) => ({ playerId, value: analyticsFromEntries(player, group)!.scores.overall.value ?? Number.NaN }));
  });
  const mapWinner = resolveWinners(mapCandidates);
  if (mapWinner) awards.push({ id: 'map', label: '地圖王', emoji: '🗺️', metricBasis: '單一地圖 Overall', minMatches: 3, minRounds: 0, ...mapWinner, tieRule: '最高值 0.1 以內並列' });

  const formWinner = resolveWinners([...selection.byPlayer.values()].flatMap((entries) => {
    const player = entries[0]?.player;
    const form = player ? calculateRecentForm(player, entries) : undefined;
    return form?.delta === undefined ? [] : [{ playerId: player!.id, value: form.delta }];
  }));
  if (formWinner) awards.push({ id: 'form', label: '近期進步最多', emoji: '📈', metricBasis: '最近 5 場 Overall − 先前基準 Overall', minMatches: 8, minRounds: 0, ...formWinner, tieRule: '最高變化 0.1 分以內並列' });
  return awards;
}

export type { MapName, PlayerRole };
