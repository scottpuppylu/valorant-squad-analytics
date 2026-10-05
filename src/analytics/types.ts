import type { AdaptiveWindowResult, ScopeSummary } from './scope/types';
import type { AgentName, GameMode, MapName, MatchPerformance, MatchRecord, Player, PlayerAnalytics, PlayerRole } from '../types/valorant';

/** 'all' = 全部已追蹤 (historical URL value); 'current' = adaptive 目前實力; 'act' = 指定 Act. */
export type RecentWindow = 'current' | 'all' | 'act' | 'recent10' | 'recent30' | 'custom';
export type SortDirection = 'asc' | 'desc';

export type RankingMetric =
  | 'roundImpact' | 'economy' | 'roleValue' | 'overall' | 'firepower' | 'entry' | 'teamplay' | 'clutch' | 'consistency'
  | 'acs' | 'adr' | 'kd' | 'kpr' | 'apr' | 'kast' | 'headshotPercentage'
  | 'firstKills' | 'firstDeaths' | 'fkFd' | 'clutchConversion' | 'winRate';

export interface AnalysisFilters {
  playerId: 'all' | string;
  period: RecentWindow;
  /** Public Act key when period is 'act'. */
  act?: string;
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
  /** analysis-scope-v1 metadata: which horizon/policy produced this selection and why. */
  scope?: ScopeSummary;
}

export interface RankedPlayer {
  analytics: PlayerAnalytics;
  value?: number;
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
  kd?: number;
  kast?: number;
}

export interface RecentForm {
  status: 'up' | 'flat' | 'down' | 'insufficient';
  delta?: number;
  recentOverall?: number;
  baselineOverall?: number;
  recentMatches: number;
  baselineMatches: number;
  /** adaptive-window-v1 rationale for the current and baseline windows. */
  window?: AdaptiveWindowResult;
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
