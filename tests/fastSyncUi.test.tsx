// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { AvatarProvider } from '../src/contexts/AvatarProvider';
import { DatasetProvider } from '../src/contexts/DatasetProvider';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import type { DatasetApiClient } from '../src/dataSources/server/DatasetApiClient';
import type { DatasetReadyResponse, RecentRefreshOutcome } from '../src/dataSources/server/contracts';
import type { AnalysisQuery } from '../src/dataSources/server/analysisResult';
import { BackendApiError } from '../src/dataSources/server/ValorantBackendClient';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const evidence = { acs: 'derived', adr: 'derived', headshotPercentage: 'derived', kast: 'reconstructed', firstKills: 'reconstructed', firstDeaths: 'reconstructed' } as const;

function realDemo(): NormalizedAnalyticsDataset {
  const demo = structuredClone(demoDataSource.snapshot());
  for (const match of demo.matches) for (const p of match.performances) p.eventEvidence = { kast: 'reconstructed', opening: 'reconstructed' };
  return { ...demo, mode: 'REAL', isDemo: false, sourceId: 'durable-neon-v4' };
}

/** Snapshot version follows durable content, like the server's content hash. */
function snapshotOf(dataset: NormalizedAnalyticsDataset): DatasetReadyResponse {
  return { ok: true, schemaVersion: 5, state: 'ready', snapshot: { version: `v${dataset.matches.length}`, generation: 'dataset-read-v4', source: 'durable-neon', projectionVersion: 'evidence-decoupled-projection-v1', identityVersion: 'member-identity-v1' },
    coverage: { completeForProviderWindow: false, boundedMatchLimit: 300, lifetimeComplete: false }, evidence, dataset: structuredClone(dataset) };
}

/** Demo single-account member EchoVale and two-account member NovaHex (fictional public account ids). */
const ECHO_ACCOUNT = '00000000-0000-4000-8000-00000000d002';
const NOVA_MAIN = '00000000-0000-4000-8000-00000000d001';
const NOVA_ALT = '00000000-0000-4000-8000-00000000da01';

const outcome = (value: Partial<RecentRefreshOutcome>): RecentRefreshOutcome => ({ policyVersion: 'recent-refresh-v1', status: 'fresh', providerRequested: false, ...value });

/** A fake durable server. `refreshRecent` is scripted; a "refreshed" outcome commits a new match first. */
function fakeServer(script: Array<RecentRefreshOutcome | Error>) {
  const durable = realDemo();
  const calls = { load: 0, analysis: [] as AnalysisQuery[], refresh: [] as string[] };
  let release: (() => void) | undefined;
  const gate = { hold: false };
  const client: DatasetApiClient = {
    load: async () => { calls.load += 1; return snapshotOf(durable); },
    loadAnalysis: async (query) => { calls.analysis.push(query); throw new Error('analysis not simulated here'); },
    refreshRecent: async (accountId) => {
      calls.refresh.push(accountId);
      const playerId = durable.players.find((player) => player.accounts?.some((account) => account.id === accountId))!.id;
      if (gate.hold) await new Promise<void>((resolve) => { release = resolve; });
      const next = script.shift() ?? outcome({});
      if (next instanceof Error) throw next;
      if (next.status === 'refreshed' && (next.newMatches ?? 0) > 0) {
        const template = durable.matches.find((m) => m.performances.some((p) => p.playerId === playerId))!;
        durable.matches.unshift({ ...structuredClone(template), id: 'fastsync-new-match', map: 'Abyss', playedAt: '2026-12-31T12:00:00.000Z' });
      }
      return { ok: true, refresh: next };
    },
  };
  return { client, calls, gate, release: () => release?.() };
}

