export const consentCredentialStorageKey = 'goblin-survey:consent-management:v1';

export interface StoredConsentCredential {
  schemaVersion: 1;
  playerId: string;
  managementCredential: string;
  savedAt: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const credential = /^[A-Za-z0-9_-]{43}$/u;

function valid(value: unknown): value is StoredConsentCredential {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.schemaVersion === 1
    && typeof item.playerId === 'string' && uuid.test(item.playerId)
    && typeof item.managementCredential === 'string' && credential.test(item.managementCredential)
    && typeof item.savedAt === 'string' && Number.isFinite(Date.parse(item.savedAt));
}

export class BrowserConsentCredentialRepository {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  load(): StoredConsentCredential | null {
    const raw = this.storage.getItem(consentCredentialStorageKey);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as unknown;
      if (!valid(value)) {
        this.storage.removeItem(consentCredentialStorageKey);
        return null;
      }
      return value;
    } catch {
      this.storage.removeItem(consentCredentialStorageKey);
      return null;
    }
  }

  save(playerId: string, managementCredential: string, savedAt = new Date().toISOString()): void {
    const value = { schemaVersion: 1, playerId, managementCredential, savedAt } as const;
    if (!valid(value)) throw new Error('同意管理憑證格式不正確。');
    this.storage.setItem(consentCredentialStorageKey, JSON.stringify(value));
  }

  remove(): void {
    this.storage.removeItem(consentCredentialStorageKey);
  }
}

function repository(): BrowserConsentCredentialRepository | null {
  if (typeof window === 'undefined') return null;
  try { return new BrowserConsentCredentialRepository(window.localStorage); } catch { return null; }
}

export function loadBrowserConsentCredential(): StoredConsentCredential | null {
  try { return repository()?.load() ?? null; } catch { return null; }
}

export function saveBrowserConsentCredential(playerId: string, managementCredential: string): void {
  const target = repository();
  if (!target) throw new Error('目前瀏覽器無法保存同意管理憑證。');
  target.save(playerId, managementCredential);
}

export function removeBrowserConsentCredential(): void {
  try { repository()?.remove(); } catch { /* Hardened storage can be unavailable. */ }
}
