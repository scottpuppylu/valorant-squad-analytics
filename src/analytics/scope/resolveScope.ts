import type { MatchRecord } from '../../types/valorant.js';
import type { PerformanceEntry } from '../types.js';
import { resolveAdaptiveWindow, type RankEvidence } from './adaptiveWindow.js';
import { sampleOf, toObservation } from './observations.js';
import { policyFor } from './policies.js';
import type { FeatureId, PlayerScope, ScopeKind, ScopePopulation, ScopeReason, ScopeStatus, ScopeSummary } from './types.js';
import { ANALYSIS_SCOPE_VERSION, FEATURE_SCOPE_POLICY_VERSION } from './versions.js';

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
  for (const match of matches) {
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
export function resolveScopeSelection(contextual: PerformanceEntry[], request: ScopeRequest, population: ScopePopulation): ScopedSelection {
  const reasons = new Set<ScopeReason>();
  const grouped = groupByPlayer(contextual);
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
    const excluded = request.gameMode !== 'all' && policy.queues !== 'all' && !policy.queues.includes(request.gameMode);
    if (excluded) reasons.add('queue_excluded_by_policy');
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
  } else if (request.choice === 'act') {
    feature = 'actOverview'; kind = 'ACT';
    if (!request.act || !population.seasonKeys.includes(request.act)) {
      reasons.add('season_evidence_unavailable');
      status = 'unavailable';
      for (const playerId of grouped.keys()) players.set(playerId, { playerId, status: 'unavailable', sample: sampleOf([]), reasons: ['season_evidence_unavailable'] });
    } else {
      status = coverageStatus(population, reasons);
      if (population.seasonStatus === 'partial') { reasons.add('season_evidence_partial'); status = 'partial'; }
      for (const [playerId, entries] of grouped) record(playerId, entries.filter((entry) => entry.match.seasonKey === request.act), status);
    }
  } else if (request.choice === 'recent10' || request.choice === 'recent30') {
    feature = 'fixedRecent'; kind = 'RECENT';
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

  const selected = [...byPlayer.values()].flat();
  const policy = policyFor(feature);
  return {
    byPlayer,
    summary: {
      scopeRuleVersion: ANALYSIS_SCOPE_VERSION,
      featurePolicyVersion: FEATURE_SCOPE_POLICY_VERSION,
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
  return matches.filter((match) => {
    if (seen.has(match.id)) return false;
    seen.add(match.id);
    const date = match.playedAt.slice(0, 10);
    return (!context.act || match.seasonKey === context.act)
      && (!context.from || date >= context.from) && (!context.to || date <= context.to)
      && (context.map === 'all' || match.map === context.map) && (context.gameMode === 'all' || match.gameMode === context.gameMode);
  });
}
