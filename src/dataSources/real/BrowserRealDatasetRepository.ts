import type { MatchRecord, Player } from '../../types/valorant';
import { isPlayerEmoji } from '../../utils/avatar';
import type { NormalizedAnalyticsDataset } from '../types';

export const realDatasetStorageKey = 'goblin-survey:real-dataset:v1';
const schemaVersion = 1;

interface StoredRealDataset {
  schemaVersion: 1;
  importedAt: string;
  dataset: NormalizedAnalyticsDataset;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlayer(value: unknown): value is Player {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.handle === 'string'
    && typeof value.displayName === 'string'
    && (value.role === undefined || ['Duelist', 'Initiator', 'Controller', 'Sentinel'].includes(String(value.role)))
    && Array.isArray(value.agents)
    && value.agents.every((agent) => typeof agent === 'string' && agent.length > 0)
    && isPlayerEmoji(value.defaultEmoji);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPerformance(value: unknown): boolean {
  return isRecord(value)
    && typeof value.playerId === 'string'
    && typeof value.agent === 'string'
    && ['kills', 'deaths', 'assists', 'acs', 'adr', 'kast'].every((key) => isFiniteNumber(value[key]));
}

function isMatch(value: unknown): value is MatchRecord {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.startsWith('real-')
    && typeof value.playedAt === 'string'
    && typeof value.map === 'string'
    && typeof value.gameMode === 'string'
    && isFiniteNumber(value.scoreFor)
    && isFiniteNumber(value.scoreAgainst)
    && typeof value.won === 'boolean'
    && isFiniteNumber(value.durationMinutes)
    && Array.isArray(value.performances)
    && value.performances.length > 0
    && value.performances.every(isPerformance);
}

function isRealDataset(value: unknown): value is NormalizedAnalyticsDataset {
  return isRecord(value)
    && value.mode === 'REAL'
    && value.isDemo === false
    && typeof value.sourceId === 'string'
    && Array.isArray(value.players)
    && value.players.length > 0
    && value.players.every(isPlayer)
    && Array.isArray(value.matches)
    && value.matches.length > 0
    && value.matches.every(isMatch)
    && !JSON.stringify(value).toLowerCase().includes('puuid');
}

export class BrowserRealDatasetRepository {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  load(): StoredRealDataset | null {
    const serialized = this.storage.getItem(realDatasetStorageKey);
    if (!serialized) return null;
    try {
      const value = JSON.parse(serialized) as unknown;
      if (!isRecord(value) || value.schemaVersion !== schemaVersion || typeof value.importedAt !== 'string' || !isRealDataset(value.dataset)) {
        this.storage.removeItem(realDatasetStorageKey);
        return null;
      }
      return value as unknown as StoredRealDataset;
    } catch {
      this.storage.removeItem(realDatasetStorageKey);
      return null;
    }
  }

  save(dataset: NormalizedAnalyticsDataset, importedAt: string): void {
    if (!isRealDataset(dataset)) throw new Error('只允許保存已正規化且去識別化的真實資料集。');
    this.storage.setItem(realDatasetStorageKey, JSON.stringify({ schemaVersion, importedAt, dataset } satisfies StoredRealDataset));
  }

  remove(): void {
    this.storage.removeItem(realDatasetStorageKey);
  }
}

function browserRepository(): BrowserRealDatasetRepository | null {
  if (typeof window === 'undefined') return null;
  try {
    return new BrowserRealDatasetRepository(window.localStorage);
  } catch {
    return null;
  }
}

export function loadBrowserRealDataset(): StoredRealDataset | null {
  try {
    return browserRepository()?.load() ?? null;
  } catch {
    return null;
  }
}

export function saveBrowserRealDataset(dataset: NormalizedAnalyticsDataset, importedAt: string): void {
  const repository = browserRepository();
  if (!repository) throw new Error('目前瀏覽器無法保存戰績資料。');
  repository.save(dataset, importedAt);
}

export function removeBrowserRealDataset(): void {
  try {
    browserRepository()?.remove();
  } catch {
    // Storage can be unavailable in hardened browser contexts; demo mode remains usable.
  }
}
