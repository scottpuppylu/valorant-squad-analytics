// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { AvatarProvider } from '../src/contexts/AvatarProvider';
import { DatasetProvider } from '../src/contexts/DatasetProvider';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import type { DatasetApiClient } from '../src/dataSources/server/DatasetApiClient';
import type { DatasetHistoryQuery, DatasetHistoryResponse, DatasetReadyResponse } from '../src/dataSources/server/contracts';
import { BackendApiError } from '../src/dataSources/server/ValorantBackendClient';
import type { MatchRecord } from '../src/types/valorant';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const evidence = { acs: 'derived', adr: 'derived', headshotPercentage: 'derived', kast: 'reconstructed', firstKills: 'reconstructed', firstDeaths: 'reconstructed' } as const;

function realMatches(): { players: DatasetReadyResponse['dataset']['players']; matches: MatchRecord[] } {
  const demo = structuredClone(demoDataSource.snapshot());
  for (const match of demo.matches) for (const p of match.performances) p.eventEvidence = { kast: 'reconstructed', opening: 'reconstructed' };
  demo.matches.sort((a, b) => b.playedAt.localeCompare(a.playedAt) || b.id.localeCompare(a.id));
  return { players: demo.players, matches: demo.matches };
}

function snapshot(players: DatasetReadyResponse['dataset']['players'], matches: MatchRecord[]): DatasetReadyResponse {
  return {
    ok: true, schemaVersion: 6, state: 'ready',
    snapshot: { version: 'history-ui', generation: 'dataset-read-v4', source: 'durable-neon', projectionVersion: 'evidence-decoupled-projection-v1', identityVersion: 'member-identity-v2' },
    coverage: { completeForProviderWindow: false, boundedMatchLimit: 300, lifetimeComplete: false },
    evidence,
    dataset: { players, matches, mode: 'REAL', isDemo: false, sourceId: 'durable-neon-v4' },
  };
}

function page(players: DatasetReadyResponse['dataset']['players'], matches: MatchRecord[], hasMore: boolean, total: number, earliest: string): DatasetHistoryResponse {
  return {
    ok: true, schemaVersion: 6, view: 'history', historyVersion: 'dataset-history-v1', projectionVersion: 'evidence-decoupled-projection-v1', identityVersion: 'member-identity-v2',
    state: matches.length ? 'ready' : 'empty',
    page: { limit: 50, traversedMatchCount: matches.length, withheldMatchCount: 0, ...(matches.length ? { from: matches.at(-1)!.playedAt, to: matches[0]!.playedAt } : {}), hasMore, nextCursor: hasMore ? 'opaque.cursor-value-0000000' : null },
    tracked: { trackedMatchCount: total, earliestTrackedAt: earliest, lastSyncedAt: '2026-10-05T06:00:00.000Z', lifetimeComplete: false },
    evidence,
    dataset: { players, matches, mode: 'REAL', isDemo: false, sourceId: 'durable-neon-v4' },
  };
}

