import { agentRoles } from '../utils/agentRoles';
import type { NormalizedAnalyticsDataset } from '../dataSources/types';
import type { MatchRecord } from '../types/valorant';
import type { AnalysisFilters, PerformanceEntry, SelectionResult } from './types';
import { populationFromMatches, resolveScopeSelection } from './scope/resolveScope';
import type { FeatureId, ScopePopulation } from './scope/types';

export interface SelectionOptions {
  /** Analytics population facts; derived from the entries when omitted (coverage unverified). */
  population?: ScopePopulation;
  /** LIFETIME feature this page represents. */
  lifetimeFeature?: FeatureId;
}

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

/**
 * Context filters first (player/map/agent/role/queue), then the analysis-scope-v1 horizon
 * (全部已追蹤 / 目前實力 / 指定 Act / 最近 N 場 / 自訂日期). Pages never select windows themselves.
 */
export function selectPerformances(entries: PerformanceEntry[], filters: AnalysisFilters, options: SelectionOptions = {}): SelectionResult {
  const contextual = entries.filter((entry) => (
    (filters.playerId === 'all' || entry.playerId === filters.playerId)
    && (filters.map === 'all' || entry.match.map === filters.map)
    && (filters.agent === 'all' || entry.performance.agent === filters.agent)
    && (filters.role === 'all' || agentRoles[entry.performance.agent] === filters.role)
    && (filters.gameMode === 'all' || entry.match.gameMode === filters.gameMode)
  ));
  const population = options.population ?? populationFromMatches([...new Set(entries.map((entry) => entry.match))], 'unverified');
  const { byPlayer, summary } = resolveScopeSelection(contextual, {
    choice: filters.period, act: filters.act, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
    gameMode: filters.gameMode, lifetimeFeature: options.lifetimeFeature,
  }, population);
  const selected = [...byPlayer.values()].flat();
  return {
    entries: selected.sort((a, b) => b.match.playedAt.localeCompare(a.match.playedAt) || a.playerId.localeCompare(b.playerId)),
    byPlayer,
    scope: summary,
  };
}

export function resetAnalysisFilters(): AnalysisFilters {
  return { ...defaultAnalysisFilters };
}

export function matchesForSelection(matches: MatchRecord[], selection: SelectionResult): MatchRecord[] {
  const selectedIds = new Set(selection.entries.map((entry) => entry.match.id));
  return matches.filter((match) => selectedIds.has(match.id)).sort((a, b) => b.playedAt.localeCompare(a.playedAt));
}
