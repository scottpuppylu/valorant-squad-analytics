import { PublicApiError } from './errors.js';

const activeImports = new Set<string>();

export async function withImportLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (activeImports.has(key)) {
    throw new PublicApiError(409, 'IMPORT_IN_PROGRESS', '這個玩家的戰績正在匯入，請等待目前的請求完成。');
  }
  activeImports.add(key);
  try {
    return await work();
  } finally {
    activeImports.delete(key);
  }
}