describe('TASK-DATA-FASTSYNC-01 Profile refresh', () => {
  let root: Root; let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); localStorage.clear(); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 200 && !predicate(); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  };
  const render = async (client: DatasetApiClient, forceDemo = false) => {
    await act(async () => { root.render(<DatasetProvider client={client} forceDemo={forceDemo}><AvatarProvider><App /></AvatarProvider></DatasetProvider>); });
  };
  const navigate = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
  const panel = () => container.querySelector('[aria-label="戰績更新"]');

  it('renders stored data immediately, refreshes once per player per tab, and never on re-render/remount', async () => {
    const server = fakeServer([outcome({ status: 'fresh', lastSuccessAt: new Date(Date.now() - 10 * 60_000).toISOString(), nextEligibleAt: new Date(Date.now() + 20 * 60_000).toISOString() })]);
    server.gate.hold = true;
    window.location.hash = '#/players/echo-vale';
    await render(server.client);
    await settle(() => container.textContent?.includes('EchoVale') ?? false);
    // Stored profile is visible while the check is still pending.
    expect(container.textContent).toContain('EchoVale');
    expect(panel()?.textContent).toContain('正在檢查最新戰績');
    server.release();
    await settle(() => panel()?.textContent?.includes('資料已是最新狀態') ?? false);
    expect(panel()?.textContent).toContain('約 20 分鐘後可再次更新');
    expect(panel()?.textContent).toContain('最近同步：10 分鐘前');
    // Filter change, navigation away and back: no second automatic request.
    await navigate('#/players/echo-vale?period=all');
    await navigate('#/leaderboard');
    await navigate('#/players/echo-vale');
    await settle(() => panel() !== null);
    expect(server.calls.refresh).toEqual([ECHO_ACCOUNT]);
    // A fresh outcome does not reload the snapshot.
    expect(server.calls.load).toBe(1);
  });

  it('Dashboard, Leaderboard and Matches never trigger provider fan-out', async () => {
    const server = fakeServer([]);
    window.location.hash = '#/';
    await render(server.client);
    for (const hash of ['#/', '#/leaderboard', '#/matches', '#/synergy']) {
      await navigate(hash);
      await settle(() => false);
    }
    expect(server.calls.refresh).toEqual([]);
  });

  it('a durable new match reloads the snapshot, clears the per-tab analysis cache, and appears in Matches', async () => {
    const server = fakeServer([outcome({ status: 'refreshed', providerRequested: true, newMatches: 1, morePending: false, lastSuccessAt: new Date().toISOString() })]);
    window.location.hash = '#/players/echo-vale';
    await render(server.client);
    await settle(() => panel()?.textContent?.includes('已更新最新戰績') ?? false);
    expect(panel()?.textContent).toContain('新增 1 場');
    await settle(() => server.calls.load === 2);
    expect(server.calls.load).toBe(2);
    // The same server-analysis query is issued again for the new snapshot (cache invalidated).
    await settle(() => server.calls.analysis.filter((q) => q.feature === 'improvementIndex').length >= 2);
    const progressQueries = server.calls.analysis.filter((q) => q.feature === 'improvementIndex');
    expect(progressQueries.length).toBeGreaterThanOrEqual(2);
    expect(new Set(progressQueries.map((q) => JSON.stringify(q))).size).toBe(1);
    await navigate('#/matches');
    await settle(() => container.textContent?.includes('Abyss') ?? false);
    expect(container.textContent).toContain('Abyss');
    expect(server.calls.refresh).toEqual([ECHO_ACCOUNT]);
  });

  it('more pending recent data is disclosed without automatic recursion', async () => {
    const server = fakeServer([outcome({ status: 'refreshed', providerRequested: true, newMatches: 1, morePending: true })]);
    window.location.hash = '#/players/echo-vale';
    await render(server.client);
    await settle(() => panel()?.textContent?.includes('仍有近期資料待補') ?? false);
    await settle(() => false);
    expect(server.calls.refresh).toHaveLength(1);
  });

  it('backoff, IP limiting and errors keep stored profile data visible', async () => {
    const server = fakeServer([outcome({ status: 'backoff', providerRequested: true, errorCategory: 'RATE_LIMITED', nextEligibleAt: new Date(Date.now() + 4 * 60_000).toISOString() }),
      new BackendApiError('RATE_LIMITED', 'ip'), new Error('network')]);
    window.location.hash = '#/players/echo-vale';
    await render(server.client);
    await settle(() => panel()?.textContent?.includes('更新暫時受到限制') ?? false);
    expect(panel()?.textContent).toContain('約 4 分鐘後可再更新');
    expect(container.textContent).toContain('EchoVale');
    const button = () => panel()!.querySelector('button')!;
    await act(async () => { button().click(); });
    await settle(() => (panel()?.textContent?.includes('稍後可再更新') ?? false) && !button().disabled);
    await act(async () => { button().click(); });
    await settle(() => panel()?.textContent?.includes('目前無法更新此玩家戰績') ?? false);
    expect(container.textContent).toContain('EchoVale');
    expect(server.calls.load).toBe(1);
  });

  it('the manual 更新戰績 button asks the server again and respects its cooldown', async () => {
    const lastSuccessAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const nextEligibleAt = new Date(Date.now() + 28 * 60_000).toISOString();
    const server = fakeServer([outcome({ status: 'refreshed', providerRequested: true, newMatches: 0, lastSuccessAt }), outcome({ status: 'fresh', lastSuccessAt, nextEligibleAt }), outcome({ status: 'fresh', lastSuccessAt, nextEligibleAt })]);
    window.location.hash = '#/players/echo-vale';
    await render(server.client);
    await settle(() => panel()?.textContent?.includes('資料來源沒有新的對戰') ?? false);
    const button = panel()!.querySelector('button')!;
    expect(button.textContent).toBe('更新戰績');
    for (let index = 0; index < 2; index += 1) {
      await act(async () => { button.click(); });
      await settle(() => panel()?.textContent?.includes('約 28 分鐘後可再次更新') ?? false);
    }
    expect(server.calls.refresh).toHaveLength(3);
    // Neither zero-new-match refreshes nor fresh answers reload the snapshot.
    expect(server.calls.load).toBe(1);
  });

  it('a multi-account member never fans out automatically; each account has its own manual action', async () => {
    const server = fakeServer([outcome({ status: 'fresh', nextEligibleAt: new Date(Date.now() + 10 * 60_000).toISOString() })]);
    window.location.hash = '#/players/nova-hex';
    await render(server.client);
    await settle(() => panel() !== null);
    await settle(() => false);
    expect(server.calls.refresh).toEqual([]);
    expect(panel()?.textContent).toContain('NovaMain#DEMO');
    expect(panel()?.textContent).toContain('NovaAlt#ALT');
    expect(panel()?.textContent).toContain('多帳號成員不會自動更新');
    const buttons = [...panel()!.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    await act(async () => { buttons[1]!.click(); });
    await settle(() => panel()?.textContent?.includes('約 10 分鐘後可再次更新') ?? false);
    expect(server.calls.refresh).toEqual([NOVA_ALT]);
    expect(server.calls.refresh).not.toContain('nova-hex');
    expect(server.calls.refresh).not.toContain(NOVA_MAIN);
  });

  it('Demo renders no update control and makes zero refresh calls', async () => {
    const server = fakeServer([]);
    window.location.hash = '#/players/echo-vale';
    await render(server.client, true);
    await settle(() => container.textContent?.includes('EchoVale') ?? false);
    await settle(() => false);
    expect(panel()).toBeNull();
    expect(container.textContent).not.toContain('更新戰績');
    expect(server.calls).toEqual({ load: 0, analysis: [], refresh: [] });
  });
});
