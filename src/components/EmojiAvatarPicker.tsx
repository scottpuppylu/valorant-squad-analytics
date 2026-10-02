import { useRef, useState } from 'react';
import { useAvatars } from '../hooks/useAvatars';
import { playerEmojiOptions, type PlayerEmoji } from '../types/avatar';
import type { Player } from '../types/valorant';
import { resolvePlayerEmoji } from '../utils/avatar';
import { PlayerAvatar } from './PlayerAvatar';

interface EmojiAvatarPickerProps {
  player: Player;
}

export function EmojiAvatarPicker({ player }: EmojiAvatarPickerProps) {
  const { avatars, saveAvatar, resetAvatar, storageError } = useAvatars();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const override = avatars.get(player.id)?.emoji;
  const currentEmoji = resolvePlayerEmoji(player, override);
  const pickerId = `emoji-picker-${player.id}`;

  async function chooseEmoji(emoji: PlayerEmoji) {
    setBusy(true);
    try {
      if (emoji === player.defaultEmoji) {
        await resetAvatar(player.id);
        setMessage(`已使用預設頭像 ${emoji}`);
      } else {
        await saveAvatar(player.id, emoji);
        setMessage(`已將 ${player.handle} 的頭像設為 ${emoji}`);
      }
      setOpen(false);
      trigger.current?.focus();
    } catch {
      setMessage('儲存失敗，請確認瀏覽器允許本站使用本機儲存空間。');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await resetAvatar(player.id);
      setMessage(`已重設為預設頭像 ${player.defaultEmoji}`);
      setOpen(false);
    } catch {
      setMessage('重設失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="avatar-editor" aria-labelledby="avatar-editor-title" onKeyDown={(event) => { if (event.key === 'Escape' && open) { setOpen(false); trigger.current?.focus(); } }}>
      <button
        ref={trigger}
        className="player-avatar-button"
        type="button"
        aria-expanded={open}
        aria-controls={pickerId}
        aria-label={`變更 ${player.handle} 的 emoji 頭像，目前為 ${currentEmoji}`}
        onClick={() => setOpen((value) => !value)}
      >
        <PlayerAvatar player={player} size="large" />
      </button>
      <div className="min-w-0 flex-1">
        <h2 id="avatar-editor-title" className="text-base font-semibold text-white">玩家 emoji 頭像</h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">點擊頭像選擇代表符號；設定只保存在目前瀏覽器。</p>
        {open ? (
          <div id={pickerId} className="emoji-picker" role="group" aria-label="選擇玩家頭像">
            <p className="emoji-picker__title">選擇玩家頭像</p>
            <div className="emoji-picker__grid">
              {playerEmojiOptions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="emoji-option"
                  aria-label={`使用 ${emoji} 作為頭像`}
                  aria-pressed={currentEmoji === emoji}
                  disabled={busy}
                  onClick={() => void chooseEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button className="button-secondary mt-3" type="button" disabled={busy || !override} onClick={() => void reset()}>
              重設頭像
            </button>
          </div>
        ) : null}
        {message || storageError ? <p className="mt-3 text-xs text-slate-300" role="status">{message ?? storageError}</p> : null}
      </div>
    </section>
  );
}
