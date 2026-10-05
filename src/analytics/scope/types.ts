import type { GameMode } from '../../types/valorant.js';
import type { PerformanceEntry } from '../types.js';
import type { ADAPTIVE_WINDOW_VERSION, ANALYSIS_SCOPE_VERSION, FEATURE_SCOPE_POLICY_VERSION } from './versions.js';

/** Semantic time horizon. Map/agent/role/queue/player are orthogonal context, never kinds. */
export type ScopeKind = 'LIFETIME' | 'ACT' | 'RECENT' | 'ADAPTIVE' | 'PAIR';
export type ScopeStatus = 'available' | 'partial' | 'unavailable';

export type FeatureId =
  | 'matchHistory' | 'lifetimeTotals' | 'agentStats' | 'mapStats' | 'actOverview'
  | 'currentStrength' | 'recentForm' | 'fixedRecent' | 'trends'
  | 'synergy' | 'improvementIndex';

/** Explicit, machine-readable reasons; UI translates them. */
export type ScopeReason =
  | 'target_rounds_reached' | 'target_matches_reached' | 'max_matches_reached'
  | 'minimum_sample_reached' | 'minimum_active_days_reached' | 'time_span_cap_reached'
  | 'lookback_exhausted' | 'act_boundary_respected' | 'season_evidence_unavailable'
  | 'season_evidence_partial' | 'rank_evidence_unavailable' | 'rank_boundary_respected'
  | 'insufficient_sample' | 'insufficient_active_days' | 'insufficient_baseline'
  | 'queue_restricted_by_policy' | 'queue_excluded_by_policy' | 'transport_window_truncated'
  | 'population_coverage_unverified' | 'no_matching_evidence' | 'season_crossed_in_baseline'
  | 'stale_recent_evidence';

export interface WindowSample {
  matches: number;
  rounds: number;
  minutes: number;
  activeDays: number;
  spanDays: number;
  from?: string;
  to?: string;
  seasons: string[];
}

export interface WindowConfidence {
  /** sqrt(min(matches/target,1) * min(rounds/target,1)); mirrors community-score confidence shape. */
  sample: number;
  /** min(activeDays/targetActiveDays,1) * freshness relative to the population anchor. */
  temporal: number;
  /** Selected rounds whose KAST/Opening evidence is reconstructed (or legacy-complete). */
  evidence: number;
  /** Geometric mean of the three; never multiplied into any score. */
  overall: number;
}

export interface AdaptiveWindowResult {
  ruleVersion: typeof ADAPTIVE_WINDOW_VERSION;
  purpose: FeatureId;
  status: ScopeStatus;
  current: WindowSample;
  baseline?: WindowSample & { status: ScopeStatus };
  boundaries: { seasonCrossed: boolean; seasonEvidence: ScopeStatus; rankBoundaryUsed: boolean; rankEvidence: ScopeStatus };
  confidence: WindowConfidence;
  reasons: ScopeReason[];
  /** Entries in deterministic newest-first order; never serialized to the server. */
  currentEntries: PerformanceEntry[];
  baselineEntries: PerformanceEntry[];
}

/** Population facts that keep scope labels truthful (from view=analytics or Demo). */
export interface ScopePopulation {
  /** Deterministic recency anchor: newest playedAt in the analytics population (never wall clock). */
  anchor?: string;
  /** Oldest playedAt in the analytics population; older evidence may exist only if incomplete. */
  floor?: string;
  /** true: the browser population holds every eligible tracked match. */
  complete: boolean | 'unverified';
  seasonKeys: string[];
  seasonStatus: ScopeStatus;
  rankStatus: ScopeStatus;
}

export interface PlayerScope {
  playerId: string;
  status: ScopeStatus;
  sample: WindowSample;
  reasons: ScopeReason[];
  window?: AdaptiveWindowResult;
}

export interface ScopeSummary {
  scopeRuleVersion: typeof ANALYSIS_SCOPE_VERSION;
  featurePolicyVersion: typeof FEATURE_SCOPE_POLICY_VERSION;
  feature: FeatureId;
  kind: ScopeKind;
  status: ScopeStatus;
  queues: 'all' | GameMode[];
  seasonKey?: string;
  fallbackUsed: false;
  reasons: ScopeReason[];
  sample: WindowSample;
  players: Map<string, PlayerScope>;
}
