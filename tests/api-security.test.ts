import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import resolveHandler from '../api/valorant/account/resolve';
import type { ApiRequest, ApiResponse, MatchImportInput } from '../server/contracts';
import { PublicApiError } from '../server/errors';
import { HenrikDataProvider } from '../server/henrikDataProvider';
import { withImportLock } from '../server/importLock';
import { normalizeHenrikMatches } from '../server/normalizeHenrik';
import { enforceRateLimit, resetRateLimitsForTests } from '../server/rateLimit';
import { parseConnectionInput, parseMatchImportInput } from '../server/validation';
import { parseSyncContinueInput, parseSyncStartInput, parseSyncStatusQuery } from '../server/validation';
import { parseDeletionInput, parseRevocationInput } from '../server/validation';
import {
  consentManagementCredentialHmac,
  createConsentManagementCredential,
  verifyConsentManagementCredential,
} from '../server/consentManagementCredential';
import { ValorantBackendClient } from '../src/dataSources/server/ValorantBackendClient';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';

const connection = {
  gameName: 'GoblinScout', tag: 'TW', affinity: 'ap', consent: true,
  privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION,
} as const;
const publicPlayerId = '11111111-1111-4111-8111-111111111111';
const importInput: MatchImportInput = { ...connection, playerId: publicPlayerId, limit: 3 };

afterEach(() => vi.unstubAllGlobals());

const deployedServerModules = [
  'api/valorant/account/resolve.ts',
  'api/valorant/matches/import.ts',
  'api/valorant/provider/status.ts',
  'api/valorant/provider/audit.ts',
  'api/valorant/sync/start.ts',
  'api/valorant/sync/continue.ts',
  'api/valorant/sync/status.ts',
  'api/valorant/consent/revoke.ts',
  'api/valorant/deletion/continue.ts',
  'api/valorant/deletion/status.ts',
  'server/contracts.ts',
  'server/henrikDataProvider.ts',
  'server/http.ts',
  'server/importLock.ts',
  'server/normalizeHenrik.ts',
  'server/rateLimit.ts',
  'server/sync/historicalSyncService.ts',
  'server/sync/postgresSyncStore.ts',
  'server/sync/runtime.ts',
  'server/sync/types.ts',
  'server/consentManagementCredential.ts',
  'server/deletion/revocationDeletionService.ts',
  'server/deletion/retentionService.ts',
  'server/deletion/runtime.ts',
  'server/deletion/types.ts',
  'server/validation.ts',
];

const vercelConfiguration = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  functions?: Record<string, { maxDuration?: number }>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function providerMatch() {
  return {
    status: 200,
    data: [{
      metadata: {
        match_id: 'fictional-provider-match', started_at: '2026-09-29T12:00:00.000Z', game_length_in_ms: 2_100_000,
        map: { id: 'map-id', name: 'Ascent' }, queue: { id: 'competitive', name: 'Competitive' },
      },
      players: [{
        puuid: 'fictional-player-id', name: connection.gameName, tag: connection.tag, team_id: 'Blue', agent: { id: 'agent-id', name: 'Jett' },
        stats: { score: 500, kills: 2, deaths: 1, assists: 1, headshots: 2, bodyshots: 5, legshots: 0, damage: { dealt: 320, received: 210 } },
      }],
      teams: [{ team_id: 'Blue', won: true, rounds: { won: 2, lost: 0 } }],
      rounds: [{ id: 1 }, { id: 2 }],
      kills: [
        { round: 1, time_in_round_in_ms: 20_000, killer: { puuid: 'fictional-player-id', team: 'Blue' }, victim: { puuid: 'opponent-a', team: 'Red' }, assistants: [] },
        { round: 2, time_in_round_in_ms: 25_000, killer: { puuid: 'opponent-b', team: 'Red' }, victim: { puuid: 'fictional-player-id', team: 'Blue' }, assistants: [] },
        { round: 2, time_in_round_in_ms: 28_000, killer: { puuid: 'teammate-a', team: 'Blue' }, victim: { puuid: 'opponent-b', team: 'Red' }, assistants: [] },
      ],
    }],
  };
}

