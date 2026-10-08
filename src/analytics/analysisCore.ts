import { createPerformanceEntries, defaultAnalysisFilters, selectPerformances } from './filters.js';
import type { AnalysisFilters, PerformanceEntry, SelectionResult } from './types.js';
import { resolveAdaptiveWindow } from './scope/adaptiveWindow.js';
import { policyFor } from './scope/policies.js';
import { matchesInPairContext, populationFromMatches } from './scope/resolveScope.js';
import { resolveProgressWindows } from './progress/windows.js';
import type { AdaptiveWindowResult, ScopePopulation, ScopeStatus, ScopeSummary } from './scope/types.js';
import { ADAPTIVE_WINDOW_VERSION, ANALYSIS_SCOPE_VERSION, FEATURE_SCOPE_POLICY_VERSION } from './scope/versions.js';
import { summarizeSelection } from './summary.js';
import { MODE_ELIGIBILITY_POLICY_VERSION } from './modeEligibility.js';
import { buildSynergy, defaultSynergyFilters } from '../synergy/analytics.js';
import type { MatchRecord, Player } from '../types/valorant.js';
import type { DatasetEvidenceContract } from '../dataSources/server/contracts.js';

/**
 * `view=analysis` CORE (server-analysis-v2), shared verbatim by the server (ServerAnalysisService) and the static
 * read model's browser query engine (TASK-INFRA-STATIC-QUERY-PARITY-01). It contains every DB-free step:
 *   population → phase-1 selection of the match ids that need full evidence → final selection, scope,
 *   summary / synergy / forms / progress → the exact public payload.
 * Only the data loading differs: the server reads skeletons and full records from PostgreSQL, the browser
 * reads the same records from public static facts. There is no second implementation of any formula.
 */
export const SERVER_ANALYSIS_VERSION = 'server-analysis-v2' as const;

export const analysisFeatures = ['currentStrength', 'lifetimeTotals', 'mapStats', 'agentStats', 'actOverview', 'fixedRecent', 'synergy', 'improvementIndex'] as const;
export type AnalysisFeature = (typeof analysisFeatures)[number];

export interface AnalysisRequest {
  feature: AnalysisFeature;
  recent?: 10 | 30;
  act?: string;
  from?: string;
  to?: string;
  map: string;
  agent: string;
  role: string;
  mode: string;
  player: string;
  form: boolean;
}

/** The same AnalysisFilters a browser page builds for this feature/context. */
export function filtersFor(request: AnalysisRequest): AnalysisFilters {
  const period: AnalysisFilters['period'] = request.feature === 'currentStrength' ? 'current'
    : request.feature === 'actOverview' ? 'act'
      : request.feature === 'fixedRecent' ? (request.recent === 10 ? 'recent10' : 'recent30')
        : request.from || request.to ? 'custom' : 'all';
  return {
    ...defaultAnalysisFilters, period,
    ...(request.act ? { act: request.act } : {}), ...(request.from ? { dateFrom: request.from } : {}), ...(request.to ? { dateTo: request.to } : {}),
    playerId: request.player, map: request.map, agent: request.agent, role: request.role as AnalysisFilters['role'], gameMode: request.mode,
  };
}

export interface SerializedWindow extends Omit<AdaptiveWindowResult, 'currentEntries' | 'baselineEntries'> {
  currentMatchIds: string[];
  baselineMatchIds: string[];
}

export function serializeWindow(window: AdaptiveWindowResult): SerializedWindow {
  const { currentEntries, baselineEntries, ...rest } = window;
  return { ...rest, currentMatchIds: currentEntries.map((entry) => entry.match.id), baselineMatchIds: baselineEntries.map((entry) => entry.match.id) };
}

export function serializeScope(summary: ScopeSummary) {
  const { players, ...rest } = summary;
  return { ...rest, players: [...players.values()].map(({ window, ...player }) => ({ ...player, ...(window ? { window: serializeWindow(window) } : {}) })) };
}

/** Same SelectionResult the browser rebuilt from a v1 payload (byPlayer order, entries playedAt desc). */
export function selectionOf(byPlayer: Map<string, PerformanceEntry[]>): SelectionResult {
  const entries = [...byPlayer.values()].flat()
    .sort((a, b) => b.match.playedAt.localeCompare(a.match.playedAt) || a.playerId.localeCompare(b.playerId));
  return { entries, byPlayer };
}

export interface PopulationEvidence { acts: string[]; seasonStatus: ScopeStatus; rankStatus: ScopeStatus }

