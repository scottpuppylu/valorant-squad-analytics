import { useContext } from 'react';
import { AvatarContext } from '../contexts/AvatarContext';

export function useAvatars() {
  const value = useContext(AvatarContext);
  if (!value) throw new Error('useAvatars 必須在 AvatarProvider 內使用。');
  return value;
}
