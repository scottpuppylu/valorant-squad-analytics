import { createPerformanceEntries } from '../../analytics/filters';
import type { PerformanceEntry, SelectionResult } from '../../analytics/types';
import type { AdaptiveWindowResult, PlayerScope, ScopeSummary, ScopeStatus, WindowSample } from '../../analytics/scope/types';
import type { NormalizedAnalyticsDataset } from '../types';
import type { DatasetEvidenceContract } from './contracts';
import { isRealDataset } from './datasetContract';

/** DATA-03B.2B `view=analysis` contract (`server-analysis-v1`). */
export type AnalysisFeature = 'currentStrength' | 'lifetimeTotals' | 'mapStats' | 'agentStats' | 'actOverview' | 'fixedRecent' | 'synergy';

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
  schemaVersion: 4;
  view: 'analysis';
  analysisVersion: 'server-analysis-v1';
  scopeRuleVersion: 'analysis-scope-v1';
  featurePolicyVersion: 'feature-scope-policy-v1';
  adaptiveWindowVersion: 'adaptive-window-v1';
  scoreVersion: 'community-score-v2';
  synergyVersion?: 'duo-synergy-v1';
  feature: AnalysisFeature;
  status: ScopeStatus;
  reasons: string[];
  coverage: { trackedMatchCount: number; populationComplete: true; serverHistoryUsed: true; transportSnapshotUsed: false; populationLimit: number; lifetimeComplete: false };
  population: { anchor?: string; floor?: string; seasonKeys: string[]; seasonStatus: ScopeStatus; rankStatus: ScopeStatus };
  scope?: SerializedScope;
  selection: Record<string, string[]>;
  forms?: { playerId: string; window: SerializedWindow }[];
  evidence: DatasetEvidenceContract;
  dataset: NormalizedAnalyticsDataset;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const ids = (value: unknown, known: Set<string>) => Array.isArray(value) && value.every((id) => typeof id === 'string' && known.has(id));

/** Rejects lifetime claims, transport-snapshot results and selections pointing outside the payload. */
export function isDatasetAnalysisResponse(value: unknown): value is DatasetAnalysisResponse {
  if (!isRecord(value)) return false;
  const c = value as Partial<DatasetAnalysisResponse>;
  if (!(c.ok === true && c.schemaVersion === 4 && c.view === 'analysis' && c.analysisVersion === 'server-analysis-v1'
    && c.scopeRuleVersion === 'analysis-scope-v1' && c.featurePolicyVersion === 'feature-scope-policy-v1'
    && c.adaptiveWindowVersion === 'adaptive-window-v1' && c.scoreVersion === 'community-score-v2'
    && isRecord(c.coverage) && c.coverage.lifetimeComplete === false && c.coverage.serverHistoryUsed === true
    && c.coverage.transportSnapshotUsed === false && isRecord(c.population) && Array.isArray(c.population.seasonKeys)
    && isRecord(c.selection) && isRealDataset(c.dataset))) return false;
  const matchIds = new Set(c.dataset!.matches.map((match) => match.id));
  const playerIds = new Set(c.dataset!.players.map((player) => player.id));
  return Object.entries(c.selection).every(([playerId, list]) => playerIds.has(playerId) && ids(list, matchIds))
    && (c.forms === undefined || (Array.isArray(c.forms) && c.forms.every((form) => isRecord(form) && isRecord(form.window)
      && ids(form.window.currentMatchIds, matchIds) && ids(form.window.baselineMatchIds, matchIds))));
}

function entryIndex(dataset: NormalizedAnalyticsDataset): Map<string, PerformanceEntry> {
  return new Map(createPerformanceEntries(dataset).map((entry) => [`${entry.match.id}|${entry.playerId}`, entry]));
}

function hydrateWindow(window: SerializedWindow, playerId: string, index: Map<string, PerformanceEntry>): AdaptiveWindowResult {
  const { currentMatchIds, baselineMatchIds, ...rest } = window;
  const pick = (list: string[]) => list.flatMap((id) => index.get(`${id}|${playerId}`) ?? []);
  return { ...rest, currentEntries: pick(currentMatchIds), baselineEntries: pick(baselineMatchIds) };
}

/** Rebuilds the exact SelectionResult shape the unchanged pages/scoring code consume. */
export function selectionFromAnalysis(response: DatasetAnalysisResponse): SelectionResult {
  const index = entryIndex(response.dataset);
  const byPlayer = new Map<string, PerformanceEntry[]>();
  for (const [playerId, list] of Object.entries(response.selection)) {
    byPlayer.set(playerId, list.flatMap((id) => index.get(`${id}|${playerId}`) ?? []));
  }
  const entries = [...byPlayer.values()].flat()
    .sort((a, b) => b.match.playedAt.localeCompare(a.match.playedAt) || a.playerId.localeCompare(b.playerId));
  const scope: ScopeSummary | undefined = response.scope ? {
    ...response.scope,
    players: new Map(response.scope.players.map(({ window, ...player }): [string, PlayerScope] => [player.playerId, {
      ...player, sample: player.sample as WindowSample,
      ...(window ? { window: hydrateWindow(window, player.playerId, index) } : {}),
    }])),
  } : undefined;
  return { entries, byPlayer, ...(scope ? { scope } : {}) };
}

/** Server-resolved recentForm windows, hydrated with the payload's full entries. */
export function formWindowsFromAnalysis(response: DatasetAnalysisResponse): Map<string, AdaptiveWindowResult> {
  const index = entryIndex(response.dataset);
  return new Map((response.forms ?? []).map((form) => [form.playerId, hydrateWindow(form.window, form.playerId, index)]));
}