/** Scope population over ALL eligible skeletons plus the aggregate Act/rank evidence (view=analytics). */
export function analysisPopulation(skeletons: MatchRecord[], evidence: PopulationEvidence): ScopePopulation {
  const base = populationFromMatches(skeletons, true);
  return {
    ...base,
    seasonKeys: [...new Set([...populationFromMatches(skeletons, true).seasonKeys, ...evidence.acts])].sort(),
    seasonStatus: evidence.seasonStatus,
    rankStatus: evidence.rankStatus,
  };
}

const dataset = (matches: MatchRecord[], players: Player[]) => ({ players, matches, sourceId: 'durable-neon-v4', isDemo: false as const, mode: 'REAL' as const });
const lifetimeFeatureOf = (request: AnalysisRequest) => (request.feature === 'mapStats' || request.feature === 'agentStats' ? request.feature : 'lifetimeTotals');

/** Phase-1 resolution over skeletons: the match ids whose full evidence the feature population needs. */
export function resolveAnalysisMatchIds(request: AnalysisRequest, skeletons: MatchRecord[], skeletonPlayers: Player[], population: ScopePopulation): Set<string> {
  const filters = filtersFor(request);
  if (request.feature === 'improvementIndex') {
    // Bounded by policy: only each player's current + baseline windows reach phase 2.
    const selected = new Set<string>();
    const contextual = selectPerformances(createPerformanceEntries(dataset(skeletons, skeletonPlayers)), filters, { population });
    for (const entries of contextual.byPlayer.values()) {
      const { window } = resolveProgressWindows(entries, population);
      for (const entry of [...window.currentEntries, ...window.baselineEntries]) selected.add(entry.match.id);
    }
    return selected;
  }
  if (request.feature === 'synergy') {
    return new Set(matchesInPairContext(skeletons, { map: request.map, gameMode: request.mode, ...(request.act ? { act: request.act } : {}), ...(request.from ? { from: request.from } : {}), ...(request.to ? { to: request.to } : {}) }).map((match) => match.id));
  }
  const skeletonEntries = createPerformanceEntries(dataset(skeletons, skeletonPlayers));
  const first = selectPerformances(skeletonEntries, filters, { population, lifetimeFeature: lifetimeFeatureOf(request) });
  const ids = [...new Set(first.entries.map((entry) => entry.match.id))];
  // Every adaptive window (even an unavailable one) needs real evidence for its confidence.
  for (const player of first.scope?.players.values() ?? []) for (const entry of player.window?.currentEntries ?? []) ids.push(entry.match.id);
  if (request.form) {
    const contextual = selectPerformances(skeletonEntries, { ...filters, period: 'all' }, { population });
    for (const entries of contextual.byPlayer.values()) {
      const window = resolveAdaptiveWindow(entries, policyFor('recentForm'), { population });
      for (const entry of [...window.currentEntries, ...window.baselineEntries]) ids.push(entry.match.id);
    }
  }
  return new Set(ids);
}

export interface FinalizeAnalysisInput {
  request: AnalysisRequest;
  skeletons: MatchRecord[];
  /** Full records of the selected matches only (exactly what phase 2 loaded). */
  full: Map<string, MatchRecord>;
  selectedIds: Set<string>;
  players: Player[];
  population: ScopePopulation;
  trackedMatchCount: number;
  availability: DatasetEvidenceContract;
}

