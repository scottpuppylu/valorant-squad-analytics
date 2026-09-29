import type { AgentName, GameMode, MapName, MatchPerformance, MatchRecord, Player, PlayerAnalytics, PlayerRole } from '../types/valorant';

export type RecentWindow = 'all' | 'recent10' | 'recent30' | 'custom';
export type SortDirection = 'asc' | 'desc';

export type RankingMetric =
  | 'overall' | 'firepower' | 'entry' | 'teamplay' | 'clutch' | 'consistency'
  | 'acs' | 'adr' | 'kd' | 'kpr' | 'apr' | 'kast' | 'headshotPercentage'
  | 'firstKills' | 'firstDeaths' | 'fkFd' | 'clutchConversion' | 'winRate';

export interface AnalysisFilters {
  playerId: 'all' | string;
  period: RecentWindow;
  dateFrom?: string;
  dateTo?: string;
  map: 'all' | MapName;
  agent: 'all' | AgentName;
  role: 'all' | PlayerRole;
  gameMode: 'all' | GameMode;
  minMatches: number;
  minRounds: number;
}

export interface PerformanceEntry {
  player: Player;
  playerId: string;
  match: MatchRecord;
  performance: MatchPerformance;
  rounds: number;
}

export interface SelectionResult {
  entries: PerformanceEntry[];
  byPlayer: Map<string, PerformanceEntry[]>;
}

export interface RankedPlayer {
  analytics: PlayerAnalytics;
  value: number;
  metric: RankingMetric;
}

export interface GroupSummary {
  id: string;
  label: string;
  appearances: number;
  matches: number;
  rounds: number;
  players: number;
  wins: number;
  winRate: number;
  acs: number;
  adr: number;
  kd: number;
  kast: number;
}

export interface RecentForm {
  status: 'up' | 'flat' | 'down' | 'insufficient';
  delta?: number;
  recentOverall?: number;
  baselineOverall?: number;
  recentMatches: number;
  baselineMatches: number;
}

export interface BadgeAward {
  id: string;
  label: string;
  emoji: string;
  metricBasis: string;
  minMatches: number;
  minRounds: number;
  playerIds: string[];
  value: number;
  tieRule: string;
}
