import type { MatchRecord } from '../../types/valorant.js';
import type { PerformanceEntry } from '../types.js';
import { resolveAdaptiveWindow, type RankEvidence } from './adaptiveWindow.js';
import { sampleOf, toObservation } from './observations.js';
import { policyFor } from './policies.js';
import type { FeatureId, PlayerScope, ScopeKind, ScopePopulation, ScopeReason, ScopeStatus, ScopeSummary } from './types.js';
import { ANALYSIS_SCOPE_VERSION, FEATURE_SCOPE_POLICY_VERSION } from './versions.js';
import { isAbsoluteStrengthMode, MODE_ELIGIBILITY_POLICY_VERSION } from '../modeEligibility.js';

/** Feature a request represents (before resolving), so its queue policy can be enforced up-front. */
function featureOf(request: ScopeRequest): FeatureId {
  if (request.choice === 'current') return 'currentStrength';
  if (request.choice === 'act') return 'actOverview';
  if (request.choice === 'recent10' || request.choice === 'recent30') return request.lifetimeFeature === 'matchHistory' ? 'matchHistory' : 'fixedRecent';
  return request.lifetimeFeature ?? 'lifetimeTotals';
}

const queueAllowed = (queues: 'all' | string[], mode: string) => queues === 'all' || queues.includes(mode);

/** User-facing scope choices. 'all' keeps its historical URL value and means 全部已追蹤. */
export type ScopeChoice = 'current' | 'all' | 'act' | 'recent10' | 'recent30' | 'custom';

export interface ScopeRequest {
  choice: ScopeChoice;
  act?: string;
  dateFrom?: string;
  dateTo?: string;
  gameMode: string;
  /** Which LIFETIME feature the page represents (lifetimeTotals, mapStats, agentStats, matchHistory). */
  lifetimeFeature?: FeatureId;
  rank?: RankEvidence;
}

export interface ScopedSelection {
  byPlayer: Map<string, PerformanceEntry[]>;
  summary: ScopeSummary;
}

/** Population facts derived from the analytics dataset itself (Demo, tests, or before view=analytics arrives). */
export function populationFromMatches(matches: MatchRecord[], complete: ScopePopulation['complete']): ScopePopulation {
  let anchor: string | undefined;
  let floor: string | undefined;
  // mode-eligibility-policy-v1: the adaptive anchor/floor come from absolute-strength (Competitive)
  // evidence only, so Unrated/entertainment activity can never shift a strength window's freshness.
  for (const match of matches) {
    if (!isAbsoluteStrengthMode(match.gameMode)) continue;
    if (!anchor || match.playedAt > anchor) anchor = match.playedAt;
    if (!floor || match.playedAt < floor) floor = match.playedAt;
  }
  const seasonKeys = [...new Set(matches.flatMap((match) => match.seasonKey ? [match.seasonKey] : []))].sort();
  const withSeason = matches.filter((match) => match.seasonKey).length;
  return {
    ...(anchor ? { anchor } : {}), ...(floor ? { floor } : {}), complete, seasonKeys,
    seasonStatus: withSeason === 0 ? 'unavailable' : withSeason === matches.length ? 'available' : 'partial',
    rankStatus: 'unavailable',
  };
}

function groupByPlayer(entries: PerformanceEntry[]): Map<string, PerformanceEntry[]> {
  const grouped = new Map<string, PerformanceEntry[]>();
  for (const entry of entries) grouped.set(entry.playerId, [...(grouped.get(entry.playerId) ?? []), entry]);
  return grouped;
}

/** Historical newest-first order of the explicit recent N filter (unchanged). */
const legacyOrder = (a: PerformanceEntry, b: PerformanceEntry) => b.match.playedAt.localeCompare(a.match.playedAt) || a.match.id.localeCompare(b.match.id);

function coverageStatus(population: ScopePopulation, reasons: Set<ScopeReason>): ScopeStatus {
  if (population.complete === false) { reasons.add('transport_window_truncated'); return 'partial'; }
  if (population.complete === 'unverified') { reasons.add('population_coverage_unverified'); return 'partial'; }
  return 'available';
}

/**
 * analysis-scope-v1: the single selection engine behind every analytics page. Context filters
 * (player/map/agent/role/queue) are applied BEFORE this function; it decides only the horizon.
 * No horizon ever falls back to another (ACT never becomes LIFETIME).
 */
