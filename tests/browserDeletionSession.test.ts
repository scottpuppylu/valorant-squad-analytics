import { describe, expect, it } from 'vitest';
import { BrowserConsentCredentialRepository, consentCredentialStorageKey } from '../src/dataSources/real/BrowserConsentCredentialRepository';
import { BrowserDeletionSessionService, type DeletionSessionApi } from '../src/dataSources/real/BrowserDeletionSessionService';
import { BrowserRealDatasetRepository, realDatasetStorageKey } from '../src/dataSources/real/BrowserRealDatasetRepository';
import type { DeletionStatus, PublicDeletionProgress } from '../src/dataSources/server/contracts';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

function dataset(): NormalizedAnalyticsDataset {
  return {
    mode: 'REAL', isDemo: false, sourceId: 'recovery-test',
    players: [{ id: 'player', handle: 'Recovery#TW', displayName: 'Recovery', role: 'Controller', agents: ['Omen'], accent: '#6ee7b7', tagline: 'test', playstyle: 'test', defaultEmoji: '🤖' }],
    matches: [{ id: 'real-recovery-match-0001', playedAt: '2026-09-30T00:00:00.000Z', map: 'Ascent', gameMode: 'Competitive', opponent: '對手隊伍', scoreFor: 13, scoreAgainst: 9, won: true, durationMinutes: 36, performances: [{ playerId: 'player', agent: 'Omen', kills: 16, deaths: 13, assists: 11, acs: 205, adr: 138, kast: 0.78 }] }],
  };
}

function deletion(status: DeletionStatus, attempts: number): PublicDeletionProgress {
  return {
    jobId: '22222222-2222-4222-8222-222222222222', status,
    stage: status === 'complete' ? 'finalize_job' : 'process_matches',
    requestedAt: '2026-09-30T01:00:00.000Z',
    completedAt: status === 'complete' ? '2026-09-30T01:10:00.000Z' : undefined,
    progress: {
      rankRowsRemoved: 0, exclusiveMatchesRemoved: 0, sharedMatchesAnonymized: 0,
      participantsAnonymized: 0, providerIdentitiesRemoved: 0, membershipsRemoved: 0,
      syncCursorsRemoved: 0, syncRunsAnonymized: 0, attempts,
    },
  };
}

describe('browser revoked-deletion recovery lifecycle', () => {
  const playerId = '11111111-1111-4111-8111-111111111111';
  const managementCredential = 'A'.repeat(43);

  it('clears REAL immediately, survives reload and paused continuation, then destroys the credential on complete', async () => {
    const storage = memoryStorage();
    const credentials = new BrowserConsentCredentialRepository(storage);
    const realDataset = new BrowserRealDatasetRepository(storage);
    credentials.save(playerId, managementCredential, '2026-09-30T00:00:00.000Z');
    realDataset.save(dataset(), '2026-09-30T00:30:00.000Z');

    const replies = [deletion('paused', 1), deletion('paused', 2), deletion('complete', 3)];
    const calls: string[] = [];
    const api: DeletionSessionApi = {
      async deletionStatus(jobId, credential) {
        calls.push(`status:${jobId}:${credential.length}`);
        return { ok: true, deletion: replies.shift()! };
      },
      async continueDeletion(jobId, credential) {
        calls.push(`continue:${jobId}:${credential.length}`);
        return { ok: true, deletion: replies.shift()! };
      },
    };
    const initial = new BrowserDeletionSessionService(credentials, realDataset, api);
    const accepted = initial.acceptRevocation(playerId, managementCredential, deletion('paused', 1), '2026-09-30T01:00:00.000Z');
    expect(storage.values.has(realDatasetStorageKey)).toBe(false);
    expect(accepted.session).toMatchObject({
      playerId, managementCredential, deletionJobId: deletion('paused', 1).jobId, revocationAccepted: true,
    });

    const afterReload = new BrowserDeletionSessionService(
      new BrowserConsentCredentialRepository(storage), new BrowserRealDatasetRepository(storage), api,
    );
    const status = await afterReload.checkStatus();
    expect(status?.deletion.status).toBe('paused');
    expect(status?.session?.managementCredential).toBe(managementCredential);

    const pausedAgain = await afterReload.continueDeletion();
    expect(pausedAgain?.deletion.status).toBe('paused');
    expect(storage.values.has(consentCredentialStorageKey)).toBe(true);

    const completed = await afterReload.continueDeletion();
    expect(completed?.deletion.status).toBe('complete');
    expect(completed?.session).toBeNull();
    expect(storage.values.has(consentCredentialStorageKey)).toBe(false);
    expect(calls).toEqual([
      `status:${deletion('paused', 1).jobId}:43`,
      `continue:${deletion('paused', 1).jobId}:43`,
      `continue:${deletion('paused', 1).jobId}:43`,
    ]);
  });

  it('fails safely for malformed storage without sending deletion credentials', async () => {
    const storage = memoryStorage();
    storage.setItem(consentCredentialStorageKey, JSON.stringify({
      schemaVersion: 2, playerId, managementCredential, savedAt: '2026-09-30T00:00:00.000Z',
      revocationAccepted: true, deletionJobId: 'invalid', revocationAcceptedAt: '2026-09-30T01:00:00.000Z',
    }));
    let calls = 0;
    const service = new BrowserDeletionSessionService(
      new BrowserConsentCredentialRepository(storage), new BrowserRealDatasetRepository(storage), {
        async deletionStatus() { calls += 1; return { ok: true, deletion: deletion('paused', 1) }; },
        async continueDeletion() { calls += 1; return { ok: true, deletion: deletion('paused', 1) }; },
      },
    );
    expect(await service.checkStatus()).toBeNull();
    expect(calls).toBe(0);
    expect(storage.values.has(consentCredentialStorageKey)).toBe(false);
  });

  it('clears a stale deletion credential when status reports completion', async () => {
    const storage = memoryStorage();
    const credentials = new BrowserConsentCredentialRepository(storage);
    const realDataset = new BrowserRealDatasetRepository(storage);
    credentials.saveDeletionSession(playerId, managementCredential, deletion('paused', 1).jobId, '2026-09-30T01:00:00.000Z');
    realDataset.save(dataset(), '2026-09-30T00:30:00.000Z');
    const service = new BrowserDeletionSessionService(credentials, realDataset, {
      async deletionStatus() { return { ok: true, deletion: deletion('complete', 2) }; },
      async continueDeletion() { return { ok: true, deletion: deletion('complete', 2) }; },
    });
    expect((await service.checkStatus())?.deletion.status).toBe('complete');
    expect(credentials.load()).toBeNull();
    expect(realDataset.load()).toBeNull();
  });
});
