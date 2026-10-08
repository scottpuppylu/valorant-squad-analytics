import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ApiRequest, ApiResponse } from '../contracts.js';
import accountResolve from '../../api/valorant/account/resolve.js';
import consentRevoke from '../../api/valorant/consent/revoke.js';
import cronJob from '../../api/valorant/cron/[job].js';
import dataset from '../../api/valorant/dataset.js';
import deletionContinue from '../../api/valorant/deletion/continue.js';
import deletionStatus from '../../api/valorant/deletion/status.js';
import matchesImport from '../../api/valorant/matches/import.js';
import providerAudit from '../../api/valorant/provider/audit.js';
import providerStatus from '../../api/valorant/provider/status.js';
import syncContinue from '../../api/valorant/sync/continue.js';
import syncStart from '../../api/valorant/sync/start.js';
import syncStatus from '../../api/valorant/sync/status.js';

/**
 * TASK-INFRA-DATABASE-PORTABILITY-01 standalone Node runtime. The SAME 12 API handlers (business logic and
 * contracts unchanged) behind a small `node:http` adapter instead of a serverless host. Caddy terminates TLS and
 * proxies `/api/*` here; static frontend files are served by Caddy.
 */
type Handler = (request: ApiRequest, response: ApiResponse) => unknown;

export const routes: Record<string, Handler> = {
  '/api/valorant/account/resolve': accountResolve,
  '/api/valorant/consent/revoke': consentRevoke,
  '/api/valorant/dataset': dataset,
  '/api/valorant/deletion/continue': deletionContinue,
  '/api/valorant/deletion/status': deletionStatus,
  '/api/valorant/matches/import': matchesImport,
  '/api/valorant/provider/audit': providerAudit,
  '/api/valorant/provider/status': providerStatus,
  '/api/valorant/sync/continue': syncContinue,
  '/api/valorant/sync/start': syncStart,
  '/api/valorant/sync/status': syncStatus,
};
/** Dynamic segment routes (Vercel `[job].ts` convention): the segment becomes a query parameter. */
const dynamicRoutes: { prefix: string; param: string; handler: Handler }[] = [
  { prefix: '/api/valorant/cron/', param: 'job', handler: cronJob },
];

/** Request bodies are small JSON documents; anything larger is rejected before parsing. */
export const MAX_BODY_BYTES = 64 * 1024;

export interface HealthReport { ok: boolean; database: 'ok' | 'unavailable' | 'error'; schemaVersion?: string; dbLatencyMs?: number; pool?: Record<string, number> }
export type HealthCheck = () => Promise<HealthReport>;

function queryOf(url: URL): Record<string, string | string[] | undefined> {
  const query: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of url.searchParams) {
    const existing = query[key];
    query[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return query;
}

class BodyTooLarge extends Error {}
async function readBody(request: IncomingMessage): Promise<string | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
}

/** Vercel-compatible body: JSON bodies are parsed; an unparsable JSON body stays a string (handlers reject it). */
function parsedBody(raw: string | undefined, contentType: string | undefined): unknown {
  if (raw === undefined) return undefined;
  if (contentType?.toLowerCase().includes('application/json')) {
    try { return JSON.parse(raw) as unknown; } catch { return raw; }
  }
  return raw;
}

function adapt(response: ServerResponse): ApiResponse & { sent: boolean } {
  const adapter = {
    sent: false,
    status(code: number) { response.statusCode = code; return adapter; },
    setHeader(name: string, value: string) { response.setHeader(name, value); },
    json(body: unknown) {
      if (adapter.sent) return;
      adapter.sent = true;
      if (!response.hasHeader('content-type')) response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(body));
    },
  };
  return adapter;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(body));
}

export function createApiServer(options: { health: HealthCheck }): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://internal');
      if (url.pathname === '/healthz') {
        const report = await options.health();
        sendJson(response, report.ok ? 200 : 503, report);
        return;
      }
      let handler = routes[url.pathname];
      const query = queryOf(url);
      if (!handler) {
        const dynamic = dynamicRoutes.find((route) => url.pathname.startsWith(route.prefix) && /^[a-z]+$/u.test(url.pathname.slice(route.prefix.length)));
        if (dynamic) { handler = dynamic.handler; query[dynamic.param] = url.pathname.slice(dynamic.prefix.length); }
      }
      if (!handler) { sendJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: '找不到此 API。' } }); return; }
      const headers = request.headers as Record<string, string | string[] | undefined>;
      const contentType = Array.isArray(headers['content-type']) ? headers['content-type'][0] : headers['content-type'];
      const apiRequest: ApiRequest = {
        method: request.method, headers, query, socket: { remoteAddress: request.socket.remoteAddress },
        body: parsedBody(await readBody(request), contentType),
      };
      // Same edge headers as vercel.json for /api/*.
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('referrer-policy', 'no-referrer');
      const apiResponse = adapt(response);
      await handler(apiRequest, apiResponse);
      if (!apiResponse.sent) sendJson(response, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: '伺服器暫時無法處理請求。' } });
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      if (error instanceof BodyTooLarge) { sendJson(response, 413, { ok: false, error: { code: 'BAD_REQUEST', message: '請求內容過大。' } }); return; }
      sendJson(response, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: '伺服器暫時無法處理請求。' } });
    }
  });
}
