import type { Player } from '../types/valorant';

export const acceptedAvatarTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const maxAvatarFileBytes = 8 * 1024 * 1024;
export const avatarTargetPixels = 384;

export type AvatarFallback =
  | { kind: 'custom'; source: string }
  | { kind: 'default'; source: string }
  | { kind: 'initials'; source: string };

export function getPlayerInitials(player: Pick<Player, 'handle'>): string {
  return player.handle.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '玩家';
}

export function resolveAvatarFallback(player: Pick<Player, 'handle' | 'defaultAvatarUrl'>, customUrl?: string | null): AvatarFallback {
  if (customUrl) return { kind: 'custom', source: customUrl };
  if (player.defaultAvatarUrl) return { kind: 'default', source: player.defaultAvatarUrl };
  return { kind: 'initials', source: getPlayerInitials(player) };
}

export function validateAvatarFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!acceptedAvatarTypes.includes(file.type as (typeof acceptedAvatarTypes)[number])) {
    return '不支援此檔案格式。請選擇 JPEG、PNG 或 WebP 圖片。';
  }
  if (file.size <= 0) return '圖片檔案是空的。';
  if (file.size > maxAvatarFileBytes) return '圖片超過 8 MB，請先縮小檔案後再試一次。';
  return null;
}

export async function processAvatarFile(file: File): Promise<Blob> {
  const validationError = validateAvatarFile(file);
  if (validationError) throw new Error(validationError);

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, avatarTargetPixels / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('瀏覽器無法處理這張圖片。');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const outputType = file.type === 'image/png' ? 'image/png' : 'image/webp';
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('圖片壓縮失敗，請改用其他圖片。')),
      outputType,
      outputType === 'image/png' ? undefined : 0.84,
    );
  });
}
