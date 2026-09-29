export interface StoredAvatar {
  playerId: string;
  blob: Blob;
  updatedAt: string;
}

export interface AvatarRepository {
  get(playerId: string): Promise<StoredAvatar | null>;
  save(playerId: string, blob: Blob): Promise<StoredAvatar>;
  remove(playerId: string): Promise<void>;
}
