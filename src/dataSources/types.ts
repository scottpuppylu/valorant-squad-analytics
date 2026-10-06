import type { MatchRecord, Player } from '../types/valorant.js';

export interface NormalizedAnalyticsDataset {
  players: Player[];
  matches: MatchRecord[];
  sourceId: string;
  isDemo: boolean;
  mode: 'DEMO' | 'REAL';
}

export interface AnalyticsDataSource {
  readonly id: string;
  load(): Promise<NormalizedAnalyticsDataset>;
  snapshot(): NormalizedAnalyticsDataset;
}
