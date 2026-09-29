import { createContext } from 'react';
import type { StoredAvatar } from '../types/avatar';

export interface AvatarContextValue {
  avatars: ReadonlyMap<string, StoredAvatar>;
  saveAvatar(playerId: string, blob: Blob): Promise<void>;
  resetAvatar(playerId: string): Promise<void>;
  storageError: string | null;
}

export const AvatarContext = createContext<AvatarContextValue | null>(null);
