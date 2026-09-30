export const consentCredentialStorageKey = 'goblin-survey:consent-management:v1';

interface StoredConsentCredentialBase {
  schemaVersion: 2;
  playerId: string;
  managementCredential: string;
  savedAt: string;
}

export interface StoredActiveConsentCredential extends StoredConsentCredentialBase {
  revocationAccepted: false;
}

export interface StoredDeletionSession extends StoredConsentCredentialBase {
  revocationAccepted: true;
  deletionJobId: string;
  revocationAcceptedAt: string;
}

export type StoredConsentCredential = StoredActiveConsentCredential | StoredDeletionSession;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const credential = /^[A-Za-z0-9_-]{43}$/u;

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validV2(value: unknown): value is StoredConsentCredential {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const baseValid = item.schemaVersion === 2
    && typeof item.playerId === 'string' && uuid.test(item.playerId)
    && typeof item.managementCredential === 'string' && credential.test(item.managementCredential)
    && validTimestamp(item.savedAt);
  if (!baseValid) return false;
  if (item.revocationAccepted === false) return !('deletionJobId' in item) && !('revocationAcceptedAt' in item);
  return item.revocationAccepted === true
    && typeof item.deletionJobId === 'string' && uuid.test(item.deletionJobId)
    && validTimestamp(item.revocationAcceptedAt);
}

function migrateV1(value: unknown): StoredActiveConsentCredential | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1
    || typeof item.playerId !== 'string' || !uuid.test(item.playerId)
    || typeof item.managementCredential !== 'string' || !credential.test(item.managementCredential)
    || !validTimestamp(item.savedAt)) return null;
  return {
    schemaVersion: 2,
    playerId: item.playerId,
    managementCredential: item.managementCredential,
    savedAt: item.savedAt,
    revocationAccepted: false,
  };
}

export class BrowserConsentCredentialRepository {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  load(): StoredConsentCredential | null {
    const raw = this.storage.getItem(consentCredentialStorageKey);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as unknown;
      if (validV2(value)) return value;
      const migrated = migrateV1(value);
      if (migrated) {
        this.storage.setItem(consentCredentialStorageKey, JSON.stringify(migrated));
        return migrated;
      }
      this.storage.removeItem(consentCredentialStorageKey);
      return null;
    } catch {
      this.storage.removeItem(consentCredentialStorageKey);
      return null;
    }
  }

  save(playerId: string, managementCredential: string, savedAt = new Date().toISOString()): void {
    const value: StoredActiveConsentCredential = {
      schemaVersion: 2, playerId, managementCredential, savedAt, revocationAccepted: false,
    };
    if (!validV2(value)) throw new Error('同意管理憑證格式不正確。');
    this.storage.setItem(consentCredentialStorageKey, JSON.stringify(value));
  }

  saveDeletionSession(
    playerId: string,
    managementCredential: string,
    deletionJobId: string,
    revocationAcceptedAt = new Date().toISOString(),
  ): void {
    const existing = this.load();
    const value: StoredDeletionSession = {
      schemaVersion: 2,
      playerId,
      managementCredential,
      savedAt: existing?.playerId === playerId ? existing.savedAt : revocationAcceptedAt,
      revocationAccepted: true,
      deletionJobId,
      revocationAcceptedAt,
    };
    if (!validV2(value)) throw new Error('資料刪除工作識別資料格式不正確。');
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
