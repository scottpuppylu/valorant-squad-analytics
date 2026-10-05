import type { ScoreResult } from '../scoring/types';
export type ScoreStatus = ScoreResult['status'];
import type { Player, PlayerRole } from '../types/valorant';

/** PAIR context (feature-scope-policy-v1 `synergy`): optional public Act key plus date/map/mode. */
export interface SynergyFilters { from: string; to: string; map: string; gameMode: string; minimumShared: number; act?: string }
export interface PairWindow {
  matches: number; rounds: number; overall: ScoreResult;
  kast?: number; kastStatus: ScoreStatus; winRate?: number; winRateStatus: ScoreStatus;
}
export interface PairMember {
  player: Player; paired: PairWindow; baseline: PairWindow;
  overallLift?: number; kastLift?: number; agent?: string; role?: PlayerRole;
}
export type SynergyComponentKey = 'overall' | 'kast' | 'winRate';
export interface SynergyComponent {
  key: SynergyComponentKey; status: ScoreStatus; rawDelta?: number; shrunkDelta?: number;
  normalized?: number; configuredWeight: number; usedWeight: number;
  range: number; omission?: string;
}
export interface SynergyIndex {
  status: ScoreStatus; value?: number; confidence: number; coverage: number; shrinkFactor: number;
  components: SynergyComponent[]; omissions: string[];
}
export interface DuoSynergyResult extends SynergyIndex {
  pair: { key: string; playerAId: string; playerBId: string };
  sharedSample: { matches: number; rounds: number; wins?: number; winRate?: number; opponentMatches: number };
  playerA: PairMember; playerB: PairMember;
  tradeEvidence: { status: ScoreStatus; reconstructedRounds: number; aTradedBDeaths?: number; bTradedADeaths?: number; directPairTrades?: number; rate?: number };
  trace: { sharedMatches: number; baselineA: number; baselineB: number; baselineWinRate?: number; priorStrength: number; componentWeightGate: number; index: SynergyIndex };
  ruleVersion: string; benchmarkVersion: string;
}
