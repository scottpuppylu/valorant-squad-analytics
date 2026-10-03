import { describe, expect, it, vi } from 'vitest';
import { HenrikDataProvider } from '../server/henrikDataProvider';
import type { HistoricalDiscoveryProvider } from '../server/sync/historicalDiscoveryProvider';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';

const input = { gameName: 'Fictional / 玩家', tag: 'A#B', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;
describe('historical discovery adapter contract (no live HTTP)', () => {
  it('encodes name/tag, uses size/start versus 1-based size/page, and requests single-object detail', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => { expect(String(url)).toMatch(/^https:\/\/api\.henrikdev\.xyz\//); return new Response(JSON.stringify({ status: 200, data: [] })); });
    const provider: HistoricalDiscoveryProvider = new HenrikDataProvider('fictional-test-key', { fetchImpl, retries: 0 });
    await provider.fetchHistoryPage(input, 303, 3);
    await provider.fetchStoredIndexPage(input, 2, 3);
    await provider.fetchMatchDetail(input, 'fictional/id');
    const urls = fetchImpl.mock.calls.map((call) => new URL(String(call[0])));
    expect(urls[0]!.pathname).toContain('/valorant/v4/matches/ap/pc/Fictional%20%2F%20');
    expect(urls[0]!.searchParams.get('start')).toBe('303');
    expect(urls[1]!.pathname).toContain('/valorant/v1/stored-matches/ap/');
    expect(urls[1]!.searchParams.get('page')).toBe('2'); expect(urls[1]!.searchParams.get('size')).toBe('3');
    expect(urls[2]!.pathname).toBe('/valorant/v4/match/ap/fictional%2Fid');
  });
  it('bounded sync configuration does not hide 5xx retries inside an invocation', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }));
    const provider = new HenrikDataProvider('fictional-test-key', { fetchImpl, retries: 0 });
    await expect(provider.fetchStoredIndexPage(input, 1, 3)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
