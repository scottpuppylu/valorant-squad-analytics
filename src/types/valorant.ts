import type { PlayerEmoji } from './avatar';
import type { ScoreResult } from '../scoring/types';
import type { Dimension } from '../scoring/versions';
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
  teamGroup?: 'A' | 'B';
  teamWon?: boolean;
  teamRoundsWon?: number;
  teamRoundsLost?: number;
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
  synergyEvidence?: MatchPairTradeEvidence;
}

/** Only publicly visible same-team members; never an event timeline. */
export interface PairTradeEvidence {
  playerAId: string;
  playerBId: string;
  ruleVersion: 'event-metrics-v1';
  status: 'reconstructed' | 'partial' | 'unavailable';
  reconstructedRounds: number;
  aTradedBDeaths?: number;
  bTradedADeaths?: number;
}

export interface MatchPairTradeEvidence {
  ruleVersion: 'event-metrics-v1';
  status: 'reconstructed' | 'partial' | 'unavailable';
  reconstructedRounds: number;
  /** Indices refer only to this match's public performances; absent counters mean missing. */
  pairs: ([aIndex: number, bIndex: number] | [aIndex: number, bIndex: number, aTradedB: number, bTradedA: number])[];
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
  kd?: number;
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

export type ScoreCategory = 'overall' | Dimension;
export type PlayerScores = Record<ScoreCategory, ScoreResult> & { confidence: number };

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