/** Final resolution with full entries swapped in, and the exact public `view=analysis` payload. */
export function finalizeAnalysis(input: FinalizeAnalysisInput) {
  const { request, skeletons, full, selectedIds, players, population } = input;
  const filters = filtersFor(request);
  const lifetimeFeature = lifetimeFeatureOf(request);
  // populationComplete describes evidence reality: every selected match reached full projection.
  const populationComplete = [...selectedIds].every((id) => full.has(id));
  const merged = skeletons.map((match) => full.get(match.id) ?? match);
  let scope;
  let forms;
  let summary;
  let synergy;
  /** Matches the bounded windows reference (policy-bounded); never the whole population. */
  const windowIds = new Set<string>();
  const keepWindow = <W extends { currentMatchIds: string[]; baselineMatchIds: string[] }>(window: W): W => {
    for (const id of [...window.currentMatchIds, ...window.baselineMatchIds]) windowIds.add(id);
    return window;
  };
  /** Member -> match ids of the feature population (weapon CURRENT); never serialized. */
  const selection: Record<string, string[]> = {};
  let progress;
  if (request.feature === 'improvementIndex') {
    const contextual = selectPerformances(createPerformanceEntries(dataset(merged, players)), filters, { population });
    progress = [...contextual.byPlayer].map(([playerId, entries]) => {
      const resolved = resolveProgressWindows(entries, population);
      // Only entries whose evidence phase 2 loaded may be scored (never a skeleton).
      const loaded = [...resolved.window.currentEntries, ...resolved.window.baselineEntries].every((entry) => full.has(entry.match.id));
      return { playerId, actPolicy: resolved.actPolicy, window: serializeWindow(resolved.window), complete: loaded };
    }).filter((item) => item.complete).map((item) => ({ playerId: item.playerId, actPolicy: item.actPolicy, window: keepWindow(item.window) }));
  } else if (request.feature === 'synergy') {
    // duo-synergy-v1 unchanged over the full pair population (results only).
    const pairMatches = [...selectedIds].flatMap((id) => full.get(id) ?? [])
      .sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
    synergy = buildSynergy(dataset(pairMatches, players), { ...defaultSynergyFilters, map: request.map, gameMode: request.mode,
      from: request.from ?? '', to: request.to ?? '', ...(request.act ? { act: request.act } : {}) });
  } else {
    const entries = createPerformanceEntries(dataset(merged, players));
    const final = selectPerformances(entries, filters, { population, lifetimeFeature });
    const kept = new Map<string, PerformanceEntry[]>();
    for (const [playerId, playerEntries] of final.byPlayer) {
      const loaded = playerEntries.filter((entry) => full.has(entry.match.id));
      if (loaded.length) kept.set(playerId, loaded);
    }
    for (const [playerId, loaded] of kept) selection[playerId] = loaded.map((entry) => entry.match.id);
    summary = summarizeSelection(selectionOf(kept));
    scope = serializeScope(final.scope!);
    for (const player of scope.players) if (player.window) keepWindow(player.window);
    if (request.form) {
      const contextual = selectPerformances(entries, { ...filters, period: 'all' }, { population });
      forms = [...contextual.byPlayer].map(([playerId, playerEntries]) => ({ playerId, window: keepWindow(serializeWindow(resolveAdaptiveWindow(playerEntries, policyFor('recentForm'), { population }))) }));
    }
  }
  const matches = [...windowIds].flatMap((id) => full.get(id) ?? []).sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
  const payload = {
    ok: true as const,
    schemaVersion: 6 as const,
    view: 'analysis' as const,
    analysisVersion: SERVER_ANALYSIS_VERSION,
    scopeRuleVersion: ANALYSIS_SCOPE_VERSION,
    featurePolicyVersion: FEATURE_SCOPE_POLICY_VERSION,
    /** TASK-DATA-MODE-POLICY-01: additive; strength populations are Competitive only. */
    modeEligibilityPolicyVersion: MODE_ELIGIBILITY_POLICY_VERSION,
    adaptiveWindowVersion: ADAPTIVE_WINDOW_VERSION,
    scoreVersion: 'community-score-v2' as const,
    ...(request.feature === 'synergy' ? { synergyVersion: 'duo-synergy-v1' as const } : {}),
    feature: request.feature,
    status: populationComplete ? 'available' as const : 'partial' as const,
    reasons: populationComplete ? [] : ['population_incomplete' as const],
    coverage: {
      trackedMatchCount: input.trackedMatchCount,
      /** Every selected match of the feature population was processed with full evidence. */
      populationComplete,
      /** Matches the feature population aggregated (policy-bounded features stay bounded by policy). */
      populationMatches: selectedIds.size,
      serverHistoryUsed: true as const,
      transportSnapshotUsed: false as const,
      /** server-analysis-v2 has no implementation match-count limit. */
      populationLimit: null,
      lifetimeComplete: false as const,
    },
    population: { ...(population.anchor ? { anchor: population.anchor } : {}), ...(population.floor ? { floor: population.floor } : {}),
      seasonKeys: population.seasonKeys, seasonStatus: population.seasonStatus, rankStatus: population.rankStatus },
    ...(scope ? { scope } : {}),
    ...(summary ? { summary } : {}),
    ...(synergy ? { synergy } : {}),
    ...(forms ? { forms } : {}),
    ...(progress ? { progress, improvementVersion: 'improvement-index-v1' as const } : {}),
    evidence: input.availability,
    /** Only matches referenced by bounded windows (forms/adaptive/progress); never the population. */
    dataset: dataset(matches, players),
  };
  return { payload, selection, shippedMatches: matches.length };
}

/** Evidence availability of a set of assembled matches: AND of their per-match flags (all complete when empty). */
export function availabilityOf(flags: Iterable<{ round: boolean; headshot: boolean }>): DatasetEvidenceContract {
  let round = true;
  let headshot = true;
  for (const flag of flags) { if (!flag.round) round = false; if (!flag.headshot) headshot = false; }
  return {
    acs: 'derived', adr: 'derived',
    headshotPercentage: headshot ? 'derived' : 'partial',
    kast: round ? 'reconstructed' : 'partial',
    firstKills: round ? 'reconstructed' : 'partial',
    firstDeaths: round ? 'reconstructed' : 'partial',
  };
}
