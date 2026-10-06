import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { normalizeHenrikEvidence } from '../server/evidence/normalizeHenrikEvidence';
import { HISTORICAL_IDENTITY_VERSION } from '../server/evidence/types';
import { providerIdentityHmac } from '../server/identityProtection';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import {
  ConsentingParticipantAbsentError,
  ConsentingParticipantAmbiguousError,
  ParticipantAccountConflictError,
  ProviderIdentityUnresolvedError,
} from '../server/persistence/errors';
import { PostgresPlayerRepository } from '../server/repositories/postgres';
import { HistoricalSyncService } from '../server/sync/historicalSyncService';
import { PostgresSyncStore } from '../server/sync/postgresSyncStore';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';

/**
 * TASK-DATA-HISTORICAL-IDENTITY-01 (`historical-identity-v1`): the consenting participant is identified by
 * providerIdentityHmac('HenrikDev', affinity, players[].puuid) == the account's provider_identities.lookup_hmac,
 * never by the current Riot name/tag. All identifiers below are fictional fixtures.
 */
const hmacKey = 'test-historical-identity-hmac-key-with-32-bytes';
const connection = { gameName: 'CurrentName', tag: 'NOW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;
const PUUID_A = 'fictional-puuid-account-a';
const PUUID_B = 'fictional-puuid-account-b';
const open: { close(): Promise<void> }[] = [];
afterEach(async () => { vi.restoreAllMocks(); while (open.length) await open.pop()!.close(); });

class PGliteDatabase implements SqlDatabase {
  constructor(private readonly pg: PGlite) { open.push(this); }
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.pg.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.pg.exec('BEGIN');
    try { const value = await work(this); await this.pg.exec('COMMIT'); return value; }
    catch (error) { await this.pg.exec('ROLLBACK'); throw error; }
  }
  async close() { await this.pg.close(); }
}

interface Seat { puuid?: string; name: string; tag: string; team?: string }
function match(index: number, seats: Seat[]) {
  return {
    metadata: { match_id: `fictional-identity-match-${index}`, started_at: new Date(Date.UTC(2026, 4, 30 - index, 12)).toISOString(), game_length_in_ms: 120_000,
      map: { id: 'map-id', name: 'Ascent' }, queue: { id: 'competitive', name: 'Competitive' } },
    players: seats.map((seat) => ({ ...(seat.puuid ? { puuid: seat.puuid } : {}), name: seat.name, tag: seat.tag, team_id: seat.team ?? 'Blue',
      agent: { id: 'agent-id', name: 'Sova' }, stats: { kills: 3, deaths: 1, assists: 1, score: 300, headshots: 1, bodyshots: 1, legshots: 0, damage: { dealt: 200, received: 50 } } })),
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 0 } }],
    rounds: [],
    kills: [],
  };
}
const me = (name: string = connection.gameName, tag: string = connection.tag): Seat => ({ puuid: PUUID_A, name, tag });
const page = (...data: unknown[]) => ({ status: 200, data });
const input = { ...connection, playerId: '00000000-0000-4000-8000-000000000099', limit: 3 as const };
const expectedA = providerIdentityHmac('HenrikDev', 'ap', PUUID_A, hmacKey);
const consentingCount = (payload: unknown, expected = expectedA) =>
  normalizeHenrikEvidence(payload, input, hmacKey, expected).map((m) => m.participants.filter((p) => p.providerIdentityHmac).length);

async function database() {
  const db = new PGliteDatabase(new PGlite());
  await applyMigrations(db, await loadMigrations('migrations'));
  return db;
}
async function connect(db: SqlDatabase, puuid = PUUID_A, gameName: string = connection.gameName, affinity: string = connection.affinity) {
  const durable = new DurableEvidenceService(db, hmacKey);
  const { publicPlayerId } = await durable.persistConnection({ ...connection, gameName, affinity: affinity as 'ap' }, puuid, '2026-10-01T00:00:00.000Z');
  const internal = (await db.query<{ id: string }>('SELECT id FROM players WHERE public_id=$1', [publicPlayerId])).rows[0]!.id;
  return { durable, publicPlayerId: publicPlayerId!, internal };
}
const count = async (db: SqlDatabase, sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);

