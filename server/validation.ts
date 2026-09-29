import { PublicApiError } from './errors';
import { supportedAffinities, type ConnectionInput, type ImportLimit, type MatchImportInput, type ValorantAffinity } from './contracts';

const allowedLimits = new Set<number>([3, 10, 20, 30]);

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
  if (body.consent !== true) {
    throw new PublicApiError(400, 'CONSENT_REQUIRED', '必須先明確同意讀取公開戰績。');
  }
  return {
    gameName: cleanIdentifier(body.gameName, 'Riot ID', 32),
    tag: cleanIdentifier(body.tag, 'Tag', 10),
    affinity: parseAffinity(body.affinity),
    consent: true,
  };
}

export function parseMatchImportInput(value: unknown): MatchImportInput {
  const body = asRecord(value);
  const connection = parseConnectionInput(body);
  if (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || !allowedLimits.has(body.limit)) {
    throw new PublicApiError(400, 'BAD_REQUEST', '匯入場數只接受 10、20 或 30；受控驗證可使用 3。');
  }
  return { ...connection, limit: body.limit as ImportLimit };
}
