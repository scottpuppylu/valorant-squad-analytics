import type { AvatarRepository, PlayerEmoji, StoredAvatar } from '../../types/avatar';
import { isPlayerEmoji } from '../../utils/avatar';

export const PLAYER_EMOJI_STORAGE_KEY = 'valorant-squad-analytics:emoji-avatars:v1';

interface PersistedAvatarState {
  version: 1;
  overrides: Record<string, StoredAvatar>;
}

function emptyState(): PersistedAvatarState {
  return { version: 1, overrides: {} };
}

export class BrowserAvatarRepository implements AvatarRepository {
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage) {
    this.storage = storage;
  }

  private read(): PersistedAvatarState {
    const raw = this.storage.getItem(PLAYER_EMOJI_STORAGE_KEY);
    if (!raw) return emptyState();
    let candidate: Partial<PersistedAvatarState>;
    try {
      candidate = JSON.parse(raw) as Partial<PersistedAvatarState>;
    } catch {
      return emptyState();
    }
    if (candidate.version !== 1 || !candidate.overrides || typeof candidate.overrides !== 'object') return emptyState();

    const overrides = Object.fromEntries(
      Object.entries(candidate.overrides).filter((entry): entry is [string, StoredAvatar] => {
        const [playerId] = entry;
        const record = entry[1];
        return Boolean(
          record
          && typeof record === 'object'
          && record.playerId === playerId
          && isPlayerEmoji(record.emoji)
          && typeof record.updatedAt === 'string',
        );
      }),
    );
    return { version: 1, overrides };
  }

  async get(playerId: string): Promise<StoredAvatar | null> {
    return this.read().overrides[playerId] ?? null;
  }

  async save(playerId: string, emoji: PlayerEmoji): Promise<StoredAvatar> {
    const state = this.read();
    const record: StoredAvatar = { playerId, emoji, updatedAt: new Date().toISOString() };
    state.overrides[playerId] = record;
    this.storage.setItem(PLAYER_EMOJI_STORAGE_KEY, JSON.stringify(state));
    return record;
  }

  async remove(playerId: string): Promise<void> {
    const state = this.read();
    delete state.overrides[playerId];
    this.storage.setItem(PLAYER_EMOJI_STORAGE_KEY, JSON.stringify(state));
  }
}

export class MemoryAvatarRepository implements AvatarRepository {
  private readonly records = new Map<string, StoredAvatar>();

  async get(playerId: string): Promise<StoredAvatar | null> {
    return this.records.get(playerId) ?? null;
  }

  async save(playerId: string, emoji: PlayerEmoji): Promise<StoredAvatar> {
    const record = { playerId, emoji, updatedAt: new Date().toISOString() };
    this.records.set(playerId, record);
    return record;
  }

  async remove(playerId: string): Promise<void> {
    this.records.delete(playerId);
  }
}
