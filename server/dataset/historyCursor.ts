import { timingSafeEqual } from 'node:crypto';
import { PublicApiError } from '../errors.js';
import { lookupHmac } from '../identityProtection.js';
import type { DatasetHistoryKey, DatasetHistoryPageRequest } from './types.js';
import { datasetHistoryDefaultPageSize, datasetHistoryMaxPageSize } from './types.js';

/**
 * DATA-03B.1 history cursor: `<base64url payload>.<base64url 128-bit HMAC>`.
 * The payload holds only a keyset POSITION (exact start microseconds + public match id),
 * both already browser-visible. It never carries authorization, player scope, internal
 * UUIDs, provider IDs or lookup HMACs; every page re-evaluates current visibility.
 */
const cursorDomain = 'dataset-history-cursor:v1';
export const maxCursorLength = 200;
const cursorPattern = /^[A-Za-z0-9_-]{1,160}\.[A-Za-z0-9_-]{22}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const microsPattern = /^-?\d{1,19}$/u;
const int64Min = -(2n ** 63n);
const int64Max = 2n ** 63n - 1n;

function invalidPosition(): PublicApiError {
  return new PublicApiError(400, 'BAD_REQUEST', '歷史分頁位置無效，請重新載入對戰紀錄。');
}

function signature(payload: string, key?: string): string {
  return Buffer.from(lookupHmac(cursorDomain, payload, key), 'hex').subarray(0, 16).toString('base64url');
}

function validKey(value: unknown): value is { v: 1; t: string; p: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(',') !== 'p,t,v' || candidate.v !== 1) return false;
  if (typeof candidate.t !== 'string' || !microsPattern.test(candidate.t)) return false;
  const micros = BigInt(candidate.t);
  return micros >= int64Min && micros <= int64Max && typeof candidate.p === 'string' && uuidPattern.test(candidate.p);
}

export function encodeHistoryCursor(key: DatasetHistoryKey, hmacKey?: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, t: key.startedAtMicros, p: key.publicMatchId }), 'utf8').toString('base64url');
  return `${payload}.${signature(payload, hmacKey)}`;
}

/** Fails closed with one generic error; never echoes which check failed. */
export function decodeHistoryCursor(cursor: string, hmacKey?: string): DatasetHistoryKey {
  if (cursor.length > maxCursorLength || !cursorPattern.test(cursor)) throw invalidPosition();
  const [payload, supplied] = cursor.split('.') as [string, string];
  const expected = Buffer.from(signature(payload, hmacKey), 'utf8');
  const actual = Buffer.from(supplied, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalidPosition();
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw invalidPosition();
  }
  if (!validKey(decoded)) throw invalidPosition();
  return { startedAtMicros: BigInt(decoded.t).toString(), publicMatchId: decoded.p };
}

export type DatasetView = 'snapshot' | 'history' | 'analytics';

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) throw new PublicApiError(400, 'BAD_REQUEST', '查詢參數格式不正確。');
  return value;
}

/** Absent `view` keeps the unchanged schema 4 snapshot contract and ignores other parameters. */
export function parseDatasetView(query: Record<string, string | string[] | undefined> | undefined): DatasetView {
  const view = single(query?.view);
  if (view === undefined) return 'snapshot';
  if (view === 'history') return 'history';
  if (view === 'analytics') return 'analytics';
  throw new PublicApiError(400, 'BAD_REQUEST', '不支援的資料檢視。');
}

export function parseHistoryRequest(
  query: Record<string, string | string[] | undefined> | undefined,
  hmacKey?: string,
): DatasetHistoryPageRequest {
  const limit = single(query?.limit);
  const cursor = single(query?.cursor);
  const before = single(query?.before);
  let pageSize = datasetHistoryDefaultPageSize;
  if (limit !== undefined) {
    if (!/^\d{1,3}$/u.test(limit)) throw new PublicApiError(400, 'BAD_REQUEST', '每頁數量格式不正確。');
    pageSize = Number(limit);
    if (pageSize < 1 || pageSize > datasetHistoryMaxPageSize) {
      throw new PublicApiError(400, 'BAD_REQUEST', `每頁數量必須介於 1 到 ${datasetHistoryMaxPageSize}。`);
    }
  }
  if (cursor !== undefined && before !== undefined) throw invalidPosition();
  if (cursor !== undefined) return { pageSize, start: { kind: 'cursor', key: decodeHistoryCursor(cursor, hmacKey) } };
  if (before !== undefined) {
    if (!uuidPattern.test(before)) throw invalidPosition();
    return { pageSize, start: { kind: 'before', publicMatchId: before } };
  }
  return { pageSize, start: { kind: 'newest' } };
}
