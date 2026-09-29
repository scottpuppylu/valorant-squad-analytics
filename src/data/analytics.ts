import { demoMatches } from './demoMatches';
import { players } from './players';
import { buildPlayerAnalytics } from '../scoring/calculateScores';

export const playerAnalytics = buildPlayerAnalytics(players, demoMatches);

export const getPlayerAnalytics = (playerId: string) =>
  playerAnalytics.find(({ player }) => player.id === playerId);
