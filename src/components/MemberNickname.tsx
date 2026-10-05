import type { Player } from '../types/valorant';

/**
 * TASK-IDENTITY-01B: the optional second name of a member, always SECONDARY to the community name.
 * Renders nothing when unset (no empty "綽號" line). Never used as an id, route or sort key.
 */
export function MemberNickname({ player, prefix = false, className = 'text-xs text-slate-400' }: { player: Pick<Player, 'nickname'>; prefix?: boolean; className?: string }) {
  if (!player.nickname) return null;
  return <small className={className}>{prefix ? `綽號：${player.nickname}` : player.nickname}</small>;
}
