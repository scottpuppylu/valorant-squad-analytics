import { demoDataSource } from '../dataSources/demo/DemoDataSource';
import { buildPlayerAnalytics } from '../scoring/calculateScores';

export const activeDataset = demoDataSource.snapshot();
export const playerAnalytics = buildPlayerAnalytics(activeDataset.players, activeDataset.matches);

export const getPlayerAnalytics = (playerId: string) =>
  playerAnalytics.find(({ player }) => player.id === playerId);
