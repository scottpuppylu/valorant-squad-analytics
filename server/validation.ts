import { PublicApiError } from './errors.js';
import { supportedAffinities, type ConnectionInput, type ImportLimit, type MatchImportInput, type ValorantAffinity } from './contracts.js';
import type { SyncKind } from './sync/types.js';
import { isConsentManagementCredential } from './consentManagementCredential.js';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy.js';

const allowedLimits = new Set<number>([1, 3, 10, 20, 30]);

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PublicApiError(400, 'BAD_REQUEST', '請提供有效的連接資料。');
  }
  return value as Record<string, unknown>;
}

function cleanIdentifier(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new PublicApiError(400, 'BAD_REQUEST', `${label}格式不正確。`);
  }
  const cleaned = value.trim().normalize('NFC');
  if (cleaned.length < 1 || cleaned.length > maximum || hasControlCharacter(cleaned) || /[\\/#?]/u.test(cleaned)) {
    throw new PublicApiError(400, 'BAD_REQUEST', `${label}格式不正確。`);
  }
  return cleaned;
}

function parseAffinity(value: unknown): ValorantAffinity {
  const affinity = typeof value === 'string' ? value.toLowerCase() : '';
  if (!supportedAffinities.includes(affinity as ValorantAffinity)) {
    throw new PublicApiError(400, 'BAD_REQUEST', '請選擇有效的資料區域。');
  }
  return affinity as ValorantAffinity;
}

export function parseConnectionInput(value: unknown): ConnectionInput {
  const body = asRecord(value);
  if (body.consent !== true || body.privacyVersion !== PUBLIC_DATASET_PRIVACY_VERSION) {
    throw new PublicApiError(400, 'CONSENT_REQUIRED', '必須先接受目前版本的公開顯示同意，才能連接戰績。');
  }
  return {
    gameName: cleanIdentifier(body.gameName, 'Riot ID', 32),
    tag: cleanIdentifier(body.tag, 'Tag', 10),
    affinity: parseAffinity(body.affinity),
    consent: true,
    privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION,
  };
}

export function parseMatchImportInput(value: unknown): MatchImportInput {
  const body = asRecord(value);
  const connection = parseConnectionInput(body);
  if (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || !allowedLimits.has(body.limit)) {
    throw new PublicApiError(400, 'BAD_REQUEST', '匯入場數只接受 10、20 或 30；受控驗證可使用 1 或 3。');
  }
  return { ...connection, playerId: publicUuid(body.playerId, '玩家識別碼'), limit: body.limit as ImportLimit };
}

function publicUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new PublicApiError(400, 'BAD_REQUEST', `${label}格式不正確。`);
  }
  return value.toLowerCase();
}

export function parseSyncStartInput(value: unknown): { playerId: string; kind: SyncKind; intent?: 'refresh_if_stale' } {
  const body = asRecord(value);
  const kind = body.kind === 'incremental' ? 'incremental' : body.kind === 'backfill' ? 'backfill' : body.kind === 'deep_backfill' ? 'deep_backfill' : undefined;
  if (!kind) throw new PublicApiError(400, 'BAD_REQUEST', '同步類型不正確。');
  // TASK-DATA-FASTSYNC-01: the only accepted intent. Clients can never supply a cooldown/threshold.
  if (body.intent !== undefined && (body.intent !== 'refresh_if_stale' || kind !== 'incremental')) {
    throw new PublicApiError(400, 'BAD_REQUEST', '更新意圖不正確。');
  }
  // TASK-IDENTITY-01: sync is ACCOUNT-scoped. `accountId` is the explicit name; legacy `playerId`
  // (always an account public id for these routes) stays accepted. Both present must agree.
  if (body.accountId !== undefined && body.playerId !== undefined && body.accountId !== body.playerId) {
    throw new PublicApiError(400, 'BAD_REQUEST', '帳號識別碼不一致。');
  }
  const accountId = publicUuid(body.accountId ?? body.playerId, '帳號識別碼');
  return { playerId: accountId, kind, ...(body.intent === 'refresh_if_stale' ? { intent: 'refresh_if_stale' as const } : {}) };
}

export function parseSyncContinueInput(value: unknown): { runId: string } {
  const body = asRecord(value);
  return { runId: publicUuid(body.runId, '同步識別碼') };
}

export function parseSyncStatusQuery(value: string | string[] | undefined): string {
  return publicUuid(Array.isArray(value) ? value[0] : value, '同步識別碼');
}

function managementCredential(value: unknown): string {
  if (!isConsentManagementCredential(value)) {
    throw new PublicApiError(400, 'BAD_REQUEST', '同意管理憑證格式不正確。');
  }
  return value;
}

export function parseRevocationInput(value: unknown): { playerId: string; managementCredential: string } {
  const body = asRecord(value);
  return {
    playerId: publicUuid(body.playerId, '玩家識別碼'),
    managementCredential: managementCredential(body.managementCredential),
  };
}

export function parseDeletionInput(value: unknown): { jobId: string; managementCredential: string } {
  const body = asRecord(value);
  return {
    jobId: publicUuid(body.jobId, '刪除工作識別碼'),
    managementCredential: managementCredential(body.managementCredential),
  };
}
