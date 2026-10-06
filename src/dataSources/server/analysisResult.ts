import { createPerformanceEntries } from '../../analytics/filters';
import type { AnalysisFilters, PerformanceEntry, SelectionResult } from '../../analytics/types';
import type { AdaptiveWindowResult, FeatureId, PlayerScope, ScopeSummary, ScopeStatus, WindowSample } from '../../analytics/scope/types';
import type { NormalizedAnalyticsDataset } from '../types';
import type { DatasetEvidenceContract } from './contracts';
import { isRealDataset } from './datasetContract';
import type { ActPolicy, ProgressWindows } from '../../analytics/progress/windows';
import { SELECTION_SUMMARY_VERSION, type SelectionSummary } from '../../analytics/summary';
import type { DuoSynergyResult } from '../../synergy/types';

/**
 * `view=analysis` contract. TASK-DATA-03B.2C `server-analysis-v2`: the server aggregates the FULL
 * feature population (no match-count cap) and returns a selection-summary-v1 / duo-synergy-v1 result;
 * `dataset.matches` holds only the matches referenced by bounded windows (forms/adaptive/progress).
 */
export type AnalysisFeature = 'currentStrength' | 'lifetimeTotals' | 'mapStats' | 'agentStats' | 'actOverview' | 'fixedRecent' | 'synergy' | 'improvementIndex';

export interface AnalysisQuery {
  feature: AnalysisFeature;
  recent?: 10 | 30;
  act?: string;
  from?: string;
  to?: string;
  map?: string;
  agent?: string;
  role?: string;
  mode?: string;
  player?: string;
  form?: boolean;
}

export interface SerializedWindow extends Omit<AdaptiveWindowResult, 'currentEntries' | 'baselineEntries'> {
  currentMatchIds: string[];
  baselineMatchIds: string[];
}

export type SerializedScope = Omit<ScopeSummary, 'players'> & { players: (Omit<PlayerScope, 'window'> & { window?: SerializedWindow })[] };