describe('production connection validation', () => {
  it('allows bounded provider imports enough time to finish one database transaction', () => {
    expect(vercelConfiguration.functions?.['api/**/*.ts']?.maxDuration).toBeGreaterThanOrEqual(60);
  });

  it('uses Node ESM-compatible extensions throughout the deployed function graph', () => {
    for (const modulePath of deployedServerModules) {
      const source = readFileSync(modulePath, 'utf8');
      const relativeSpecifiers = [...source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) => match[1]);
      for (const specifier of relativeSpecifiers) expect(specifier, modulePath).toMatch(/\.js$/);
    }
  });

  it('requires explicit consent and rejects invalid input', () => {
    expect(() => parseConnectionInput({ ...connection, consent: false })).toThrowError(expect.objectContaining({ code: 'CONSENT_REQUIRED' }));
    expect(() => parseConnectionInput({ ...connection, gameName: '../bad' })).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(() => parseMatchImportInput({ ...connection, limit: 999 })).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(() => parseConnectionInput({ ...connection, privacyVersion: 'old-policy' })).toThrowError(expect.objectContaining({ code: 'CONSENT_REQUIRED' }));
    expect(() => parseConnectionInput({ ...connection, privacyVersion: undefined })).toThrowError(expect.objectContaining({ code: 'CONSENT_REQUIRED' }));
  });

  it('accepts the single-match production validation limit', () => {
    expect(parseMatchImportInput({ ...connection, playerId: publicPlayerId, limit: 1 }).limit).toBe(1);
  });

  it('accepts only opaque public application UUIDs at the sync boundary', () => {
    const playerId = '11111111-1111-4111-8111-111111111111';
    const runId = '22222222-2222-4222-8222-222222222222';
    expect(parseSyncStartInput({ playerId, kind: 'backfill' })).toEqual({ playerId, kind: 'backfill' });
    expect(parseSyncContinueInput({ runId })).toEqual({ runId });
    expect(parseSyncStatusQuery(runId)).toBe(runId);
    expect(() => parseSyncStartInput({ gameName: 'not-accepted', tag: 'TW', kind: 'backfill' })).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(() => parseSyncContinueInput({ runId: 'provider-match-id' })).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });

  it('requires a fixed high-entropy credential at every destructive boundary', () => {
    const managementCredential = createConsentManagementCredential();
    const jobId = '22222222-2222-4222-8222-222222222222';
    expect(parseRevocationInput({ playerId: publicPlayerId, managementCredential })).toEqual({ playerId: publicPlayerId, managementCredential });
    expect(parseDeletionInput({ jobId, managementCredential })).toEqual({ jobId, managementCredential });
    expect(() => parseRevocationInput({ playerId: publicPlayerId })).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(() => parseDeletionInput({ jobId, managementCredential: 'short' })).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    const stored = consentManagementCredentialHmac(managementCredential, 'test-credential-hmac-key-at-least-thirty-two-bytes');
    expect(verifyConsentManagementCredential(managementCredential, stored, 'test-credential-hmac-key-at-least-thirty-two-bytes')).toBe(true);
    expect(verifyConsentManagementCredential('A'.repeat(43), stored, 'test-credential-hmac-key-at-least-thirty-two-bytes')).toBe(false);
    expect(stored).not.toContain(managementCredential);
  });

  it('distinguishes a platform timeout from an unavailable provider', async () => {
    vi.stubGlobal('fetch', async () => new Response('Gateway Timeout', { status: 504 }));
    await expect(new ValorantBackendClient().importMatches(connection, publicPlayerId, 1)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      message: '戰績儲存逾時，資料未寫入，請稍後重試。',
    });
  });

  it('rejects missing consent at the HTTP boundary before provider access', async () => {
    let status = 0;
    let payload: unknown;
    const response: ApiResponse = {
      status(code) { status = code; return this; },
      json(body) { payload = body; },
      setHeader() {},
    };
    const request: ApiRequest = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.10' },
      body: { ...connection, consent: false },
    };
    await resolveHandler(request, response);
    expect(status).toBe(400);
    expect(payload).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'CONSENT_REQUIRED' }) }));
  });

  it('rejects a stale privacy version before provider access', async () => {
    const previousKey = process.env.HENRIK_API_KEY;
    process.env.HENRIK_API_KEY = 'configured-test-key';
    let providerCalls = 0;
    vi.stubGlobal('fetch', async () => {
      providerCalls += 1;
      return jsonResponse({ status: 200, data: { name: 'must-not-run', tag: 'XX' } });
    });
    let status = 0;
    let payload: unknown;
    const response: ApiResponse = {
      status(code) { status = code; return this; },
      json(body) { payload = body; },
      setHeader() {},
    };
    try {
      await resolveHandler({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.11' },
        body: { ...connection, privacyVersion: '2026-09-30-v1' },
      }, response);
    } finally {
      if (previousKey === undefined) delete process.env.HENRIK_API_KEY;
      else process.env.HENRIK_API_KEY = previousKey;
    }
    expect(status).toBe(400);
    expect(payload).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'CONSENT_REQUIRED' }) }));
    expect(providerCalls).toBe(0);
  });

  it('applies a bounded server-side request rate', () => {
    resetRateLimitsForTests();
    for (let index = 0; index < 10; index += 1) enforceRateLimit('test-client', 1_000);
    expect(() => enforceRateLimit('test-client', 1_000)).toThrowError(expect.objectContaining({ code: 'RATE_LIMITED' }));
    expect(() => enforceRateLimit('test-client', 61_001)).not.toThrow();
    resetRateLimitsForTests();
  });
});

