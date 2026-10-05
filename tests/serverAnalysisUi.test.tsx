// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { AvatarProvider } from '../src/contexts/AvatarProvider';
import { DatasetProvider } from '../src/contexts/DatasetProvider';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import type { DatasetApiClient } from '../src/dataSources/server/DatasetApiClient';
import type { DatasetReadyResponse } from '../src/dataSources/server/contracts';
import type { AnalysisQuery, DatasetAnalysisResponse } from '../src/dataSources/server/analysisResult';
import { createPerformanceEntries, selectPerformances } from '../src/analytics/filters';
import { populationFromMatches } from '../src/analytics/scope/resolveScope';
import { analysisQueryFor } from '../src/hooks/useScopedAnalysis';
import { serializeScope } from '../server/dataset/analysisService';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types';
import type { AnalysisFilters } from '../src/analytics/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function realDemo(): NormalizedAnalyticsDataset {
  const demo = structuredClone(demoDataSource.snapshot());
  for (const match of demo.matches) for (const p of match.performances) p.eventEvidence = { kast: 'reconstructed', opening: 'reconstructed' };
  return { ...demo, mode: 'REAL', isDemo: false, sourceId: 'durable-neon-v4' };
}

const evidence = { acs: 'derived', adr: 'derived', headshotPercentage: 'derived', kast: 'reconstructed', firstKills: 'reconstructed', firstDeaths: 'reconstructed' } as const;

function snapshotOf(dataset: NormalizedAnalyticsDataset): DatasetReadyResponse {
  return { ok: true, schemaVersion: 5, state: 'ready', snapshot: { version: 'v', generation: 'dataset-read-v4', source: 'durable-neon', projectionVersion: 'evidence-decoupled-projection-v1', identityVersion: 'member-identity-v1' },
    coverage: { completeForProviderWindow: false, boundedMatchLimit: 300, lifetimeComplete: false }, evidence, dataset };
}

/** Simulates the server: the SAME engine over the full durable dataset, serialized like view=analysis. */
function serverAnswer(full: NormalizedAnalyticsDataset, query: AnalysisQuery, seen: AnalysisQuery[]): DatasetAnalysisResponse {
  seen.push(query);
  const period: AnalysisFilters['period'] = query.feature === 'currentStrength' ? 'current' : query.feature === 'fixedRecent' ? (query.recent === 10 ? 'recent10' : 'recent30') : query.feature === 'actOverview' ? 'act' : 'all';
  const filters: AnalysisFilters = { playerId: query.player ?? 'all', period, map: query.map ?? 'all', agent: query.agent ?? 'all', role: (query.role ?? 'all') as AnalysisFilters['role'], gameMode: query.mode ?? 'all', minMatches: 0, minRounds: 0 };
  const population = populationFromMatches(full.matches, true);
  const selection = selectPerformances(createPerformanceEntries(full), filters, { population });
  const ids = new Set(selection.entries.map((e) => e.match.id));
  return { ok: true, schemaVersion: 5, view: 'analysis', analysisVersion: 'server-analysis-v1', scopeRuleVersion: 'analysis-scope-v1', featurePolicyVersion: 'feature-scope-policy-v2',
    adaptiveWindowVersion: 'adaptive-window-v1', scoreVersion: 'community-score-v2', feature: query.feature, status: 'available', reasons: [],
    coverage: { trackedMatchCount: full.matches.length, populationComplete: true, serverHistoryUsed: true, transportSnapshotUsed: false, populationLimit: 2000, lifetimeComplete: false },
    population: { seasonKeys: [], seasonStatus: 'unavailable', rankStatus: 'unavailable' },
    scope: serializeScope(selection.scope!) as DatasetAnalysisResponse['scope'],
    selection: Object.fromEntries([...selection.byPlayer].map(([p, e]) => [p, e.map((x) => x.match.id)])),
    evidence, dataset: { ...full, matches: full.matches.filter((m) => ids.has(m.id)) } };
}