export interface DatasetAnalysisResponse {
  ok: true;
  schemaVersion: 6;
  view: 'analysis';
  analysisVersion: 'server-analysis-v2';
  scopeRuleVersion: 'analysis-scope-v1';
  featurePolicyVersion: 'feature-scope-policy-v2';
  adaptiveWindowVersion: 'adaptive-window-v1';
  scoreVersion: 'community-score-v2';
  synergyVersion?: 'duo-synergy-v1';
  feature: AnalysisFeature;
  status: ScopeStatus;
  reasons: string[];
  coverage: {
    trackedMatchCount: number;
    /** True only when every selected match of the feature population was processed with full evidence. */
    populationComplete: boolean;
    /** Matches the feature population aggregated (policy-bounded features stay bounded by policy). */
    populationMatches: number;
    serverHistoryUsed: true;
    transportSnapshotUsed: false;
    /** No implementation match-count limit (was 2000 in server-analysis-v1). */
    populationLimit: null;
    lifetimeComplete: false;
  };
  population: { anchor?: string; floor?: string; seasonKeys: string[]; seasonStatus: ScopeStatus; rankStatus: ScopeStatus };
  scope?: SerializedScope;
  /** Scope features (not synergy / improvementIndex): aggregates of the full population. */
  summary?: SelectionSummary;
  /** Synergy: duo-synergy-v1 results over the full pair population. */
  synergy?: DuoSynergyResult[];
  forms?: { playerId: string; window: SerializedWindow }[];
  /** TASK-PROGRESS-01: server-resolved improvement windows (current + strictly older baseline). */
  progress?: { playerId: string; actPolicy: ActPolicy; window: SerializedWindow }[];
  improvementVersion?: 'improvement-index-v1';
  evidence: DatasetEvidenceContract;
  dataset: NormalizedAnalyticsDataset;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const ids = (value: unknown, known: Set<string>) => Array.isArray(value) && value.every((id) => typeof id === 'string' && known.has(id));

const summaryOk = (summary: unknown, playerIds: Set<string>) => summary === undefined || (isRecord(summary)
  && summary.summaryVersion === SELECTION_SUMMARY_VERSION && typeof summary.entryCount === 'number' && Number.isSafeInteger(summary.entryCount)
  && Array.isArray(summary.analytics) && summary.analytics.every((item) => isRecord(item) && isRecord(item.player) && playerIds.has(item.player.id as string))
  && isRecord(summary.groups) && Array.isArray(summary.players) && isRecord(summary.mapTopDimension));

/** Rejects lifetime claims, transport-snapshot results, capped populations and windows pointing outside the payload. */
export function isDatasetAnalysisResponse(value: unknown): value is DatasetAnalysisResponse {
  if (!isRecord(value)) return false;
  const c = value as Partial<DatasetAnalysisResponse>;
  if (!(c.ok === true && c.schemaVersion === 6 && c.view === 'analysis' && c.analysisVersion === 'server-analysis-v2'
    && c.scopeRuleVersion === 'analysis-scope-v1' && c.featurePolicyVersion === 'feature-scope-policy-v2'
    && c.adaptiveWindowVersion === 'adaptive-window-v1' && c.scoreVersion === 'community-score-v2'
    && isRecord(c.coverage) && c.coverage.lifetimeComplete === false && c.coverage.serverHistoryUsed === true
    && c.coverage.transportSnapshotUsed === false && c.coverage.populationLimit === null && typeof c.coverage.populationComplete === 'boolean'
    && isRecord(c.population) && Array.isArray(c.population.seasonKeys)
    && (c.synergy === undefined || Array.isArray(c.synergy)) && isRealDataset(c.dataset))) return false;
  const matchIds = new Set(c.dataset!.matches.map((match) => match.id));
  const playerIds = new Set(c.dataset!.players.map((player) => player.id));
  return summaryOk(c.summary, playerIds)
    && (c.forms === undefined || (Array.isArray(c.forms) && c.forms.every((form) => isRecord(form) && isRecord(form.window)
      && ids(form.window.currentMatchIds, matchIds) && ids(form.window.baselineMatchIds, matchIds))))
    && (c.progress === undefined || (Array.isArray(c.progress) && c.progress.every((item) => isRecord(item) && playerIds.has(item.playerId)
      && ['same_act', 'previous_act_fallback', 'act_unknown'].includes(item.actPolicy) && isRecord(item.window)
      && ids(item.window.currentMatchIds, matchIds) && ids(item.window.baselineMatchIds, matchIds))));
}

function entryIndex(dataset: NormalizedAnalyticsDataset): Map<string, PerformanceEntry> {
  return new Map(createPerformanceEntries(dataset).map((entry) => [`${entry.match.id}|${entry.playerId}`, entry]));
}

function hydrateWindow(window: SerializedWindow, playerId: string, index: Map<string, PerformanceEntry>): AdaptiveWindowResult {
  const { currentMatchIds, baselineMatchIds, ...rest } = window;
  const pick = (list: string[]) => list.flatMap((id) => index.get(`${id}|${playerId}`) ?? []);
  return { ...rest, currentEntries: pick(currentMatchIds), baselineEntries: pick(baselineMatchIds) };
}

/**
 * server-analysis-v2: the population itself is NOT shipped (its aggregates are in `summary`), so the
 * SelectionResult carries only the scope with hydrated bounded windows; entries stay empty.
 */
export function selectionFromAnalysis(response: DatasetAnalysisResponse): SelectionResult {
  const index = entryIndex(response.dataset);
  const byPlayer = new Map<string, PerformanceEntry[]>();
  const entries: PerformanceEntry[] = [];
  const scope: ScopeSummary | undefined = response.scope ? {
    ...response.scope,
    players: new Map(response.scope.players.map(({ window, ...player }): [string, PlayerScope] => [player.playerId, {
      ...player, sample: player.sample as WindowSample,
      ...(window ? { window: hydrateWindow(window, player.playerId, index) } : {}),
    }])),
  } : undefined;
  return { entries, byPlayer, ...(scope ? { scope } : {}) };
}

/** Server-resolved improvement windows, hydrated with the payload's full entries. */
export function progressFromAnalysis(response: DatasetAnalysisResponse): Map<string, ProgressWindows> {
  const index = entryIndex(response.dataset);
  return new Map((response.progress ?? []).map((item) => [item.playerId, { actPolicy: item.actPolicy, window: hydrateWindow(item.window, item.playerId, index) }]));
}

/** Server-resolved recentForm windows, hydrated with the payload's full entries. */
export function formWindowsFromAnalysis(response: DatasetAnalysisResponse): Map<string, AdaptiveWindowResult> {
  const index = entryIndex(response.dataset);
  return new Map((response.forms ?? []).map((form) => [form.playerId, hydrateWindow(form.window, form.playerId, index)]));
}

export type LifetimeFeature = Extract<FeatureId, 'lifetimeTotals' | 'mapStats' | 'agentStats'>;

/** Maps a page's filters to the server feature request; the server registry decides the population. */
export function analysisQueryFor(filters: AnalysisFilters, lifetimeFeature: LifetimeFeature, form: boolean): AnalysisQuery | undefined {
  const context = { map: filters.map, agent: filters.agent, role: filters.role, mode: filters.gameMode, player: filters.playerId, ...(form ? { form: true } : {}) };
  switch (filters.period) {
    case 'current': return { feature: 'currentStrength', ...context };
    case 'act': return filters.act ? { feature: 'actOverview', act: filters.act, ...context } : undefined;
    case 'recent10': return { feature: 'fixedRecent', recent: 10, ...context };
    case 'recent30': return { feature: 'fixedRecent', recent: 30, ...context };
    case 'custom': return { feature: lifetimeFeature, ...(filters.dateFrom ? { from: filters.dateFrom } : {}), ...(filters.dateTo ? { to: filters.dateTo } : {}), ...context };
    default: return { feature: lifetimeFeature, ...context };
  }
}

