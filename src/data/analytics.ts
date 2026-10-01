import { buildPlayerAnalytics } from '../scoring/calculateScores';
import { createPerformanceEntries } from '../analytics/filters';
import type { NormalizedAnalyticsDataset } from '../dataSources/types';

export interface DatasetAnalytics {
  activeDataset: NormalizedAnalyticsDataset;
  playerAnalytics: ReturnType<typeof buildPlayerAnalytics>;
  performanceEntries: ReturnType<typeof createPerformanceEntries>;
  availableMaps: string[];
  availableGameModes: string[];
  availableAgents: string[];
  getPlayerAnalytics(playerId: string): ReturnType<typeof buildPlayerAnalytics>[number] | undefined;
}

export function buildAnalytics(activeDataset: NormalizedAnalyticsDataset): DatasetAnalytics {
  const playerAnalytics = buildPlayerAnalytics(activeDataset.players, activeDataset.matches);
  return {
    activeDataset,
    playerAnalytics,
    performanceEntries: createPerformanceEntries(activeDataset),
    availableMaps: [...new Set(activeDataset.matches.map((match) => match.map))].sort(),
    availableGameModes: [...new Set(activeDataset.matches.map((match) => match.gameMode))].sort(),
    availableAgents: [...new Set(activeDataset.matches.flatMap((match) => match.performances.map((performance) => performance.agent)))].sort(),
    getPlayerAnalytics: (playerId: string) => playerAnalytics.find(({ player }) => player.id === playerId),
  };
}
