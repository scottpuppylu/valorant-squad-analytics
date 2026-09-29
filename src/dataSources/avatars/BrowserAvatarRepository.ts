import type { AvatarRepository, StoredAvatar } from '../../types/avatar';

const DATABASE_NAME = 'valorant-squad-analytics';
const STORE_NAME = 'player-avatars';
const DATABASE_VERSION = 1;

export class BrowserAvatarRepository implements AvatarRepository {
  private readonly indexedDb: IDBFactory;

  constructor(indexedDb: IDBFactory = window.indexedDB) {
    this.indexedDb = indexedDb;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'playerId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('無法開啟瀏覽器頭像資料庫。'));
    });
  }

  async get(playerId: string): Promise<StoredAvatar | null> {
    const database = await this.open();
    return new Promise<StoredAvatar | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(playerId);
      request.onsuccess = () => resolve((request.result as StoredAvatar | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('無法讀取自訂頭像。'));
    }).finally(() => database.close());
  }

  async save(playerId: string, blob: Blob): Promise<StoredAvatar> {
    const database = await this.open();
    const record: StoredAvatar = { playerId, blob, updatedAt: new Date().toISOString() };
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('無法儲存自訂頭像。'));
    }).finally(() => database.close());
    return record;
  }

  async remove(playerId: string): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(playerId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('無法重設自訂頭像。'));
    }).finally(() => database.close());
  }
}

export class MemoryAvatarRepository implements AvatarRepository {
  private readonly records = new Map<string, StoredAvatar>();

  async get(playerId: string): Promise<StoredAvatar | null> {
    return this.records.get(playerId) ?? null;
  }

  async save(playerId: string, blob: Blob): Promise<StoredAvatar> {
    const record = { playerId, blob, updatedAt: new Date().toISOString() };
    this.records.set(playerId, record);
    return record;
  }

  async remove(playerId: string): Promise<void> {
    this.records.delete(playerId);
  }
}