describe('DATA-03B.2B production consumers', () => {
  let root: Root; let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); localStorage.clear(); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 200 && !predicate(); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  };
  const render = async (client: DatasetApiClient) => {
    await act(async () => { root.render(<DatasetProvider client={client} forceDemo={false}><AvatarProvider><App /></AvatarProvider></DatasetProvider>); });
  };

  it('ranks the server population (beyond the snapshot) and discloses the server source', async () => {
    const full = realDemo();
    const snapshot = { ...full, matches: full.matches.slice(0, 6) };
    const seen: AnalysisQuery[] = [];
    window.location.hash = '#/leaderboard?period=all';
    await render({ load: async () => snapshotOf(snapshot), loadAnalysis: async (query) => serverAnswer(full, query, seen) });
    await settle(() => container.textContent?.includes('由伺服器依完整已追蹤歷史') ?? false);
    // The provider's default prefetch may come first; the page's own request must be present.
    expect(seen).toContainEqual(analysisQueryFor({ playerId: 'all', period: 'all', map: 'all', agent: 'all', role: 'all', gameMode: 'all', minMatches: 0, minRounds: 0 }, 'lifetimeTotals', true));
    expect(container.textContent).toContain(`由伺服器依完整已追蹤歷史（${full.matches.length} 場）選樣`);
    const matchCounts = [...container.querySelectorAll('table tbody tr')].map((row) => row.children[4]?.textContent).filter(Boolean).map(Number);
    expect(Math.max(...matchCounts)).toBe(20);
    expect(Math.max(...matchCounts)).toBeGreaterThan(snapshot.matches.length);
  });

  it('prefetches the default population in parallel with the snapshot and shares it across routes', async () => {
    const full = realDemo();
    const seen: AnalysisQuery[] = [];
    let snapshotResolved = false;
    let analysisBeforeSnapshot = false;
    window.location.hash = '#/';
    await render({
      load: async () => { await new Promise((r) => setTimeout(r, 50)); snapshotResolved = true; return snapshotOf(full); },
      loadAnalysis: async (query) => { if (!snapshotResolved) analysisBeforeSnapshot = true; return serverAnswer(full, query, seen); },
    });
    await settle(() => container.textContent?.includes('由伺服器依完整已追蹤歷史') ?? false);
    expect(analysisBeforeSnapshot).toBe(true);
    const link = [...container.querySelectorAll('a')].find((a) => a.getAttribute('href') === '#/leaderboard')!;
    await act(async () => { link.click(); });
    await settle(() => (container.querySelectorAll('table tbody tr').length > 0));
    expect(seen.filter((q) => q.feature === 'currentStrength')).toHaveLength(1);
  });

  it('Profile shows the Progress Index from server windows, and an explicit error without fallback', async () => {
    const full = realDemo();
    const player = full.players[0]!;
    window.location.hash = `#/players/${player.id}`;
    await render({ load: async () => snapshotOf(full), loadAnalysis: async (query) => {
      if (query.feature === 'improvementIndex') throw new Error('down');
      return serverAnswer(full, query, []);
    } });
    await settle(() => container.textContent?.includes('進步指數暫時無法取得') ?? false);
    const card = container.querySelector('[aria-label="進步指數"]')!;
    expect(card.querySelector('[role=alert]')).not.toBeNull();
    expect(card.textContent).toContain('不會改用最近 N 場、快照或全部已追蹤代替');
  });

  it('Demo Profile computes the Progress Index locally with an explanation and no API call', async () => {
    const player = demoDataSource.snapshot().players[0]!;
    window.location.hash = `#/players/${player.id}`;
    await act(async () => { root.render(<DatasetProvider forceDemo><AvatarProvider><App /></AvatarProvider></DatasetProvider>); });
    await settle(() => !!container.querySelector('[aria-label="進步指數"]'));
    const card = container.querySelector('[aria-label="進步指數"]')!;
    expect(card.textContent).toContain('為什麼是這個結果？');
    expect(card.textContent).toContain('排位資料：尚未取得（不計分、不視為 0）');
    expect(card.textContent).toMatch(/進步中|持平|下滑中|資料不足/u);
    expect(card.textContent).not.toMatch(/NaN|Infinity/u);
  });

  it('shows an explicit error and no substitute ranking when server analysis fails', async () => {
    const full = realDemo();
    window.location.hash = '#/leaderboard';
    await render({ load: async () => snapshotOf(full), loadAnalysis: async () => { throw new Error('down'); } });
    await settle(() => container.textContent?.includes('伺服器分析暫時無法取得') ?? false);
    expect(container.textContent).toContain('不顯示替代結果');
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    expect(container.textContent).not.toContain('由伺服器依完整已追蹤歷史');
  });
});
