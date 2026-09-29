import { describe, expect, it } from 'vitest';
import { BrowserRealDatasetRepository, realDatasetStorageKey } from '../src/dataSources/real/BrowserRealDatasetRepository';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

function realDataset(): NormalizedAnalyticsDataset {
  return {
    mode: 'REAL', isDemo: false, sourceId: 'test-normalized',
    players: [{ id: 'real-player', handle: 'GoblinScout#TW', displayName: 'GoblinScout', role: 'Duelist', agents: ['Jett'], accent: '#6ee7b7', tagline: 'test', playstyle: 'test', defaultEmoji: '🤖' }],
    matches: [{ id: 'real-0123456789abcdefabcd', playedAt: '2026-09-29T12:00:00.000Z', map: 'Ascent', gameMode: 'Competitive', opponent: '對手隊伍', scoreFor: 13, scoreAgainst: 8, won: true, durationMinutes: 35, performances: [{ playerId: 'real-player', agent: 'Jett', kills: 20, deaths: 12, assists: 5, acs: 250, adr: 160, kast: 0.75 }] }],
  };
}

describe('browser-local real dataset repository', () => {
  it('persists and removes only a normalized REAL dataset', () => {
    const storage = memoryStorage();
    const repository = new BrowserRealDatasetRepository(storage);
    repository.save(realDataset(), '2026-09-29T12:30:00.000Z');
    expect(repository.load()?.dataset.mode).toBe('REAL');
    repository.remove();
    expect(repository.load()).toBeNull();
  });

  it('removes malformed or identifier-bearing stored data and falls back safely', () => {
    const storage = memoryStorage();
    const repository = new BrowserRealDatasetRepository(storage);
    storage.setItem(realDatasetStorageKey, '{broken');
    expect(repository.load()).toBeNull();
    storage.setItem(realDatasetStorageKey, JSON.stringify({ schemaVersion: 1, importedAt: 'now', dataset: { ...realDataset(), puuid: 'not-allowed' } }));
    expect(repository.load()).toBeNull();
    expect(storage.values.has(realDatasetStorageKey)).toBe(false);
  });
});
