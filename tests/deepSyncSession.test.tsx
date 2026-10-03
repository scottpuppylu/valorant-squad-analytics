// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectPage } from '../src/pages/ConnectPage';
import { DatasetContext, type DatasetContextValue } from '../src/contexts/DatasetContext';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import { buildAnalytics } from '../src/data/analytics';
import { BackendApiError, valorantBackendClient } from '../src/dataSources/server/ValorantBackendClient';
import type { PublicSyncProgress } from '../src/dataSources/server/contracts';
import { DEEP_SYNC_STORAGE_KEY, deepContinuationDelay, loadDeepSyncSession, saveDeepSyncSession } from '../src/dataSources/server/deepSyncSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const playerId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';
const demo = demoDataSource.snapshot();
const context: DatasetContextValue = { status: 'demo', source: 'DEMO', dataset: demo, analytics: buildAnalytics(demo), refresh: async () => {} };
function progress(nextAttemptAt?: string): PublicSyncProgress {
  return { runId, kind: 'deep_backfill', status: 'paused', nextAttemptAt,
    history: { ruleVersion: 'deep-history-v1', historyPhase: 'stored_index', storedPage: 2, storedItemIndex: 1, liveHistoryExhausted: true, storedHistoryExhausted: false, sourceExhausted: false, lifetimeComplete: false },
    progress: { pages: 3, matchesSeen: 7, matchesPersisted: 6, overlapsUpdated: 1, retries: 0 },
    coverage: { completeForProviderWindow: false },
    performance: { providerFetchMs: 0, normalizationMs: 0, databaseMs: 0, totalMs: 0, sqlQueryCount: 0, providerRequests: 4 },
  };
}
describe('deep sync browser orchestration', () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => {
    localStorage.clear(); vi.useFakeTimers();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    vi.spyOn(valorantBackendClient, 'providerStatus').mockResolvedValue({ ok: true, provider: { usable: true, mode: 'configured' } });
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });
  async function render() { await act(async () => root.render(<DatasetContext.Provider value={context}><MemoryRouter><ConnectPage /></MemoryRouter></DatasetContext.Provider>)); }
  async function click(text: string) { const button = [...host.querySelectorAll('button')].find((item) => item.textContent === text)!; expect(button).toBeDefined(); await act(async () => button.click()); }
  it('persists only versioned public recovery IDs and rejects malformed preferences', () => {
    saveDeepSyncSession(playerId, runId);
    expect(loadDeepSyncSession()).toEqual({ playerId, runId });
    expect(Object.keys(JSON.parse(localStorage.getItem(DEEP_SYNC_STORAGE_KEY)!))).toEqual(['version', 'playerId', 'runId']);
    localStorage.setItem(DEEP_SYNC_STORAGE_KEY, '{broken');
    expect(loadDeepSyncSession()).toBeUndefined(); expect(localStorage.getItem(DEEP_SYNC_STORAGE_KEY)).toBeNull();
    localStorage.setItem(DEEP_SYNC_STORAGE_KEY, JSON.stringify({ version: 1, playerId: {}, runId }));
    expect(loadDeepSyncSession()).toBeUndefined();
  });
  it('rejects invalid deadlines and complete/cancelled/stalled or incremental continuation', () => {
    expect(deepContinuationDelay(progress(), 0)).toBe(7_000);
    expect(deepContinuationDelay(progress('1970-01-01T00:01:00Z'), 0)).toBe(60_000);
    expect(deepContinuationDelay(progress('bad'), 0)).toBeUndefined();
    for (const status of ['complete', 'cancelled', 'failed'] as const) expect(deepContinuationDelay({ ...progress(), status })).toBeUndefined();
    expect(deepContinuationDelay({ ...progress(), kind: 'incremental' })).toBeUndefined();
  });
  it('restores readonly progress on refresh but sends no provider-writing request before explicit resume', async () => {
    saveDeepSyncSession(playerId, runId);
    vi.spyOn(valorantBackendClient, 'syncStatus').mockResolvedValue({ ok: true, sync: progress() });
    const request = vi.spyOn(valorantBackendClient, 'continueSync').mockResolvedValue({ ok: true, sync: progress() });
    await render(); await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(request).not.toHaveBeenCalled(); expect(host.textContent).toContain('歷史同步進度已保存');
    await click('恢復歷史同步'); await act(async () => vi.advanceTimersByTimeAsync(6_999)); expect(request).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(request).toHaveBeenCalledOnce();
    await click('暫停自動續跑'); await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(request).toHaveBeenCalledOnce();
  });
  it('honors persisted retry time, stops on unmount, and never loops on terminal errors', async () => {
    saveDeepSyncSession(playerId, runId);
    vi.spyOn(valorantBackendClient, 'syncStatus').mockResolvedValue({ ok: true, sync: progress(new Date(Date.now() + 60_000).toISOString()) });
    const request = vi.spyOn(valorantBackendClient, 'continueSync').mockRejectedValue(new BackendApiError('CONSENT_REVOKED', '同意已撤回'));
    await render(); await click('恢復歷史同步');
    await act(async () => vi.advanceTimersByTimeAsync(59_999)); expect(request).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(request).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(120_000)); expect(request).toHaveBeenCalledOnce();
    await click('恢復歷史同步'); await act(async () => root.render(<p>離開頁面</p>));
    await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(request).toHaveBeenCalledOnce();
  });
  it('source exhaustion stops automatic continuation and does not display an active pause control', async () => {
    saveDeepSyncSession(playerId, runId);
    vi.spyOn(valorantBackendClient, 'syncStatus').mockResolvedValue({ ok: true, sync: progress() });
    const complete = { ...progress(), status: 'complete' as const, history: { ...progress().history!, historyPhase: 'complete' as const, storedHistoryExhausted: true, sourceExhausted: true } };
    const request = vi.spyOn(valorantBackendClient, 'continueSync').mockResolvedValue({ ok: true, sync: complete });
    await render(); await click('恢復歷史同步'); await act(async () => vi.advanceTimersByTimeAsync(7_000));
    expect(host.textContent).toContain('已達目前資料來源最舊可取得紀錄');
    expect(host.textContent).not.toContain('暫停自動續跑');
    await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(request).toHaveBeenCalledOnce();
  });
});
