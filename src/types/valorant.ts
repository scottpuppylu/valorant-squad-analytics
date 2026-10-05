import type { PlayerEmoji } from './avatar';
import type { ScoreResult } from '../scoring/types';
import type { Dimension } from '../scoring/versions';
import type { AdvancedMetrics } from './advancedMetrics';

export type PlayerRole = 'Duelist' | 'Initiator' | 'Controller' | 'Sentinel';

export type AgentName = string;

export type MapName = string;

export type GameMode = string;

/**
 * TASK-IDENTITY-01 (member-identity-v1): a public `Player` is a MEMBER — a real person in the group —
 * not a Riot account. `id` is the member public id; `handle`/`displayName` are the member (community)
 * name, never `RiotName#Tag`. Riot accounts are listed in `accounts`.
 */
export interface PublicAccount {
  /** Public ACCOUNT id (used by account-scoped sync); never a member id. */
  id: string;
  gameName: string;
  tag: string;
  isPrimary: boolean;
  label?: string;
}

export interface Player {
  id: string;
  handle: string;
  displayName: string;
  /** 'legacy_account' = migrated fallback from the account name; 'community' = maintainer-assigned. */
  nameSource?: 'legacy_account' | 'community';
  /** TASK-IDENTITY-01B: optional second name / nickname of the PERSON. Presentation only — never an id. */
  nickname?: string;
  /** Currently public accounts of this member (REAL); fictional accounts in Demo. */
  accounts?: PublicAccount[];
  role: PlayerRole;
  agents: AgentName[];
  accent: string;
  tagline: string;
  playstyle: string;
  defaultEmoji: PlayerEmoji;
}

export interface MatchPerformance {
  /** Member public id (the person). */
  playerId: string;
  /** Public account id that actually played this match (metadata; analytics aggregate by member). */
  accountId?: string;
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
  kast?: number;
  eventEvidence?: {
    kast: 'reconstructed' | 'partial' | 'unavailable';
    opening: 'reconstructed' | 'partial' | 'unavailable';
  };
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
  /** Optional public Act key (e.g. "e9a3") only when durable season evidence exists. */
  seasonKey?: string;
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
  kast?: number;
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
