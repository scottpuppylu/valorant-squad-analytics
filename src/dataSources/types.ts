import type { MatchRecord, Player } from '../types/valorant';

export interface NormalizedAnalyticsDataset {
  players: Player[];
  matches: MatchRecord[];
  sourceId: string;
  isDemo: boolean;
}

export interface AnalyticsDataSource {
  readonly id: string;
  load(): Promise<NormalizedAnalyticsDataset>;
  snapshot(): NormalizedAnalyticsDataset;
}
