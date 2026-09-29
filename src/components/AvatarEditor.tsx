import { useRef, useState } from 'react';
import { useAvatars } from '../hooks/useAvatars';
import type { Player } from '../types/valorant';
import { processAvatarFile } from '../utils/avatar';
import { PlayerAvatar } from './PlayerAvatar';

interface AvatarEditorProps {
  player: Player;
}

export function AvatarEditor({ player }: AvatarEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { avatars, saveAvatar, resetAvatar, storageError } = useAvatars();
  const [preview, setPreview] = useState<Blob | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasCustomAvatar = avatars.has(player.id);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      setPreview(await processAvatarFile(file));
      setMessage('預覽已準備完成；按「儲存頭像」才會保留。');
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : '圖片處理失敗。');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    try {
      await saveAvatar(player.id, preview);
      setPreview(null);
      setMessage('頭像已儲存在此瀏覽器。');
    } catch {
      setMessage('儲存失敗，請確認瀏覽器允許網站使用 IndexedDB。');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await resetAvatar(player.id);
      setPreview(null);
      setMessage('已重設為預設頭像。');
      if (inputRef.current) inputRef.current.value = '';
    } catch {
      setMessage('重設失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="avatar-editor" aria-labelledby="avatar-editor-title">
      <PlayerAvatar player={player} size="large" previewBlob={preview} />
      <div className="min-w-0">
        <h2 id="avatar-editor-title" className="text-base font-semibold text-white">自訂玩家頭像</h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">支援 JPEG、PNG、WebP，最多 8 MB；儲存前會縮放至最長邊 384px。</p>
        <p className="mt-2 text-xs leading-5 text-amber-200/80">目前自訂頭像只儲存在此瀏覽器。未來連接帳號系統後可同步至所有裝置。</p>
        <input
          ref={inputRef}
          className="sr-only"
          id="avatar-upload"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="button-secondary" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? '處理中…' : '選擇圖片'}</button>
          <button className="button-primary" type="button" disabled={busy || !preview} onClick={() => void save()}>儲存頭像</button>
          <button className="button-secondary" type="button" disabled={busy || (!preview && !hasCustomAvatar)} onClick={() => void reset()}>重設頭像</button>
        </div>
        {message || storageError ? <p className="mt-3 text-xs text-slate-300" role="status">{message ?? storageError}</p> : null}
      </div>
    </section>
  );
}
