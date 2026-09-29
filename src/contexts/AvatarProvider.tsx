import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { players } from '../data/players';
import { BrowserAvatarRepository } from '../dataSources/avatars/BrowserAvatarRepository';
import type { AvatarRepository, StoredAvatar } from '../types/avatar';
import { AvatarContext } from './AvatarContext';

interface AvatarProviderProps {
  children: ReactNode;
  repository?: AvatarRepository;
}

export function AvatarProvider({ children, repository }: AvatarProviderProps) {
  const activeRepository = useMemo(() => repository ?? new BrowserAvatarRepository(), [repository]);
  const [avatars, setAvatars] = useState<ReadonlyMap<string, StoredAvatar>>(new Map());
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all(players.map(async (player) => [player.id, await activeRepository.get(player.id)] as const))
      .then((records) => {
        if (!active) return;
        setAvatars(new Map(records.filter((entry): entry is readonly [string, StoredAvatar] => entry[1] !== null)));
      })
      .catch(() => active && setStorageError('無法讀取瀏覽器內的自訂頭像。'));
    return () => { active = false; };
  }, [activeRepository]);

  const value = useMemo(() => ({
    avatars,
    storageError,
    async saveAvatar(playerId: string, blob: Blob) {
      const record = await activeRepository.save(playerId, blob);
      setAvatars((current) => new Map(current).set(playerId, record));
      setStorageError(null);
    },
    async resetAvatar(playerId: string) {
      await activeRepository.remove(playerId);
      setAvatars((current) => {
        const next = new Map(current);
        next.delete(playerId);
        return next;
      });
      setStorageError(null);
    },
  }), [activeRepository, avatars, storageError]);

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}
