import { playerEmojiOptions, type PlayerEmoji } from '../types/avatar';
import type { Player } from '../types/valorant';

const emojiSet = new Set<string>(playerEmojiOptions);

export function isPlayerEmoji(value: unknown): value is PlayerEmoji {
  return typeof value === 'string' && emojiSet.has(value);
}

export function resolvePlayerEmoji(
  player: Pick<Player, 'defaultEmoji'>,
  override?: PlayerEmoji | null,
): PlayerEmoji {
  return override ?? player.defaultEmoji;
}
