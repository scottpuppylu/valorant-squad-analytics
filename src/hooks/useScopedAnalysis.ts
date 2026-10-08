import { useEffect, useMemo, useState } from 'react';
import { selectPerformances } from '../analytics/filters';
import type { AdaptiveWindowResult } from '../analytics/scope/types';
import type { AnalysisFilters, SelectionResult } from '../analytics/types';
import { analysisQueryFor, formWindowsFromAnalysis, isDatasetAnalysisResponse, progressFromAnalysis, selectionFromAnalysis, type AnalysisQuery, type DatasetAnalysisResponse, type LifetimeFeature } from '../dataSources/server/analysisResult';
export { analysisQueryFor, type LifetimeFeature };
import type { NormalizedAnalyticsDataset } from '../dataSources/types';
import { useDataset } from './useDataset';
import { computeImprovementIndex, type ImprovementResult } from '../analytics/progress/improvementIndex';
import { resolveProgressWindows } from '../analytics/progress/windows';
import type { Player } from '../types/valorant';
import { summarizeSelection, type SelectionSummary } from '../analytics/summary';
import { buildSynergy, defaultSynergyFilters } from '../synergy/analytics';
import { StaticSnapshotNotPrecomputedError } from '../dataSources/static/StaticSnapshotClient';
import type { DuoSynergyResult } from '../synergy/types';

export type ScopedAnalysisStatus = 'local' | 'loading' | 'ready' | 'stale' | 'error';

export interface ScopedAnalysis {
  status: ScopedAnalysisStatus;
  /** 'server' = full durable history (DATA-03B.2B); 'snapshot' = local analysis of the loaded dataset (Demo/tests). */
  source: 'server' | 'snapshot';
  /** Scope + hydrated bounded windows. With the server the population entries are NOT shipped. */
  selection: SelectionResult;
  /**
   * TASK-DATA-03B.2C: every page aggregate of the feature population (selection-summary-v1), computed
   * by the server over all tracked history, or locally from `selection` for Demo/tests.
   */
  summary: SelectionSummary;
  /** Players + matches referenced by bounded windows (server) or the local snapshot (Demo). */
  dataset: NormalizedAnalyticsDataset;
  formWindows?: Map<string, AdaptiveWindowResult>;
  trackedMatchCount?: number;
  /** Matches the feature population aggregated (server only). */
  populationMatches?: number;
  populationComplete?: boolean;
  /** Static snapshot only: the request is valid but outside the precomputed catalog (explicit, never substituted). */
  notPrecomputed?: true;
}

const emptySelection: SelectionResult = { entries: [], byPlayer: new Map() };
const emptySummary = summarizeSelection(emptySelection);

/**
 * DATA-03B.2B: analytics populations come from the server over ALL eligible durable history.
 * Failure never substitutes another scope (no ACT→lifetime, no adaptive→snapshot): the last valid
 * result for the SAME request is kept as `stale`, otherwise the page shows an explicit error.
 */
