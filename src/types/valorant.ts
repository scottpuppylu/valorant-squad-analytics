import type { PlayerEmoji } from './avatar';
import type { AdvancedMetrics } from './advancedMetrics';

export type PlayerRole = 'Duelist' | 'Initiator' | 'Controller' | 'Sentinel';

export type AgentName = string;

export type MapName = string;

export type GameMode = string;

export interface Player {
  id: string;
  handle: string;
  displayName: string;
  role: PlayerRole;
  agents: AgentName[];
  accent: string;
  tagline: string;
  playstyle: string;
  defaultEmoji: PlayerEmoji;
}

export interface MatchPerformance {
  playerId: string;
  agent: AgentName;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;
  adr: number;
  kast: number;
  headshotPercentage?: number;
  firstKills?: number;
  firstDeaths?: number;
  clutchAttempts?: number;
  clutchWins?: number;
  advancedMetrics?: AdvancedMetrics;
}

export interface MatchRecord {
  id: string;
  playedAt: string;
  map: MapName;
  gameMode: GameMode;
  opponent: string;
  scoreFor: number;
  scoreAgainst: number;
  won: boolean;
  durationMinutes: number;
  performances: MatchPerformance[];
}

export interface RawPlayerStats {
  playerId: string;
  matches: number;
  rounds: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;
  adr: number;
  kd: number;
  kpr: number;
  apr: number;
  kast: number;
  headshotPercentage?: number;
  firstKills?: number;
  firstDeaths?: number;
  fkFd?: number;
  clutchAttempts?: number;
  clutchWins?: number;
}

export type ScoreCategory =
  | 'overall'
  | 'firepower'
  | 'entry'
  | 'teamplay'
  | 'clutch'
  | 'consistency';

export interface PlayerScores {
  overall: number;
  firepower: number;
  entry: number;
  teamplay: number;
  clutch: number;
  consistency: number;
  confidence: number;
}

export interface RecentPerformance {
  matchId: string;
  playedAt: string;
  map: MapName;
  opponent: string;
  agent: AgentName;
  won: boolean;
  scoreFor: number;
  scoreAgainst: number;
  performance: MatchPerformance;
}

export interface PlayerAnalytics {
  player: Player;
  stats: RawPlayerStats;
  scores: PlayerScores;
  recent: RecentPerformance[];
}
