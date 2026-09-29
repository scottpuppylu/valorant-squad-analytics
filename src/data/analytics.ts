import { demoDataSource } from '../dataSources/demo/DemoDataSource';
import { loadBrowserRealDataset } from '../dataSources/real/BrowserRealDatasetRepository';
import { buildPlayerAnalytics } from '../scoring/calculateScores';
import { createPerformanceEntries } from '../analytics/filters';

export const activeDataset = loadBrowserRealDataset()?.dataset ?? demoDataSource.snapshot();
export const playerAnalytics = buildPlayerAnalytics(activeDataset.players, activeDataset.matches);
export const performanceEntries = createPerformanceEntries(activeDataset);
export const availableMaps = [...new Set(activeDataset.matches.map((match) => match.map))].sort();
export const availableGameModes = [...new Set(activeDataset.matches.map((match) => match.gameMode))].sort();
export const availableAgents = [...new Set(activeDataset.matches.flatMap((match) => match.performances.map((performance) => performance.agent)))].sort();

export const getPlayerAnalytics = (playerId: string) =>
  playerAnalytics.find(({ player }) => player.id === playerId);