export function useScopedAnalysis(filters: AnalysisFilters, options: { lifetimeFeature?: LifetimeFeature; form?: boolean } = {}): ScopedAnalysis {
  const { analytics: { activeDataset, performanceEntries, population }, loadAnalysis, snapshot } = useDataset();
  const lifetimeFeature = options.lifetimeFeature ?? 'lifetimeTotals';
  const local = useMemo(() => selectPerformances(performanceEntries, filters, { population, lifetimeFeature }), [filters, lifetimeFeature, performanceEntries, population]);
  const localSummary = useMemo(() => (loadAnalysis ? emptySummary : summarizeSelection(local)), [loadAnalysis, local]);
  const query = useMemo(() => analysisQueryFor(filters, lifetimeFeature, options.form === true), [filters, lifetimeFeature, options.form]);
  // Snapshot version in the key: a data refresh re-runs server analysis.
  const key = query ? JSON.stringify([query, snapshot?.version ?? null]) : undefined;
  const [settled, setSettled] = useState<{ key: string; response?: DatasetAnalysisResponse; failed?: boolean; notPrecomputed?: boolean } | undefined>();

  useEffect(() => {
    if (!loadAnalysis || !query || !key) return undefined;
    const abort = new AbortController();
    loadAnalysis(query, abort.signal).then((response) => {
      if (abort.signal.aborted) return;
      if (!isDatasetAnalysisResponse(response)) throw new Error('Unsupported analysis response.');
      setSettled({ key, response });
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) setSettled({ key, failed: true, notPrecomputed: error instanceof StaticSnapshotNotPrecomputedError });
    });
    return () => abort.abort();
    // `query` is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadAnalysis]);

  const server = useMemo(() => (settled?.response && settled.key === key ? {
    selection: selectionFromAnalysis(settled.response),
    // A scope feature without a summary is not a usable v2 answer (never re-derived from a snapshot).
    summary: settled.response.summary ?? emptySummary,
    formWindows: formWindowsFromAnalysis(settled.response),
    dataset: settled.response.dataset,
    trackedMatchCount: settled.response.coverage.trackedMatchCount,
    populationMatches: settled.response.coverage.populationMatches,
    populationComplete: settled.response.coverage.populationComplete,
  } : undefined), [key, settled]);

  // Local analysis: Demo/tests, or a request that needs no data (e.g. 指定 Act with no Act chosen).
  if (!loadAnalysis) return { status: 'local', source: 'snapshot', selection: local, summary: localSummary, dataset: activeDataset };
  // REAL with no request (指定 Act not chosen yet): an explicit empty population, never the snapshot.
  if (!query) return { status: 'local', source: 'server', selection: emptySelection, summary: emptySummary, dataset: { ...activeDataset, matches: [] } };
  if (server) return { status: 'ready', source: 'server', ...server };
  const failed = settled?.failed && settled.key === key;
  return { status: failed ? 'error' : 'loading', source: 'server', selection: emptySelection, summary: emptySummary, dataset: { ...activeDataset, matches: [] }, ...(failed && settled.notPrecomputed ? { notPrecomputed: true as const } : {}) };
}

export interface SynergyContext { act?: string; from?: string; to?: string; map: string; mode: string }

/**
 * PAIR population: shared appearances AND both baselines come from the same server context over all
 * durable history (never the snapshot). TASK-DATA-03B.2C: duo-synergy-v1 runs unchanged on the server
 * over the full pair population and only its results are shipped; Demo runs the same code locally.
 */
export function useSynergyResults(context: SynergyContext): { status: ScopedAnalysisStatus; source: 'server' | 'snapshot'; results: DuoSynergyResult[]; players: Player[]; trackedMatchCount?: number; populationMatches?: number; notPrecomputed?: true } {
  const { dataset, loadAnalysis, snapshot } = useDataset();
  const query = useMemo<AnalysisQuery>(() => ({ feature: 'synergy', map: context.map, mode: context.mode,
    ...(context.act ? { act: context.act } : {}), ...(context.from ? { from: context.from } : {}), ...(context.to ? { to: context.to } : {}) }),
  [context.act, context.from, context.map, context.mode, context.to]);
  const key = JSON.stringify([query, snapshot?.version ?? null]);
  const [settled, setSettled] = useState<{ key: string; response?: DatasetAnalysisResponse; failed?: boolean; notPrecomputed?: boolean } | undefined>();
  useEffect(() => {
    if (!loadAnalysis) return undefined;
    const abort = new AbortController();
    loadAnalysis(query, abort.signal).then((response) => {
      if (abort.signal.aborted) return;
      if (!isDatasetAnalysisResponse(response)) throw new Error('Unsupported analysis response.');
      setSettled({ key, response });
    }).catch((error: unknown) => { if (!abort.signal.aborted) setSettled({ key, failed: true, notPrecomputed: error instanceof StaticSnapshotNotPrecomputedError }); });
    return () => abort.abort();
  }, [key, loadAnalysis, query]);
  const local = useMemo(() => (loadAnalysis ? [] : buildSynergy(dataset, { ...defaultSynergyFilters, map: context.map, gameMode: context.mode,
    from: context.from ?? '', to: context.to ?? '', ...(context.act ? { act: context.act } : {}) })), [context.act, context.from, context.map, context.mode, context.to, dataset, loadAnalysis]);
  if (!loadAnalysis) return { status: 'local', source: 'snapshot', results: local, players: dataset.players };
  if (settled?.response && settled.key === key) return { status: 'ready', source: 'server', results: settled.response.synergy ?? [], players: settled.response.dataset.players,
    trackedMatchCount: settled.response.coverage.trackedMatchCount, populationMatches: settled.response.coverage.populationMatches };
  const failed = settled?.failed && settled.key === key;
  return { status: failed ? 'error' : 'loading', source: 'server', results: [], players: dataset.players, ...(failed && settled.notPrecomputed ? { notPrecomputed: true as const } : {}) };
}

/**
 * TASK-PROGRESS-01: improvement-index-v1 for one player. Windows come from the server over all durable
 * history (or locally for Demo); the formula runs in the browser like every other score. A failed
 * request is an explicit error — never a fallback to recent10/30, the snapshot or lifetime.
 */
export function useProgressIndex(player: Player | undefined): { status: ScopedAnalysisStatus; result?: ImprovementResult } {
  const { analytics: { performanceEntries, population }, loadAnalysis, snapshot } = useDataset();
  const playerId = player?.id;
  const local = useMemo(() => {
    if (!player || loadAnalysis) return undefined;
    const entries = performanceEntries.filter((entry) => entry.playerId === player.id);
    return computeImprovementIndex(player, resolveProgressWindows(entries, population));
  }, [loadAnalysis, performanceEntries, player, population]);
  const key = playerId ? JSON.stringify([playerId, snapshot?.version ?? null]) : undefined;
  const [settled, setSettled] = useState<{ key: string; response?: DatasetAnalysisResponse; failed?: boolean; notPrecomputed?: boolean } | undefined>();
  useEffect(() => {
    if (!loadAnalysis || !playerId || !key) return undefined;
    const abort = new AbortController();
    loadAnalysis({ feature: 'improvementIndex', player: playerId }, abort.signal).then((response) => {
      if (abort.signal.aborted) return;
      if (!isDatasetAnalysisResponse(response)) throw new Error('Unsupported analysis response.');
      setSettled({ key, response });
    }).catch(() => { if (!abort.signal.aborted) setSettled({ key, failed: true }); });
    return () => abort.abort();
  }, [key, loadAnalysis, playerId]);
  const server = useMemo(() => {
    if (!player || !settled?.response || settled.key !== key) return undefined;
    const windows = progressFromAnalysis(settled.response).get(player.id);
    return windows ? computeImprovementIndex(player, windows) : undefined;
  }, [key, player, settled]);
  if (!loadAnalysis) return { status: 'local', ...(local ? { result: local } : {}) };
  if (settled?.response && settled.key === key) return { status: 'ready', ...(server ? { result: server } : {}) };
  return { status: settled?.failed && settled.key === key ? 'error' : 'loading' };
}
