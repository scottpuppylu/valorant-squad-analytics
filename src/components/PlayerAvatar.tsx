import { useEffect, useState } from 'react';
import { useAvatars } from '../hooks/useAvatars';
import type { Player } from '../types/valorant';
import { getPlayerInitials, resolveAvatarFallback } from '../utils/avatar';

interface PlayerAvatarProps {
  player: Player;
  size?: 'small' | 'large';
  previewBlob?: Blob | null;
}

export function PlayerAvatar({ player, size = 'small', previewBlob }: PlayerAvatarProps) {
  const { avatars } = useAvatars();
  const customBlob = previewBlob ?? avatars.get(player.id)?.blob ?? null;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedAvatar, setLoadedAvatar] = useState<{ blob: Blob; source: string } | null>(null);
  const customUrl = customBlob && loadedAvatar?.blob === customBlob ? loadedAvatar.source : null;
  const fallback = resolveAvatarFallback(player, customUrl === failedSource ? null : customUrl);
  const defaultFailed = fallback.kind === 'default' && failedSource === fallback.source;

  useEffect(() => {
    if (!customBlob) return undefined;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      setLoadedAvatar({ blob: customBlob, source: reader.result });
      setFailedSource(null);
    };
    reader.readAsDataURL(customBlob);
    return () => {
      reader.onload = null;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [customBlob]);

  const className = size === 'large' ? 'player-avatar player-avatar--large' : 'player-avatar';
  if (fallback.kind === 'initials' || defaultFailed) {
    return (
      <span className={className} style={{ '--player-accent': player.accent } as React.CSSProperties} role="img" aria-label={`${player.handle} 的預設字母頭像`}>
        {getPlayerInitials(player)}
      </span>
    );
  }

  return (
    <span className={className} style={{ '--player-accent': player.accent } as React.CSSProperties}>
      <img src={fallback.source} alt={`${player.handle} 的玩家頭像`} onError={() => setFailedSource(fallback.source)} />
    </span>
  );
}
