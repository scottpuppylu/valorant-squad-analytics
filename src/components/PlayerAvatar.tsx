import { useEffect, useMemo, useState } from 'react';
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
  const customUrl = useMemo(() => customBlob ? URL.createObjectURL(customBlob) : null, [customBlob]);
  const fallback = resolveAvatarFallback(player, customUrl === failedSource ? null : customUrl);
  const defaultFailed = fallback.kind === 'default' && failedSource === fallback.source;

  useEffect(() => () => {
    if (customUrl) URL.revokeObjectURL(customUrl);
  }, [customUrl]);

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
