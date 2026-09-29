export const playerEmojiOptions = [
  '😀', '😎', '🤓', '🥷', '👽', '🤖', '👻', '💀',
  '🐺', '🦊', '🐯', '🦉', '🐢', '🐉', '🦄', '🐙',
  '⚡', '🔥', '🛡️', '🎯',
] as const;

export type PlayerEmoji = (typeof playerEmojiOptions)[number];

export interface StoredAvatar {
  playerId: string;
  emoji: PlayerEmoji;
  updatedAt: string;
}

export interface AvatarRepository {
  get(playerId: string): Promise<StoredAvatar | null>;
  save(playerId: string, emoji: PlayerEmoji): Promise<StoredAvatar>;
  remove(playerId: string): Promise<void>;
}
