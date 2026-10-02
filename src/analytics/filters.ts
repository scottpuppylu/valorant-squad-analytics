import { agentRoles } from '../utils/agentRoles';
import type { NormalizedAnalyticsDataset } from '../dataSources/types';
import type { MatchRecord } from '../types/valorant';
import type { AnalysisFilters, PerformanceEntry, SelectionResult } from './types';

export const defaultAnalysisFilters: AnalysisFilters = {
  playerId: 'all',
  period: 'all',
  map: 'all',
  agent: 'all',
  role: 'all',
  gameMode: 'all',
  minMatches: 0,
  minRounds: 0,
};

export function createPerformanceEntries(dataset: NormalizedAnalyticsDataset): PerformanceEntry[] {
  const playerById = new Map(dataset.players.map((player) => [player.id, player]));
  return dataset.matches.flatMap((match) => match.performances.flatMap((performance) => {
    const player = playerById.get(performance.playerId);
    return player ? [{
      player,
      playerId: player.id,
      match,
      performance,
      rounds: match.scoreFor + match.scoreAgainst,
    }] : [];
  }));
}

function withinCustomRange(entry: PerformanceEntry, filters: AnalysisFilters): boolean {
  const day = entry.match.playedAt.slice(0, 10);
  if (filters.dateFrom && day < filters.dateFrom) return false;
  if (filters.dateTo && day > filters.dateTo) return false;
  return true;
}

export function selectPerformances(entries: PerformanceEntry[], filters: AnalysisFilters): SelectionResult {
  const contextual = entries.filter((entry) => (
    (filters.playerId === 'all' || entry.playerId === filters.playerId)
    && (filters.map === 'all' || entry.match.map === filters.map)
    && (filters.agent === 'all' || entry.performance.agent === filters.agent)
    && (filters.role === 'all' || agentRoles[entry.performance.agent] === filters.role)
    && (filters.gameMode === 'all' || entry.match.gameMode === filters.gameMode)
    && (filters.period !== 'custom' || withinCustomRange(entry, filters))
  ));

  const grouped = new Map<string, PerformanceEntry[]>();
  for (const entry of contextual) {
    const group = grouped.get(entry.playerId) ?? [];
    group.push(entry);
    grouped.set(entry.playerId, group);
  }

  const recentLimit = filters.period === 'recent10' ? 10 : filters.period === 'recent30' ? 30 : undefined;
  const byPlayer = new Map<string, PerformanceEntry[]>();
  const selected: PerformanceEntry[] = [];
  for (const [playerId, playerEntries] of grouped) {
    const ordered = [...playerEntries].sort((a, b) => (
      b.match.playedAt.localeCompare(a.match.playedAt) || a.match.id.localeCompare(b.match.id)
    ));
    const eligible = recentLimit === undefined ? ordered : ordered.slice(0, recentLimit);
    byPlayer.set(playerId, eligible);
    selected.push(...eligible);
  }

  return {
    entries: selected.sort((a, b) => b.match.playedAt.localeCompare(a.match.playedAt) || a.playerId.localeCompare(b.playerId)),
    byPlayer,
  };
}

export function resetAnalysisFilters(): AnalysisFilters {
  return { ...defaultAnalysisFilters };
}

export function matchesForSelection(matches: MatchRecord[], selection: SelectionResult): MatchRecord[] {
  const selectedIds = new Set(selection.entries.map((entry) => entry.match.id));
  return matches.filter((match) => selectedIds.has(match.id)).sort((a, b) => b.playedAt.localeCompare(a.playedAt));
}