describe('DATA-03B.1 browse-only history consumer', () => {
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

  async function settle(predicate: () => boolean) {
    for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
  }

  async function renderWith(client: DatasetApiClient, forceDemo = false) {
    await act(async () => {
      root.render(<DatasetProvider client={client} forceDemo={forceDemo}><AvatarProvider><App /></AvatarProvider></DatasetProvider>);
    });
    await settle(() => !container.textContent?.includes('正在載入頁面'));
  }

  it('loads older tracked matches strictly before the snapshot, deduplicates, and keeps analytics bounded', async () => {
    const { players, matches } = realMatches();
    const inSnapshot = matches.slice(0, 6);
    const older = matches.slice(6);
    const calls: DatasetHistoryQuery[] = [];
    const client: DatasetApiClient = {
      load: async () => snapshot(players, inSnapshot),
      loadHistory: async (query) => {
        calls.push(query);
        // First page overlaps the snapshot by one match to prove deduplication.
        return query.cursor
          ? page(players, older.slice(3), false, matches.length, matches.at(-1)!.playedAt)
          : page(players, [inSnapshot.at(-1)!, ...older.slice(0, 3)], true, matches.length, matches.at(-1)!.playedAt);
      },
    };
    window.location.hash = '#/matches';
    await renderWith(client);
    await settle(() => container.textContent?.includes('仍有更舊資料可載入') ?? false);
    const text = () => container.textContent ?? '';
    expect(calls[0]).toEqual({ before: inSnapshot.at(-1)!.id, limit: 50 });
    expect(text()).toContain('分析範圍');
    expect(text()).toContain(`最新 ${inSnapshot.length} 場`);
    expect(text()).toContain(`已載入 ${inSnapshot.length + 3} 場`);
    expect(text()).toContain(`${matches.length} 場`);
    expect(text()).toContain('已追蹤戰績');
    expect(text()).not.toContain('完整生涯紀錄。');
    expect(text()).toContain('不是完整生涯紀錄');
    expect(text()).toContain(`${inSnapshot.length + 3} 場符合`);
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === '載入較舊戰績')!;
    await act(async () => { button.click(); });
    await settle(() => text().includes('已載入全部已追蹤戰績'));
    expect(calls[1]).toEqual({ cursor: 'opaque.cursor-value-0000000', limit: 50 });
    expect(text()).toContain(`已載入 ${matches.length} 場`);
    expect(text()).toContain(`${matches.length} 場符合`);
    expect([...container.querySelectorAll('button')].some((candidate) => candidate.textContent === '載入較舊戰績')).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('restarts from the newest page when the snapshot anchor is no longer visible', async () => {
    const { players, matches } = realMatches();
    const calls: DatasetHistoryQuery[] = [];
    const client: DatasetApiClient = {
      load: async () => snapshot(players, matches.slice(0, 4)),
      loadHistory: async (query) => {
        calls.push(query);
        if (query.before) throw new BackendApiError('BAD_REQUEST', 'invalid position');
        return page(players, matches, false, matches.length, matches.at(-1)!.playedAt);
      },
    };
    window.location.hash = '#/matches';
    await renderWith(client);
    await settle(() => container.textContent?.includes('已載入全部已追蹤戰績') ?? false);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ limit: 50 });
    expect(container.textContent).toContain(`已載入 ${matches.length} 場`);
  });

  it('analytics routes are identical before and after loading older history pages (DATA-03B.2A)', async () => {
    const { players, matches } = realMatches();
    const client: DatasetApiClient = {
      load: async () => snapshot(players, matches.slice(0, 20)),
      loadHistory: async () => page(players, matches.slice(20), false, matches.length, matches.at(-1)!.playedAt),
    };
    window.location.hash = '#/leaderboard';
    await renderWith(client);
    await settle(() => container.textContent?.includes('資料範圍：目前實力') ?? false);
    const ranking = () => container.querySelector('table')?.textContent ?? '';
    const before = ranking();
    expect(before.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('資料範圍：目前實力');
    const go = async (path: string) => {
      const link = [...container.querySelectorAll('a')].find((anchor) => anchor.getAttribute('href') === `#${path}`)!;
      await act(async () => { link.click(); });
    };
    await go('/matches');
    await settle(() => container.textContent?.includes('已載入全部已追蹤戰績') ?? false);
    expect((container.textContent ?? '').match(/已載入 \d+ 場/u)?.[0]).toBe(`已載入 ${matches.length} 場`);
    await go('/leaderboard');
    await settle(() => container.textContent?.includes('資料範圍：目前實力') ?? false);
    expect(ranking()).toBe(before);
  });

  it('never requests history in Demo mode', async () => {
    let historyCalls = 0;
    window.location.hash = '#/matches';
    await renderWith({ load: async () => { throw new Error('unused'); }, loadHistory: async () => { historyCalls += 1; throw new Error('unused'); } }, true);
    expect(historyCalls).toBe(0);
    expect(container.textContent).not.toContain('已追蹤戰績');
  });
});
