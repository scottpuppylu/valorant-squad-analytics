// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { AvatarProvider } from '../src/contexts/AvatarProvider';
import { DatasetProvider } from '../src/contexts/DatasetProvider';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import { buildAnalytics } from '../src/data/analytics';
import { selectPerformances } from '../src/analytics/filters';
import { aggregateSelection } from '../src/analytics/rankings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TASK-IDENTITY-01 Demo member presentation', () => {
  let root: Root; let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); localStorage.clear(); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 200 && !predicate(); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  };
  const render = async (hash: string) => {
    window.location.hash = hash;
    const calls: string[] = [];
    await act(async () => { root.render(<DatasetProvider client={{ load: async () => { calls.push('load'); throw new Error('no api'); } }} forceDemo><AvatarProvider><App /></AvatarProvider></DatasetProvider>); });
    return calls;
  };
  const accounts = () => container.querySelector('[aria-label="遊戲帳號"]');

  it('a multi-account member shows its member name and both accounts (主帳/小帳), with zero API calls', async () => {
    const calls = await render('#/players/nova-hex');
    await settle(() => accounts() !== null);
    expect(container.querySelector('h1')?.textContent).toBe('NovaHex');
    expect(accounts()?.textContent).toContain('遊戲帳號（2 個，分析合併計算）');
    expect(accounts()?.textContent).toContain('主帳NovaMain#DEMO');
    expect(accounts()?.textContent).toContain('小帳NovaAlt#ALT');
    expect(container.querySelector('[aria-label="戰績更新"]')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('a single-account member stays compact without a 主帳/小帳 label', async () => {
    await render('#/players/echo-vale');
    await settle(() => accounts() !== null);
    expect(accounts()?.textContent).toBe('遊戲帳號 EchoVale#DEMO');
  });

  it('the Demo multi-account member is one ranked person whose evidence spans both accounts', () => {
    const dataset = demoDataSource.snapshot();
    const analytics = buildAnalytics(dataset);
    const rows = aggregateSelection(selectPerformances(analytics.performanceEntries, { playerId: 'all', period: 'all', map: 'all', agent: 'all', role: 'all', gameMode: 'all', minMatches: 0, minRounds: 0 }, { population: analytics.population }));
    expect(rows.filter((row) => row.player.id === 'nova-hex')).toHaveLength(1);
    const used = new Set(dataset.matches.flatMap((m) => m.performances.filter((p) => p.playerId === 'nova-hex').map((p) => p.accountId)));
    expect(used.size).toBe(2);
    expect(dataset.matches.flatMap((m) => m.performances.filter((p) => p.playerId !== 'nova-hex' && p.accountId))).toEqual([]);
  });
});