describe('historical-identity-v1 — pure normalizer matching', () => {
  it('declares the identity rule version separately from the evidence normalization version', () => {
    expect(HISTORICAL_IDENTITY_VERSION).toBe('historical-identity-v1');
    expect(normalizeHenrikEvidence(page(match(0, [me()])), input, hmacKey, expectedA)[0]!.normalizationVersion).toBe('durable-evidence-v2');
  });

  it('recognizes the same PUUID through a name change, a tag-only change, a name-only change and both', () => {
    expect(consentingCount(page(
      match(0, [me('OldName', connection.tag)]),
      match(1, [me(connection.gameName, 'OLD')]),
      match(2, [me('OldName', 'OLD')]),
    ))).toEqual([1, 1, 1]);
  });

  it('never recognizes the current Riot name/tag on a different PUUID, and recognizes a different name on the correct PUUID', () => {
    const [impostor] = consentingCount(page(match(0, [{ puuid: 'fictional-other', name: connection.gameName, tag: connection.tag }, { puuid: PUUID_A, name: 'Different', tag: 'XYZ' }])));
    expect(impostor).toBe(1);
    const evidence = normalizeHenrikEvidence(page(match(0, [{ puuid: 'fictional-other', name: connection.gameName, tag: connection.tag }])), input, hmacKey, expectedA)[0]!;
    expect(evidence.participants.every((p) => p.providerIdentityHmac === undefined)).toBe(true);
  });

  it('does not link a participant without a PUUID, and an identity of another affinity never matches', () => {
    expect(consentingCount(page(match(0, [{ name: connection.gameName, tag: connection.tag }])))).toEqual([0]);
    expect(consentingCount(page(match(0, [me()])), providerIdentityHmac('HenrikDev', 'eu', PUUID_A, hmacKey))).toEqual([0]);
  });

  it('flags a duplicated target PUUID as more than one consenting participant, and requires an expected identity', () => {
    expect(consentingCount(page(match(0, [me(), me('Copy', 'DUP')])))).toEqual([2]);
    expect(() => normalizeHenrikEvidence(page(match(0, [me()])), input, hmacKey, '')).toThrow();
  });
});

describe('historical-identity-v1 — durable provider identity resolution', () => {
  it('resolves exactly one active HenrikDev identity for the exact account and affinity', async () => {
    const db = await database();
    const a = await connect(db);
    const repo = new PostgresPlayerRepository();
    await expect(repo.resolveProviderIdentityHmac(db, { id: a.internal }, 'ap')).resolves.toBe(expectedA);
    await expect(repo.resolveProviderIdentityHmac(db, { publicId: a.publicPlayerId }, 'ap')).resolves.toBe(expectedA);
  });

  it('fails closed for an unknown account, the wrong affinity, an anonymized account and an ambiguous identity', async () => {
    const db = await database();
    const a = await connect(db);
    const repo = new PostgresPlayerRepository();
    await expect(repo.resolveProviderIdentityHmac(db, { id: '00000000-0000-4000-8000-0000000000aa' }, 'ap')).rejects.toBeInstanceOf(ProviderIdentityUnresolvedError);
    await expect(repo.resolveProviderIdentityHmac(db, { id: a.internal }, 'eu')).rejects.toBeInstanceOf(ProviderIdentityUnresolvedError);
    await db.query(`INSERT INTO provider_identities (id, player_id, provider, affinity, lookup_hmac) VALUES (gen_random_uuid(), $1, 'HenrikDev', 'ap', $2)`,
      [a.internal, providerIdentityHmac('HenrikDev', 'ap', 'fictional-second-identity', hmacKey)]);
    await expect(repo.resolveProviderIdentityHmac(db, { id: a.internal }, 'ap')).rejects.toBeInstanceOf(ProviderIdentityUnresolvedError);
    const b = await connect(db, PUUID_B, 'OtherAccount');
    await db.query('UPDATE players SET anonymized_at=now() WHERE id=$1', [b.internal]);
    await expect(repo.resolveProviderIdentityHmac(db, { id: b.internal }, 'ap')).rejects.toBeInstanceOf(ProviderIdentityUnresolvedError);
  });

  it('the wrong account never claims the match, and a revoked consent writes nothing', async () => {
    const db = await database();
    const a = await connect(db);
    const b = await connect(db, PUUID_B, 'OtherAccount');
    await expect(b.durable.persistSyncPage(input, page(match(0, [me()])), b.internal)).rejects.toBeInstanceOf(ConsentingParticipantAbsentError);
    await db.query(`UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id=$1`, [a.internal]);
    await expect(a.durable.persistSyncPage(input, page(match(0, [me()])), a.internal)).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(await count(db, 'SELECT count(*)::text AS n FROM source_matches')).toBe(0);
  });
});

