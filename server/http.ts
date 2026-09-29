import type { ApiRequest, ApiResponse } from './contracts';
import { PublicApiError, toPublicApiError } from './errors';

export function requireMethod(request: ApiRequest, method: 'GET' | 'POST'): void {
  if (request.method !== method) {
    throw new PublicApiError(405, 'METHOD_NOT_ALLOWED', '不支援這個請求方式。');
  }
}

export function readJsonBody(request: ApiRequest): unknown {
  const contentType = request.headers['content-type'];
  const normalized = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!normalized?.toLowerCase().includes('application/json')) {
    throw new PublicApiError(415, 'BAD_REQUEST', '請使用 JSON 格式送出資料。');
  }
  if (typeof request.body === 'string') {
    try {
      return JSON.parse(request.body) as unknown;
    } catch {
      throw new PublicApiError(400, 'BAD_REQUEST', 'JSON 格式不正確。');
    }
  }
  return request.body;
}

export function clientKey(request: ApiRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || request.socket?.remoteAddress || 'unknown';
}

export function sendError(response: ApiResponse, error: unknown): void {
  const safe = toPublicApiError(error);
  response.status(safe.status).json({
    ok: false,
    error: { code: safe.code, message: safe.publicMessage },
  });
}

export function secureJson(response: ApiResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}
