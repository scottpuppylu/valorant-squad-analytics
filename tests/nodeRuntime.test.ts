import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer, MAX_BODY_BYTES, routes, type HealthCheck } from '../server/node/httpServer';
import { fire, nextRun, SCHEDULE } from '../server/node/scheduler';

/** TASK-INFRA-DATABASE-PORTABILITY-01 standalone Node runtime: same handlers, same contracts, different host. */
function apiRoutes(dir = 'api'): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? apiRoutes(path) : name.endsWith('.ts') ? [`/${path.replace(/\\/gu, '/').replace(/\.ts$/u, '')}`] : [];
  });
}

const servers: { close(): void }[] = [];
afterEach(() => { while (servers.length) servers.pop()!.close(); });
async function start(health: HealthCheck = async () => ({ ok: true, database: 'ok', schemaVersion: '0011' })) {
  const server = createApiServer({ health });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('standalone Node API runtime', () => {
  it('serves every Vercel API route file (12 handlers, including the dynamic cron segment)', () => {
    const files = apiRoutes();
    expect(files).toHaveLength(12);
    const registered = new Set([...Object.keys(routes), '/api/valorant/cron/[job]']);
    expect(files.filter((route) => !registered.has(route))).toEqual([]);
  });

  it('preserves request semantics: JSON bodies, repeated query parameters, headers, dynamic segment', async () => {
    const base = await start();
    const previous = process.env.REAL_DATASET_READ_MODE;
    delete process.env.REAL_DATASET_READ_MODE;
    try {
      const disabled = await fetch(`${base}/api/valorant/dataset`);
      expect(disabled.status).toBe(200);
      expect(await disabled.json()).toMatchObject({ ok: true, state: 'disabled' });
      expect(disabled.headers.get('cache-control')).toBe('no-store');
      expect(disabled.headers.get('x-content-type-options')).toBe('nosniff');
      const repeated = await fetch(`${base}/api/valorant/dataset?view=history&view=analysis`);
      expect(repeated.status).toBe(400); // array query → handler's own validation, exactly like the serverless host
    } finally { if (previous !== undefined) process.env.REAL_DATASET_READ_MODE = previous; }
    const cron = await fetch(`${base}/api/valorant/cron/recent`);
    expect([401, 503]).toContain(cron.status);
    expect((await fetch(`${base}/api/valorant/cron/unknown`)).status).toBe(404);
    const badJson = await fetch(`${base}/api/valorant/sync/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"broken":' });
    expect(badJson.status).toBe(400);
    const wrongMethod = await fetch(`${base}/api/valorant/sync/start`);
    expect(wrongMethod.status).toBe(405);
    expect((await fetch(`${base}/api/unknown`)).status).toBe(404);
  });

  it('rejects oversized bodies before parsing and never echoes internals', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/valorant/sync/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(MAX_BODY_BYTES + 1) });
    expect(response.status).toBe(413);
    expect(JSON.stringify(await response.json())).not.toMatch(/stack|Error:|postgres/iu);
  });

  it('health is cheap and reflects database reachability', async () => {
    const ok = await start();
    expect(await (await fetch(`${ok}/healthz`)).json()).toMatchObject({ ok: true, database: 'ok', schemaVersion: '0011' });
    const down = await start(async () => ({ ok: false, database: 'error' }));
    expect((await fetch(`${down}/healthz`)).status).toBe(503);
  });
});

describe('VPS scheduler (replaces Vercel Cron)', () => {
  it('fires exactly the two existing daily jobs at the vercel.json UTC times', () => {
    expect(SCHEDULE).toEqual([{ job: 'recent', hourUtc: 18, minuteUtc: 5 }, { job: 'history', hourUtc: 18, minuteUtc: 35 }]);
    expect(nextRun(SCHEDULE[0]!, new Date('2026-10-07T18:04:59Z')).toISOString()).toBe('2026-10-07T18:05:00.000Z');
    expect(nextRun(SCHEDULE[0]!, new Date('2026-10-07T18:05:00Z')).toISOString()).toBe('2026-10-08T18:05:00.000Z');
    expect(nextRun(SCHEDULE[1]!, new Date('2026-12-31T19:00:00Z')).toISOString()).toBe('2027-01-01T18:35:00.000Z');
  });

  it('calls only the authenticated internal cron endpoint', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fake = (async (url: string, init?: RequestInit) => { seen.push({ url, auth: new Headers(init?.headers).get('authorization') }); return new Response('{}', { status: 200 }); }) as typeof fetch;
    expect(await fire(SCHEDULE[1]!, 'http://app:3000', 'test-secret', fake)).toEqual({ job: 'history', status: 200 });
    expect(seen).toEqual([{ url: 'http://app:3000/api/valorant/cron/history', auth: 'Bearer test-secret' }]);
  });
});
