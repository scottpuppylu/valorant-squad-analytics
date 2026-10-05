import { buildPlayerAnalytics } from '../scoring/calculateScores';
import { createPerformanceEntries, defaultAnalysisFilters, selectPerformances } from '../analytics/filters';
import { aggregateSelection } from '../analytics/rankings';
import { populationFromMatches } from '../analytics/scope/resolveScope';
import type { ScopePopulation, ScopeStatus } from '../analytics/scope/types';
import type { SelectionResult } from '../analytics/types';
import { compareScoreResults } from '../scoring/calculateScores';
import type { NormalizedAnalyticsDataset } from '../dataSources/types';
import type { PlayerAnalytics } from '../types/valorant';

/** Server facts (view=analytics) that keep scope labels truthful; absent for Demo/tests. */
export interface AnalyticsPopulationFacts {
  snapshotCoversTrackedHistory: boolean;
  seasonKeys: string[];
  seasonStatus: ScopeStatus;
  rankStatus: ScopeStatus;
}

export interface DatasetAnalytics {
  activeDataset: NormalizedAnalyticsDataset;
  /** 全部已追蹤 (LIFETIME, all modes) — the historical default population. */
  playerAnalytics: ReturnType<typeof buildPlayerAnalytics>;
  performanceEntries: ReturnType<typeof createPerformanceEntries>;
  availableMaps: string[];
  availableGameModes: string[];
  availableAgents: string[];
  /** analysis-scope-v1 population facts shared by every page. */
  population: ScopePopulation;
  /** Community ranking population (feature currentStrength). Players without a window are listed in selection.scope. */
  currentStrength: { analytics: PlayerAnalytics[]; selection: SelectionResult };
  getPlayerAnalytics(playerId: string): ReturnType<typeof buildPlayerAnalytics>[number] | undefined;
}

export function buildAnalytics(activeDataset: NormalizedAnalyticsDataset, facts?: AnalyticsPopulationFacts): DatasetAnalytics {
  const playerAnalytics = buildPlayerAnalytics(activeDataset.players, activeDataset.matches);
  const performanceEntries = createPerformanceEntries(activeDataset);
  const derived = populationFromMatches(activeDataset.matches, activeDataset.isDemo ? true : facts ? facts.snapshotCoversTrackedHistory : 'unverified');
  const population: ScopePopulation = facts ? {
    ...derived,
    seasonKeys: [...new Set([...derived.seasonKeys, ...facts.seasonKeys])].sort(),
    seasonStatus: facts.seasonStatus,
    rankStatus: facts.rankStatus,
  } : derived;
  const currentSelection = selectPerformances(performanceEntries, { ...defaultAnalysisFilters, period: 'current' }, { population });
  const currentAnalytics = aggregateSelection(currentSelection)
    .sort((a, b) => compareScoreResults(a.scores.overall, b.scores.overall) || a.player.handle.localeCompare(b.player.handle));
  return {
    activeDataset,
    playerAnalytics,
    performanceEntries,
    availableMaps: [...new Set(activeDataset.matches.map((match) => match.map))].sort(),
    availableGameModes: [...new Set(activeDataset.matches.map((match) => match.gameMode))].sort(),
    availableAgents: [...new Set(activeDataset.matches.flatMap((match) => match.performances.map((performance) => performance.agent)))].sort(),
    population,
    currentStrength: { analytics: currentAnalytics, selection: currentSelection },
    getPlayerAnalytics: (playerId: string) => playerAnalytics.find(({ player }) => player.id === playerId),
  };
}