export function resolveScopeSelection(contextualInput: PerformanceEntry[], request: ScopeRequest, population: ScopePopulation): ScopedSelection {
  const reasons = new Set<ScopeReason>();
  // mode-eligibility-policy-v1 (feature-scope-policy-v3): the feature's queue policy is applied BEFORE
  // every horizon. An explicitly requested ineligible mode never computes (all players unavailable).
  const queues = policyFor(featureOf(request)).queues;
  const modeExcluded = request.gameMode !== 'all' && !queueAllowed(queues, request.gameMode);
  if (modeExcluded) reasons.add('queue_excluded_by_policy');
  const contextual = modeExcluded ? [] : contextualInput.filter((entry) => queueAllowed(queues, entry.match.gameMode));
  if (queues !== 'all' && contextual.length < contextualInput.length) reasons.add('queue_restricted_by_policy');
  const grouped = groupByPlayer(modeExcluded ? contextualInput : contextual);
  const players = new Map<string, PlayerScope>();
  const byPlayer = new Map<string, PerformanceEntry[]>();
  let feature: FeatureId = request.lifetimeFeature ?? 'lifetimeTotals';
  let kind: ScopeKind = 'LIFETIME';
  let status: ScopeStatus = 'available';
  const record = (playerId: string, selected: PerformanceEntry[], playerStatus: ScopeStatus, playerReasons: ScopeReason[] = []) => {
    if (selected.length > 0 && playerStatus !== 'unavailable') byPlayer.set(playerId, selected);
    players.set(playerId, { playerId, status: selected.length === 0 ? 'unavailable' : playerStatus, sample: sampleOf(selected.map(toObservation)), reasons: playerReasons });
  };

  if (request.choice === 'current') {
    feature = 'currentStrength'; kind = 'ADAPTIVE';
    const policy = policyFor(feature);
    const excluded = modeExcluded;
    for (const [playerId, entries] of grouped) {
      if (excluded) { players.set(playerId, { playerId, status: 'unavailable', sample: sampleOf([]), reasons: ['queue_excluded_by_policy'] }); continue; }
      const window = resolveAdaptiveWindow(entries, policy, { population, ...(request.rank ? { rank: request.rank } : {}) });
      if (window.status !== 'unavailable') byPlayer.set(playerId, window.currentEntries);
      players.set(playerId, { playerId, status: window.status, sample: window.current, reasons: window.reasons, window });
    }
    const statuses = [...players.values()].map((item) => item.status);
    status = statuses.length === 0 || statuses.every((item) => item === 'unavailable') ? 'unavailable'
      : statuses.every((item) => item === 'available') ? 'available' : 'partial';
    if (population.seasonStatus === 'unavailable') reasons.add('season_evidence_unavailable');
    if (population.rankStatus !== 'available') reasons.add('rank_evidence_unavailable');
  } else if (modeExcluded) {
    feature = featureOf(request);
    kind = request.choice === 'act' ? 'ACT' : request.choice === 'recent10' || request.choice === 'recent30' ? 'RECENT' : 'LIFETIME';
    status = 'unavailable';
    for (const playerId of grouped.keys()) players.set(playerId, { playerId, status: 'unavailable', sample: sampleOf([]), reasons: ['queue_excluded_by_policy'] });
  } else if (request.choice === 'act') {
    feature = 'actOverview'; kind = 'ACT';
    if (!request.act || !population.seasonKeys.includes(request.act)) {
      reasons.add('season_evidence_unavailable');
      status = 'unavailable';
      for (const playerId of grouped.keys()) players.set(playerId, { playerId, status: 'unavailable', sample: sampleOf([]), reasons: ['season_evidence_unavailable'] });
    } else {
      status = coverageStatus(population, reasons);
      if (population.seasonStatus === 'partial') { reasons.add('season_evidence_partial'); status = 'partial'; }
      // Deterministic order independent of input order (server and browser must agree).
      for (const [playerId, entries] of grouped) record(playerId, [...entries].sort(legacyOrder).filter((entry) => entry.match.seasonKey === request.act), status);
    }
  } else if (request.choice === 'recent10' || request.choice === 'recent30') {
    feature = featureOf(request); kind = 'RECENT';
    const limit = request.choice === 'recent10' ? 10 : 30;
    for (const [playerId, entries] of grouped) record(playerId, [...entries].sort(legacyOrder).slice(0, limit), 'available');
  } else {
    status = coverageStatus(population, reasons);
    const inRange = (entry: PerformanceEntry) => {
      if (request.choice !== 'custom') return true;
      const day = entry.match.playedAt.slice(0, 10);
      return (!request.dateFrom || day >= request.dateFrom) && (!request.dateTo || day <= request.dateTo);
    };
    for (const [playerId, entries] of grouped) record(playerId, [...entries].sort(legacyOrder).filter(inRange), status);
  }

  // Players whose context evidence is entirely outside the queue policy stay listed (unavailable, with why).
  if (!modeExcluded && queues !== 'all') {
    for (const playerId of groupByPlayer(contextualInput).keys()) {
      if (!players.has(playerId)) players.set(playerId, { playerId, status: 'unavailable', sample: sampleOf([]), reasons: ['queue_restricted_by_policy'] });
    }
  }
  const selected = [...byPlayer.values()].flat();
  const policy = policyFor(feature);
  return {
    byPlayer,
    summary: {
      scopeRuleVersion: ANALYSIS_SCOPE_VERSION,
      featurePolicyVersion: FEATURE_SCOPE_POLICY_VERSION,
      modeEligibilityPolicyVersion: MODE_ELIGIBILITY_POLICY_VERSION,
      feature, kind, status,
      queues: policy.queues,
      ...(request.choice === 'act' && request.act ? { seasonKey: request.act } : {}),
      fallbackUsed: false,
      reasons: [...reasons].sort(),
      sample: sampleOf(selected.map(toObservation)),
      players,
    },
  };
}

/** PAIR horizon: one explicit match context shared by the pair sample and both baselines. */
export interface PairContext { act?: string; from?: string; to?: string; map: string; gameMode: string }

export function matchesInPairContext(matches: MatchRecord[], context: PairContext): MatchRecord[] {
  const seen = new Set<string>();
  // duo-synergy-v1 compares Overall across DIFFERENT matches, so it is an absolute-strength consumer:
  // Competitive only (mode-eligibility-policy-v1). An explicit ineligible mode yields no pair population.
  const queues = policyFor('synergy').queues;
  if (context.gameMode !== 'all' && !queueAllowed(queues, context.gameMode)) return [];
  return matches.filter((match) => {
    if (!queueAllowed(queues, match.gameMode)) return false;
    if (seen.has(match.id)) return false;
    seen.add(match.id);
    const date = match.playedAt.slice(0, 10);
    return (!context.act || match.seasonKey === context.act)
      && (!context.from || date >= context.from) && (!context.to || date <= context.to)
      && (context.map === 'all' || match.map === context.map) && (context.gameMode === 'all' || match.gameMode === context.gameMode);
  });
}
