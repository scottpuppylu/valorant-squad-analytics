import { useEffect, useMemo, useState } from 'react';
import { selectPerformances } from '../analytics/filters';
import type { AdaptiveWindowResult, FeatureId } from '../analytics/scope/types';
import type { AnalysisFilters, SelectionResult } from '../analytics/types';
import { formWindowsFromAnalysis, isDatasetAnalysisResponse, selectionFromAnalysis, type AnalysisQuery, type DatasetAnalysisResponse } from '../dataSources/server/analysisResult';
import type { NormalizedAnalyticsDataset } from '../dataSources/types';
import { useDataset } from './useDataset';

export type ScopedAnalysisStatus = 'local' | 'loading' | 'ready' | 'stale' | 'error';
export type LifetimeFeature = Extract<FeatureId, 'lifetimeTotals' | 'mapStats' | 'agentStats'>;

export interface ScopedAnalysis {
  status: ScopedAnalysisStatus;
  /** 'server' = full durable history (DATA-03B.2B); 'snapshot' = local analysis of the loaded dataset (Demo/tests). */
  source: 'server' | 'snapshot';
  selection: SelectionResult;
  /** Dataset whose players/matches back `selection` (server population or the local snapshot). */
  dataset: NormalizedAnalyticsDataset;
  formWindows?: Map<string, AdaptiveWindowResult>;
  trackedMatchCount?: number;
}

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

const emptySelection: SelectionResult = { entries: [], byPlayer: new Map() };

/**
 * DATA-03B.2B: analytics populations come from the server over ALL eligible durable history.
 * Failure never substitutes another scope (no ACT→lifetime, no adaptive→snapshot): the last valid
 * result for the SAME request is kept as `stale`, otherwise the page shows an explicit error.
 */
export function useScopedAnalysis(filters: AnalysisFilters, options: { lifetimeFeature?: LifetimeFeature; form?: boolean } = {}): ScopedAnalysis {
  const { analytics: { activeDataset, performanceEntries, population }, loadAnalysis, snapshot } = useDataset();
  const lifetimeFeature = options.lifetimeFeature ?? 'lifetimeTotals';
  const local = useMemo(() => selectPerformances(performanceEntries, filters, { population, lifetimeFeature }), [filters, lifetimeFeature, performanceEntries, population]);
  const query = useMemo(() => analysisQueryFor(filters, lifetimeFeature, options.form === true), [filters, lifetimeFeature, options.form]);
  // Snapshot version in the key: a data refresh re-runs server analysis.
  const key = query ? JSON.stringify([query, snapshot?.version ?? null]) : undefined;
  const [settled, setSettled] = useState<{ key: string; response?: DatasetAnalysisResponse; failed?: boolean } | undefined>();

  useEffect(() => {
    if (!loadAnalysis || !query || !key) return undefined;
    const abort = new AbortController();
    loadAnalysis(query, abort.signal).then((response) => {
      if (abort.signal.aborted) return;
      if (!isDatasetAnalysisResponse(response)) throw new Error('Unsupported analysis response.');
      setSettled({ key, response });
    }).catch(() => {
      if (!abort.signal.aborted) setSettled({ key, failed: true });
    });
    return () => abort.abort();
    // `query` is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadAnalysis]);

  const server = useMemo(() => (settled?.response && settled.key === key ? {
    selection: selectionFromAnalysis(settled.response),
    formWindows: formWindowsFromAnalysis(settled.response),
    dataset: settled.response.dataset,
    trackedMatchCount: settled.response.coverage.trackedMatchCount,
  } : undefined), [key, settled]);

  // Local analysis: Demo/tests, or a request that needs no data (e.g. 指定 Act with no Act chosen).
  if (!loadAnalysis || !query) return { status: 'local', source: 'snapshot', selection: local, dataset: activeDataset };
  if (server) return { status: 'ready', source: 'server', ...server };
  return { status: settled?.failed && settled.key === key ? 'error' : 'loading', source: 'server', selection: emptySelection, dataset: { ...activeDataset, matches: [] } };
}

export interface SynergyContext { act?: string; from?: string; to?: string; map: string; mode: string }

/**
 * DATA-03B.2B PAIR population: shared appearances AND both baselines come from the same server
 * context over all durable history (never the snapshot). duo-synergy-v1 itself runs unchanged in the browser.
 */
export function useSynergyDataset(context: SynergyContext): { status: ScopedAnalysisStatus; source: 'server' | 'snapshot'; dataset: NormalizedAnalyticsDataset; trackedMatchCount?: number } {
  const { dataset, loadAnalysis, snapshot } = useDataset();
  const query = useMemo<AnalysisQuery>(() => ({ feature: 'synergy', map: context.map, mode: context.mode,
    ...(context.act ? { act: context.act } : {}), ...(context.from ? { from: context.from } : {}), ...(context.to ? { to: context.to } : {}) }),
  [context.act, context.from, context.map, context.mode, context.to]);
  const key = JSON.stringify([query, snapshot?.version ?? null]);
  const [settled, setSettled] = useState<{ key: string; response?: DatasetAnalysisResponse; failed?: boolean } | undefined>();
  useEffect(() => {
    if (!loadAnalysis) return undefined;
    const abort = new AbortController();
    loadAnalysis(query, abort.signal).then((response) => {
      if (abort.signal.aborted) return;
      if (!isDatasetAnalysisResponse(response)) throw new Error('Unsupported analysis response.');
      setSettled({ key, response });
    }).catch(() => { if (!abort.signal.aborted) setSettled({ key, failed: true }); });
    return () => abort.abort();
  }, [key, loadAnalysis, query]);
  if (!loadAnalysis) return { status: 'local', source: 'snapshot', dataset };
  if (settled?.response && settled.key === key) return { status: 'ready', source: 'server', dataset: settled.response.dataset, trackedMatchCount: settled.response.coverage.trackedMatchCount };
  return { status: settled?.failed && settled.key === key ? 'error' : 'loading', source: 'server', dataset: { ...dataset, matches: [] } };
}
