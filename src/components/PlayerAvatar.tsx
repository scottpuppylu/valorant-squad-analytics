import { useAvatars } from '../hooks/useAvatars';
import type { Player } from '../types/valorant';
import { resolvePlayerEmoji } from '../utils/avatar';

interface PlayerAvatarProps {
  player: Player;
  size?: 'small' | 'large';
}

export function PlayerAvatar({ player, size = 'small' }: PlayerAvatarProps) {
  const { avatars } = useAvatars();
  const emoji = resolvePlayerEmoji(player, avatars.get(player.id)?.emoji);
  const className = size === 'large' ? 'player-avatar player-avatar--large' : 'player-avatar';
  return (
    <span className={className} style={{ '--player-accent': player.accent } as React.CSSProperties} role="img" aria-label={`${player.handle} 的 emoji 頭像：${emoji}`}>
      {emoji}
    </span>
  );
}