describe('historical-identity-v1 — durable persistence', () => {
  it('persists a renamed historical match for the exact account through the normal import path too', async () => {
    const db = await database();
    const a = await connect(db);
    await a.durable.persistMatches({ ...input, playerId: a.publicPlayerId }, page(match(0, [me('OldName', 'OLD')]), match(1, [me()])));
    expect(await count(db, 'SELECT count(*)::text AS n FROM match_participants WHERE player_id=$1', [a.internal])).toBe(2);
  });

  it('fails closed on missing PUUID, duplicate target PUUID and true absence with typed non-database errors', async () => {
    const db = await database();
    const a = await connect(db);
    await expect(a.durable.persistSyncPage(input, page(match(0, [{ name: connection.gameName, tag: connection.tag }])), a.internal)).rejects.toBeInstanceOf(ConsentingParticipantAbsentError);
    await expect(a.durable.persistSyncPage(input, page(match(0, [me(), me('Copy', 'DUP')])), a.internal)).rejects.toBeInstanceOf(ConsentingParticipantAmbiguousError);
    await expect(a.durable.persistSyncPage(input, page(match(0, [{ puuid: 'fictional-other', name: connection.gameName, tag: connection.tag }])), a.internal)).rejects.toBeInstanceOf(ConsentingParticipantAbsentError);
    expect(await count(db, 'SELECT count(*)::text AS n FROM source_matches')).toBe(0);
  });

  it('multi-account: only PUUID-A links to Account A; the other account and non-consenting players stay NULL, then heal on their own sync', async () => {
    const db = await database();
    const a = await connect(db);
    const b = await connect(db, PUUID_B, 'SiblingAccount');
    const shared = page(match(0, [me(), { puuid: PUUID_B, name: 'SiblingAccount', tag: 'NOW' }, { puuid: 'fictional-stranger', name: 'Stranger', tag: 'XX', team: 'Red' }]));
    await a.durable.persistSyncPage(input, shared, a.internal);
    const owners = async () => (await db.query<{ player_id: string | null }>('SELECT player_id FROM match_participants ORDER BY player_id NULLS LAST')).rows.map((r) => r.player_id);
    expect((await owners()).filter(Boolean)).toEqual([a.internal]);
    expect(await count(db, 'SELECT count(*)::text AS n FROM match_participants WHERE player_id IS NULL')).toBe(2);
    await b.durable.persistSyncPage({ ...input, gameName: 'SiblingAccount' }, shared, b.internal);
    expect(new Set((await owners()).filter(Boolean))).toEqual(new Set([a.internal, b.internal]));
    expect(await count(db, 'SELECT count(*)::text AS n FROM match_participants WHERE player_id IS NULL')).toBe(1);
  });

  it('never overwrites a participant already linked to a different account (fails closed, link preserved)', async () => {
    const db = await database();
    const eu = await connect(db, PUUID_A, 'SameRiotAccountEu', 'eu');
    const ap = await connect(db, PUUID_A);
    await eu.durable.persistSyncPage({ ...input, affinity: 'eu' }, page(match(0, [me()])), eu.internal);
    await expect(ap.durable.persistSyncPage(input, page(match(0, [me()])), ap.internal)).rejects.toBeInstanceOf(ParticipantAccountConflictError);
    expect((await db.query<{ player_id: string }>('SELECT player_id FROM match_participants')).rows.map((r) => r.player_id)).toEqual([eu.internal]);
  });

  it('replay is idempotent: no duplicate source match or participant', async () => {
    const db = await database();
    const a = await connect(db);
    const payload = page(match(0, [me('OldName', 'OLD'), { puuid: 'fictional-stranger', name: 'Stranger', tag: 'XX' }]));
    await a.durable.persistSyncPage(input, payload, a.internal);
    await a.durable.persistSyncPage(input, payload, a.internal);
    expect(await count(db, 'SELECT count(*)::text AS n FROM source_matches')).toBe(1);
    expect(await count(db, 'SELECT count(*)::text AS n FROM match_participants')).toBe(2);
  });
});

class Provider {
  calls = 0;
  constructor(public pages: Map<number, unknown[]>) {}
  async fetchHistoryPage(_input: unknown, start: number) { this.calls += 1; return { status: 200, data: this.pages.get(start) ?? [] }; }
  async fetchStoredIndexPage() { this.calls += 1; return { data: [] }; }
  async fetchMatchDetail() { throw new Error('not used'); }
}

