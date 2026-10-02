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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function response(state: 'ready' | 'empty'): DatasetReadyResponse {
  const demo = demoDataSource.snapshot();
  return {
    ok: true,
    schemaVersion: 3,
    state,
    snapshot: { version: state, generation: 'dataset-read-v3', source: 'durable-neon', projectionVersion: 'synergy-ready-projection-v1' },
    coverage: { completeForProviderWindow: false, boundedMatchLimit: 300, lifetimeComplete: false },
    evidence: { acs: 'derived', adr: 'derived', headshotPercentage: 'derived', kast: 'reconstructed', firstKills: 'reconstructed', firstDeaths: 'reconstructed' },
    dataset: state === 'ready'
      ? { ...demo, mode: 'REAL', isDemo: false, sourceId: 'durable-neon-v1' }
      : { players: [], matches: [], mode: 'REAL', isDemo: false, sourceId: 'durable-neon-v1' },
  };
}

describe('dataset-aware routes', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    localStorage.clear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderWith(client: DatasetApiClient) {
    await act(async () => {
      root.render(<DatasetProvider client={client} forceDemo={false}><AvatarProvider><App /></AvatarProvider></DatasetProvider>);
    });
  }

  it('renders an analysis route from a ready REAL dataset', async () => {
    window.location.hash = '#/leaderboard';
    await renderWith({ load: async () => response('ready') });
    expect(container.textContent).toContain('戰力排名');
    expect(container.textContent).toContain('公開真實戰績');
  });

  it('renders the dedicated empty state on an analysis route', async () => {
    window.location.hash = '#/matches';
    await renderWith({ load: async () => response('empty') });
    expect(container.textContent).toContain('目前尚無已加入的真實玩家');
    expect(container.textContent).toContain('前往加入調查');
  });

  it('renders the empty state when active profiles exist without usable matches', async () => {
    window.location.hash = '#/players';
    const empty = response('empty');
    empty.dataset.players = demoDataSource.snapshot().players.slice(0, 2);
    await renderWith({ load: async () => empty });
    expect(container.textContent).toContain('目前尚無已加入的真實玩家');
  });

  it('renders a shared match containing only one projected performance', async () => {
    window.location.hash = '#/matches';
    const ready = response('ready');
    ready.dataset.matches = [{
      ...ready.dataset.matches[0]!,
      performances: ready.dataset.matches[0]!.performances.slice(0, 1),
      synergyEvidence: undefined,
    }];
    await renderWith({ load: async () => ready });
    expect(container.textContent).toContain('對戰紀錄');
    expect(container.textContent).toContain('NovaHex');
  });

  it('handles an invalid player route without throwing', async () => {
    window.location.hash = '#/players/not-a-player';
    await renderWith({ load: async () => response('ready') });
    expect(container.textContent).toContain('這個玩家連結不存在');
  });

  it('renders Synergy empty REAL without Demo fallback', async () => {
    window.location.hash = '#/synergy';
    await renderWith({ load: async () => response('empty') });
    expect(container.textContent).toContain('目前尚無已加入的真實玩家');
    expect(container.textContent).not.toContain('NovaHex');
  });

  it('renders an intentional one-player Synergy state', async () => {
    window.location.hash = '#/synergy';
    const ready = response('ready');
    ready.dataset.players = ready.dataset.players.slice(0,1);
    ready.dataset.matches = [{...ready.dataset.matches[0]!,performances:ready.dataset.matches[0]!.performances.slice(0,1),synergyEvidence:undefined}];
    await renderWith({load:async () => ready});
    expect(container.textContent).toContain('至少需要兩位公開玩家才能分析搭檔');
  });

  it('handles invalid pair URLs and exposes observed matrix selection', async () => {
    window.location.hash = '#/synergy?a=invalid&b=invalid&map=unknown';
    await renderWith({load:async () => response('ready')});
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('#pair-detail')?.textContent).toContain('共同');
    const cell = container.querySelector<HTMLButtonElement>('td button');
    await act(async () => {cell!.click();});
    expect(window.location.hash).toContain('a=');
    expect(window.location.hash).not.toContain('invalid');
  });

  it('shows one-player guidance even with no usable REAL matches', async () => {
    window.location.hash='#/synergy';
    const empty=response('empty'); empty.dataset.players=demoDataSource.snapshot().players.slice(0,1);
    await renderWith({load:async()=>empty});
    expect(container.textContent).toContain('至少需要兩位公開玩家才能分析搭檔');
  });

  it('shows missing teammate sample, not zero, for two opponents', async () => {
    window.location.hash='#/synergy';
    const ready=response('ready'); ready.dataset.players=ready.dataset.players.slice(0,2);
    const performances=ready.dataset.matches[0]!.performances.slice(0,2);
    performances[1]={...performances[1]!,teamGroup:'B'};
    ready.dataset.matches=[{...ready.dataset.matches[0]!,performances,synergyEvidence:undefined}];
    await renderWith({load:async()=>ready});
    expect(container.querySelector('#pair-detail')?.textContent).toBe('沒有共同同隊樣本');
  });
});