describe('Henrik provider security and failure policy', () => {
  it('reports only configured or unconfigured provider state', () => {
    expect(new HenrikDataProvider(undefined).status()).toEqual({ usable: false, mode: 'unconfigured' });
    expect(new HenrikDataProvider('configured').status()).toEqual({ usable: true, mode: 'configured' });
  });
  it('returns only a sanitized account and never echoes the server credential or internal player id', async () => {
    const serverCredential = ['server', 'credential', 'sentinel'].join('-');
    const provider = new HenrikDataProvider(serverCredential, {
      fetchImpl: async () => jsonResponse({ status: 200, data: { name: 'GoblinScout', tag: 'TW', puuid: 'internal-player-id', account_level: 42 } }),
    });
    const result = await provider.resolveAccount(connection);
    const serialized = JSON.stringify(result);
    expect(result.account).toEqual({ gameName: 'GoblinScout', tag: 'TW', affinity: 'ap', accountLevel: 42 });
    expect(serialized).not.toContain(serverCredential);
    expect(serialized).not.toContain('internal-player-id');
    expect(serialized.toLowerCase()).not.toContain('puuid');
  });

  it('sanitizes provider failures, malformed payloads, 429 and timeout', async () => {
    const rateLimited = new HenrikDataProvider('configured', { retries: 0, fetchImpl: async () => jsonResponse({ private: 'raw' }, 429) });
    await expect(rateLimited.resolveAccount(connection)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });

    const malformed = new HenrikDataProvider('configured', { retries: 0, fetchImpl: async () => jsonResponse({ status: 200, data: { puuid: 'must-not-leak' } }) });
    await expect(malformed.resolveAccount(connection)).rejects.toMatchObject({ code: 'MALFORMED_PROVIDER_RESPONSE' });

    const timeout = new HenrikDataProvider('configured', {
      retries: 0,
      timeoutMs: 2,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    });
    await expect(timeout.resolveAccount(connection)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', status: 504 });
  });

  it('retries one transient server failure and then succeeds', async () => {
    let calls = 0;
    const provider = new HenrikDataProvider('configured', {
      delay: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? jsonResponse({}, 503) : jsonResponse({ status: 200, data: { name: 'GoblinScout', tag: 'TW' } });
      },
    });
    await expect(provider.resolveAccount(connection)).resolves.toMatchObject({ account: { gameName: 'GoblinScout' } });
    expect(calls).toBe(2);
  });
});

describe('normalization and duplicate protection', () => {
  it('normalizes provider matches without PUUIDs or raw match identifiers', () => {
    const dataset = normalizeHenrikMatches(providerMatch(), importInput);
    const serialized = JSON.stringify(dataset);
    expect(dataset.mode).toBe('REAL');
    expect(dataset.matches).toHaveLength(1);
    expect(dataset.matches[0]?.performances[0]).toMatchObject({ acs: 250, adr: 160, kast: 1, firstKills: 1, firstDeaths: 1 });
    expect(dataset.matches[0]?.id).toMatch(/^real-[a-f0-9]{20}$/);
    expect(serialized).not.toContain('fictional-provider-match');
    expect(serialized).not.toContain('fictional-player-id');
    expect(serialized.toLowerCase()).not.toContain('puuid');
  });

  it('rejects malformed match envelopes', () => {
    expect(() => normalizeHenrikMatches({ status: 200, data: [{}] }, importInput)).toThrowError(expect.objectContaining({ code: 'MALFORMED_PROVIDER_RESPONSE' }));
  });

  it('rejects a duplicate concurrent import and releases the lock afterward', async () => {
    let release: (() => void) | undefined;
    const first = withImportLock('same-player', () => new Promise<void>((resolve) => { release = resolve; }));
    await expect(withImportLock('same-player', async () => undefined)).rejects.toMatchObject({ code: 'IMPORT_IN_PROGRESS' });
    release?.();
    await first;
    await expect(withImportLock('same-player', async () => 'done')).resolves.toBe('done');
  });

  it('uses public errors without raw provider details', () => {
    const error = new PublicApiError(502, 'PROVIDER_ERROR', '安全訊息');
    expect(JSON.stringify({ code: error.code, message: error.publicMessage })).toBe('{"code":"PROVIDER_ERROR","message":"安全訊息"}');
  });
});