describe('historical-identity-v1 — the production incident end-to-end (HistoricalSyncService + DurableEvidenceService + PGlite)', () => {
  const capture = () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { lines.push(String(chunk)); return true; });
    return () => lines.join('');
  };
  async function env(second: unknown[]) {
    const db = await database();
    const a = await connect(db);
    const provider = new Provider(new Map([[0, [match(0, [me()]), match(1, [me()]), match(2, [me()])]], [3, second]]));
    const service = new HistoricalSyncService(new PostgresSyncStore(db), a.durable, provider as never, hmacKey, { now: () => new Date('2026-10-06T14:00:00.000Z') });
    return { db, a, provider, service };
  }
  const run = async (db: SqlDatabase) => (await db.query<Record<string, unknown>>(
    `SELECT sr.status, sr.error_category, sc.next_start, sc.lease_token FROM sync_runs sr JOIN sync_cursors sc ON sc.player_id=sr.player_id AND sc.sync_kind=sr.sync_kind WHERE sr.sync_kind='deep_backfill'`)).rows[0]!;

  it('earlier matches already committed + a later match under an older Riot ID → success, overlaps counted, cursor advances, no DB failure', async () => {
    const e = await env([match(3, [me()]), match(4, [me()]), match(5, [me('OldName', 'OLD')])]);
    // Reproduce the production state: the page's two newer matches were committed by the earlier failed attempt.
    await e.a.durable.persistSyncPage(input, page(match(3, [me()]), match(4, [me()])), e.a.internal);
    const log = capture();
    const first = await e.service.start(e.a.publicPlayerId, 'deep_backfill');
    const second = await e.service.continue(first.runId);
    expect(second.progress.overlapsUpdated).toBe(2);
    expect(await run(e.db)).toMatchObject({ error_category: null, next_start: 6, lease_token: null });
    expect(await count(e.db, 'SELECT count(*)::text AS n FROM source_matches')).toBe(6);
    expect(await count(e.db, 'SELECT count(*)::text AS n FROM match_participants WHERE player_id=$1', [e.a.internal])).toBe(6);
    const output = log();
    expect(output).not.toContain('sync_database_failure');
    expect(output).toContain('deep_history_chunk');
    // Privacy: no PUUID, HMAC, internal id or name in logs or the public status.
    for (const text of [output, JSON.stringify(second)]) {
      expect(text).not.toMatch(/fictional|OldName|[0-9a-f]{64}/u);
      expect(text).not.toContain(e.a.internal);
    }
  });

  it('a true identity absence fails closed as MALFORMED_RESPONSE (not DATABASE_ERROR), cursor not advanced, no DB telemetry', async () => {
    const e = await env([match(3, [me()]), match(4, [me()]), match(5, [{ puuid: 'fictional-other', name: connection.gameName, tag: connection.tag }])]);
    const log = capture();
    const first = await e.service.start(e.a.publicPlayerId, 'deep_backfill');
    await expect(e.service.continue(first.runId)).rejects.toMatchObject({ status: 502, code: 'MALFORMED_PROVIDER_RESPONSE' });
    expect(await run(e.db)).toMatchObject({ status: 'failed', error_category: 'MALFORMED_RESPONSE', next_start: 3, lease_token: null });
    expect(await count(e.db, 'SELECT count(*)::text AS n FROM source_matches')).toBe(5); // per-match atomicity unchanged
    expect(log()).not.toContain('sync_database_failure');
  });

  it('the incremental path shares the rule: renamed match succeeds; true absence is MALFORMED_RESPONSE without DB telemetry', async () => {
    const renamed = await env([]);
    renamed.provider.pages.set(0, [match(0, [me('OldName', 'OLD')])]);
    const ok = await renamed.service.start(renamed.a.publicPlayerId, 'incremental');
    expect(ok.lastErrorCategory ?? null).toBeNull();
    expect(await count(renamed.db, 'SELECT count(*)::text AS n FROM match_participants WHERE player_id=$1', [renamed.a.internal])).toBe(1);
    const absent = await env([]);
    absent.provider.pages.set(0, [match(0, [{ puuid: 'fictional-other', name: connection.gameName, tag: connection.tag }])]);
    const log = capture();
    await expect(absent.service.start(absent.a.publicPlayerId, 'incremental')).rejects.toMatchObject({ status: 502, code: 'MALFORMED_PROVIDER_RESPONSE' });
    expect(log()).not.toContain('sync_database_failure');
  });
});
