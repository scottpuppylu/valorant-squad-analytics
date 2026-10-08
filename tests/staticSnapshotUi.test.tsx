// @vitest-environment happy-dom
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { AvatarProvider } from '../src/contexts/AvatarProvider';
import { DatasetProvider } from '../src/contexts/DatasetProvider';
import { StaticSnapshotClient } from '../src/dataSources/static/StaticSnapshotClient';
import { LocalFilesystemPublisher } from '../server/staticExport/publisher';
import type { DatasetReadyResponse } from '../src/dataSources/server/contracts';
import { readFile } from 'node:fs/promises';
import { STATIC_TEST_ORIGIN, exportFrom, fileFetch, seededStaticDatabase } from './support/staticSnapshotFixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * TASK-INFRA-STATIC-DATA-PUBLISH-01: the unchanged pages run on a published static snapshot only.
 * Every request is logged; none may reach `/api` (no Node API) or a provider host.
 */
let work: string;
let site: string;
let players: DatasetReadyResponse['dataset']['players'];

beforeAll(async () => {
  const db = await seededStaticDatabase(360, 9, { weapons: true });
  work = await mkdtemp(join(tmpdir(), 'static-ui-'));
  site = join(work, 'site');
  // Facts only: every page below runs the shared analysis core on public facts (nothing precomputed).
  const exported = await exportFrom(db, join(work, 'export'), { tier: 'facts' });
  await new LocalFilesystemPublisher(site).publish(exported.directory);
  players = (JSON.parse(await readFile(join(exported.directory, 'dataset.json'), 'utf8')) as DatasetReadyResponse).dataset.players;
  await db.close();
}, 300_000);
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

describe('static snapshot frontend (no Node API)', () => {
  let root: Root; let container: HTMLDivElement; let log: string[];
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); localStorage.clear(); log = []; });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 400 && !predicate(); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return predicate();
  };
  const render = async (hash: string) => {
    window.location.hash = hash;
    const client = new StaticSnapshotClient({ baseUrl: STATIC_TEST_ORIGIN, fetch: fileFetch(site, log) });
    await act(async () => { root.render(<DatasetProvider client={client} forceDemo={false}><AvatarProvider><App /></AvatarProvider></DatasetProvider>); });
  };
  const text = () => container.textContent ?? '';
  const failureText = /暫時無法取得|暫時無法讀取|未預先計算|沒有預先計算/u;
  const ready = (needle: string | RegExp) => () => (typeof needle === 'string' ? text().includes(needle) : needle.test(text())) && !/正在以伺服器|正在由伺服器|正在載入/u.test(text());

  const routes: [string, string | RegExp][] = [
    ['#/', /BenchPlayer/u],
    ['#/leaderboard', /BenchPlayer/u],
    ['#/leaderboard?period=all', /BenchPlayer/u],
    ['#/compare', /BenchPlayer/u],
    ['#/maps', '地圖總覽'],
    ['#/agents', '特務總覽'],
    ['#/agents?view=role', '角色總覽'],
    ['#/synergy', /BenchPlayer/u],
    ['#/weapons', '武器分析'],
    ['#/matches', /BenchPlayer|對手/u],
    ['#/dictionary', '指標'],
    ['#/about', '公開真實戰績'],
  ];

  for (const [hash, needle] of routes) {
    it(`renders ${hash} from the static snapshot`, async () => {
      await render(hash);
      expect(await settle(ready(needle)), text().slice(0, 300)).toBe(true);
      expect(text()).not.toMatch(failureText);
      expect(text()).not.toContain('虛構示範資料取代');
      expect(log.length).toBeGreaterThan(0);
      expect(log.filter((url) => !url.startsWith(STATIC_TEST_ORIGIN) || url.includes('/api/'))).toEqual([]);
    });
  }

  it('renders every member profile deep link (scores, progress, weapons) from public facts', async () => {
    for (const player of players) {
      await act(async () => root.unmount());
      root = createRoot(container);
      await render(`#/players/${player.id}`);
      // A member below the 目前實力 sample shows the explicit no-data state (same as the API); others show progress.
      const ok = await settle(() => ready(player.displayName)() && (!!container.querySelector('[aria-label="進步指數"]') || text().includes('目前條件無資料')));
      if (!ok) throw new Error(`${player.displayName}: ${text().slice(0, 300)}`);
      expect(text()).not.toMatch(failureText);
    }
    expect(log.some((url) => url.includes('/facts/matches-')) && log.some((url) => url.includes('/facts/weapons-'))).toBe(true);
    expect(log.filter((url) => !url.startsWith(STATIC_TEST_ORIGIN) || url.includes('/api/'))).toEqual([]);
  });

  it('pages match history on demand from static page files (the dashboard never fetches history)', async () => {
    await render('#/');
    await settle(ready(/BenchPlayer/u));
    expect(log.some((url) => url.includes('/history/'))).toBe(false);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render('#/matches');
    await settle(() => log.some((url) => url.endsWith('history/page-0001.json')) && !text().includes('正在載入較舊戰績'));
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === '載入較舊戰績');
    expect(button).toBeDefined();
    await act(async () => { button!.click(); });
    expect(await settle(() => log.some((url) => url.endsWith('history/page-0002.json')))).toBe(true);
  });

  const combinations: [string, string | RegExp][] = [
    ['#/leaderboard?map=Bind&agent=Sova', /BenchPlayer|沒有|資料不足/u],
    ['#/leaderboard?period=all&map=Haven&role=Duelist&mode=Competitive', /BenchPlayer|沒有|資料不足/u],
    ['#/leaderboard?period=recent10&agent=Jett', /BenchPlayer|沒有|資料不足/u],
    ['#/leaderboard?period=custom&from=2026-06-01&to=2026-09-30', /BenchPlayer|沒有|資料不足/u],
    ['#/maps?period=current&agent=Sova', '地圖總覽'],
    ['#/maps?period=custom&from=2026-07-01&to=2026-08-15&mode=Competitive', '地圖總覽'],
    ['#/agents?map=Lotus&period=recent30', '特務總覽'],
    ['#/compare?map=Split&agent=Omen', /BenchPlayer/u],
    ['#/synergy?map=Ascent&mode=Competitive&from=2026-06-01&to=2026-09-30', /BenchPlayer/u],
  ];
  for (const [hash, needle] of combinations) {
    it(`multi-filter / custom-date / form query ${hash} runs on public facts (never "not precomputed")`, async () => {
      await render(hash);
      expect(await settle(ready(needle)), text().slice(0, 300)).toBe(true);
      expect(text()).not.toMatch(failureText);
      expect(log.some((url) => url.includes('/facts/'))).toBe(true);
      expect(log.filter((url) => !url.startsWith(STATIC_TEST_ORIGIN) || url.includes('/api/') || url.includes('/analysis/'))).toEqual([]);
    });
  }

  it('weapon map × agent combination for a member runs on public weapon facts', async () => {
    await render(`#/weapons?player=${players[0]!.id}&map=Bind&agent=Sova`);
    expect(await settle(() => /武器分析/u.test(text()) && !/正在由伺服器/u.test(text())), text().slice(0, 200)).toBe(true);
    expect(text()).not.toMatch(failureText);
    expect(log.some((url) => url.includes('/facts/weapons-'))).toBe(true);
  });
});
