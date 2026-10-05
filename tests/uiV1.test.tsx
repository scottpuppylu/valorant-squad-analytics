// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/components/AppShell';
import { SourceBadge } from '../src/components/SourceBadge';
import { StatusBadge } from '../src/components/StatusBadge';
import { EmptyState } from '../src/components/EmptyState';
import { DatasetRuntimeBoundary } from '../src/components/DatasetRuntimeBoundary';
import { CompareTables } from '../src/components/CompareTables';
import { SynergyPage } from '../src/pages/SynergyPage';
import { DictionaryPage } from '../src/pages/DictionaryPage';
import { ConnectPage } from '../src/pages/ConnectPage';
import { PlayerProfilePage } from '../src/pages/PlayerProfilePage';
import { valorantBackendClient } from '../src/dataSources/server/ValorantBackendClient';
import { DatasetContext, type DatasetContextValue } from '../src/contexts/DatasetContext';
import { AvatarProvider } from '../src/contexts/AvatarProvider';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import { buildAnalytics } from '../src/data/analytics';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const demo = demoDataSource.snapshot();
const context: DatasetContextValue = {status:'demo',source:'DEMO',dataset:demo,analytics:buildAnalytics(demo),refresh:async()=>{}};
describe('V1 presentation and accessibility', () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => { host=document.createElement('div');document.body.append(host);root=createRoot(host); });
  afterEach(async () => {await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
  async function render(node:ReactNode,value=context){await act(async()=>root.render(<DatasetContext.Provider value={value}><MemoryRouter><AvatarProvider>{node}</AvatarProvider></MemoryRouter></DatasetContext.Provider>));}
  it.each(['available','partial','unavailable'] as const)('labels %s evidence without relying on color',async(status)=>{
    await render(<StatusBadge status={status} coverage={0.75}/>);
    expect(host.textContent).toContain(status==='available'?'完整':status==='partial'?'部分證據 · 75%':'資料不足');
  });
  it.each(['demo','loading','stale','ready'] as const)('presents %s source state consistently',async(status)=>{
    await render(<SourceBadge status={status} source={status==='demo'?'DEMO':'REAL_SERVER'}/>);
    expect(host.querySelector('[role=status]')).not.toBeNull();
    expect(host.textContent).toContain(status==='demo'?'虛構示範資料':status==='loading'?'載入中':'公開真實戰績');
    if(status==='stale')expect(host.textContent).toContain('上次成功資料');
  });
  it('refreshing source is distinct from a retained failed-refresh snapshot',async()=>{
    await render(<SourceBadge status="stale" source="REAL_SERVER" refreshing/>);
    expect(host.textContent).toContain('正在重新整理');
  });
  it('mobile disclosure supports Escape and returns focus',async()=>{
    await render(<AppShell><p>分析內容</p></AppShell>);
    const toggle=host.querySelector<HTMLButtonElement>('.mobile-menu-toggle')!;
    await act(async()=>toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(host.querySelector('#mobile-navigation a'));
    await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
  it('mobile links close menu and move focus to main on navigation',async()=>{
    await render(<AppShell><Link to="/leaderboard">測試內容</Link></AppShell>);
    await act(async()=>host.querySelector<HTMLButtonElement>('.mobile-menu-toggle')!.click());
    await act(async()=>host.querySelector<HTMLAnchorElement>('#mobile-navigation a[href="/leaderboard"]')!.click());
    expect(host.querySelector('#mobile-navigation')).toBeNull();
    expect(document.activeElement?.id).toBe('main-content');
    expect(host.querySelector('a[aria-current=page]')?.textContent).toBe('戰力排名');
  });
  it('More is click/keyboard accessible and contains secondary routes',async()=>{
    await render(<AppShell>內容</AppShell>);
    const more=host.querySelector<HTMLButtonElement>('button[aria-controls=more-navigation]')!;
    await act(async()=>more.click());
    expect(host.querySelector('#more-navigation')?.textContent).toContain('數據字典');
    expect(document.activeElement).toBe(host.querySelector('#more-navigation a'));
    await act(async()=>more.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(document.activeElement).toBe(more);
  });
  it('same-route mobile navigation still closes and restores a useful focus target',async()=>{
    await render(<AppShell>內容</AppShell>);
    await act(async()=>host.querySelector<HTMLButtonElement>('.mobile-menu-toggle')!.click());
    await act(async()=>host.querySelector<HTMLAnchorElement>('#mobile-navigation a[href="/"]')!.click());
    expect(host.querySelector('#mobile-navigation')).toBeNull();
    expect(document.activeElement?.id).toBe('main-content');
  });
  it('empty state has heading and a useful action',async()=>{
    await render(<EmptyState page title="沒有配對" description="請調整條件" actions={<button>重設條件</button>}/>);
    expect(host.querySelector('h1')?.textContent).toBe('沒有配對');expect(host.querySelector('button')?.textContent).toBe('重設條件');
  });
  async function boundary(status:DatasetContextValue['status']){
    const refresh=vi.fn(async()=>{});
    await render(<Routes><Route element={<DatasetRuntimeBoundary/>}><Route path="/" element={<p>先前成功資料</p>}/></Route></Routes>,{...context,status,source:'REAL_SERVER',message:'internal-server-detail',refresh});return refresh;
  }
  it('loading panel presents no fabricated scores',async()=>{await boundary('loading');expect(host.querySelector('[role=status]')).not.toBeNull();expect(host.textContent).toContain('正在準備分析資料');expect(host.textContent).not.toContain('先前成功資料');});
  it('stale data remains visible with a recovery action',async()=>{const refresh=await boundary('stale');expect(host.textContent).toContain('先前成功資料');expect(host.textContent).not.toContain('internal-server-detail');await act(async()=>host.querySelector('button')!.click());expect(refresh).toHaveBeenCalledOnce();});
  it('error state hides technical details and offers refresh without Demo',async()=>{const refresh=await boundary('error');expect(host.querySelector('[role=alert]')).not.toBeNull();expect(host.textContent).not.toContain('internal-server-detail');expect(host.textContent).not.toContain('NovaHex');await act(async()=>host.querySelector('button')!.click());expect(refresh).toHaveBeenCalledOnce();});
  it('REAL empty is precise and does not render Demo players',async()=>{await boundary('empty');expect(host.textContent).toContain('目前尚無可分析的真實對戰');expect(host.querySelector('a[href="/connect"]')).not.toBeNull();expect(host.textContent).not.toContain('NovaHex');});
  it('comparison retains core scores and all long-tail statistics under disclosure',async()=>{
    const players=context.analytics.playerAnalytics.slice(0,4).map(p=>({...p,player:{...p.player,handle:'非常長的玩家顯示名稱與標籤'.repeat(5)}}));
    await render(<CompareTables analytics={players}/>);
    expect(host.querySelectorAll('thead th')).toHaveLength(10);
    expect(host.querySelector('details')?.open).toBe(false);
    expect(host.querySelector('details')?.textContent).toContain('FK/FD');
    expect(host.querySelector('th[scope=row]')?.textContent).toBe('綜合表現');
    expect(host.querySelectorAll('[role=region][tabindex="0"]')).toHaveLength(2);
  });
  it('Synergy detail precedes list and collapsed matrix without changing URL selection',async()=>{
    await render(<SynergyPage/>);
    const detail=host.querySelector('#pair-detail')!, matrix=host.querySelector('details.pair-matrix')!;
    expect(detail.compareDocumentPosition(matrix)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((matrix as HTMLDetailsElement).open).toBe(false);
    expect(matrix.querySelector('summary')?.textContent).toBe('查看完整矩陣');
    // Player A/B, 資料範圍 (全部已追蹤／指定 Act), map, mode.
    expect(host.querySelectorAll('label select')).toHaveLength(5);
  });
  it('dictionary group buttons retain search and evidence availability labels',async()=>{
    await render(<DictionaryPage/>);
    const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='搭檔分析')!;
    await act(async()=>button.click());expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('details').length).toBeGreaterThan(0);
    expect(host.querySelector('input[type=search]')).not.toBeNull();
    expect(host.querySelector('details')?.textContent).toContain('搭檔');
  });
  it('invalid player link has a recovery action',async()=>{
    await render(<PlayerProfilePage/>);
    expect(host.querySelector('h1')?.textContent).toBe('這個玩家連結不存在');
    expect(host.querySelector('a[href="/leaderboard"]')?.textContent).toBe('返回戰力排名');
  });
  it('Connect labels inputs and preserves explicit consent before any request',async()=>{
    vi.spyOn(valorantBackendClient,'providerStatus').mockRejectedValue(new Error('fixture-only'));
    const resolve=vi.spyOn(valorantBackendClient,'resolveAccount');
    await render(<ConnectPage/>);
    expect(host.querySelector('[aria-label="加入流程"]')).not.toBeNull();
    expect(host.textContent).toContain('目前狀態：尚未連接');
    expect(host.textContent).toContain('任何取得網站網址的人都可以瀏覽');
    expect(host.querySelector('form button')?.hasAttribute('disabled')).toBe(true);
    expect([...host.querySelectorAll('form label input')].map(input=>input.parentElement?.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Riot ID'),expect.stringContaining('Tag')]));
    expect(resolve).not.toHaveBeenCalled();
  });
});
