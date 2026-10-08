import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import { normalizeHenrikEvidence } from '../server/evidence/normalizeHenrikEvidence';
import { participantHmac, providerIdentityHmac } from '../server/identityProtection';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { assertProviderAuditAllowed } from '../server/providerAuditAccess';
import type { MatchImportInput } from '../server/contracts';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { HenrikDataProvider } from '../server/henrikDataProvider';
import { MemberAdminService } from '../server/identity/memberAdminService';

const hmacKey = 'test-only-key-material-with-at-least-thirty-two-bytes';
const expectedIdentity = providerIdentityHmac('HenrikDev', 'ap', 'consenting-puuid', hmacKey);
const input: MatchImportInput = {
  playerId: '11111111-1111-4111-8111-111111111111',
  gameName: 'GoblinScout', tag: 'TW', affinity: 'ap', consent: true,
  privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION, limit: 3,
};

class PGliteDatabase implements SqlDatabase {
  constructor(private readonly database: PGlite) {}
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.database.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.database.exec('BEGIN');
    try {
      const value = await work(this);
      await this.database.exec('COMMIT');
      return value;
    } catch (error) {
      await this.database.exec('ROLLBACK');
      throw error;
    }
  }
  async close(): Promise<void> { await this.database.close(); }
}

class KillWriteFailureDatabase implements SqlDatabase {
  constructor(private readonly database: PGliteDatabase) {}
  query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    return this.database.query<Row>(sql, params);
  }
  transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) => work({
      query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
        if (sql.includes('INSERT INTO kill_events')) throw new Error('forced evidence write failure');
        return transaction.query<Row>(sql, params);
      },
    }));
  }
  async close(): Promise<void> {}
}

function rawPayload() {
  return {
    status: 200,
    data: [{
      metadata: {
        match_id: 'provider-match-one', started_at: '2026-09-29T12:00:00.000Z', game_length_in_ms: 120_000,
        map: { id: 'ascent-id', name: 'Ascent' }, queue: { id: 'competitive', name: 'Competitive' },
      },
      players: [
        { puuid: 'consenting-puuid', name: 'GoblinScout', tag: 'TW', team_id: 'Blue', agent: { id: 'jett-id', name: 'Jett' }, stats: { kills: 1, deaths: 0, assists: 0, score: 300, headshots: 1, bodyshots: 0, legshots: 0, damage: { dealt: 150, received: 0 } }, ability_casts: { ability1: 3, ability2: 2, grenade: 1, ultimate: 1 }, economy: { loadout_value: { overall: 3900, average: 3900 }, spent: { overall: 4300, average: 4300 } } },
        { puuid: 'private-teammate-puuid', name: 'PrivateTeammate', tag: 'XX', team_id: 'Blue', agent: { id: 'sova-id', name: 'Sova' }, stats: { kills: 0, deaths: 0, assists: 1, score: 100, headshots: 0, bodyshots: 0, legshots: 0, damage: { dealt: 30, received: 0 } }, ability_casts: { ability1: 0, ability2: 0, grenade: 0, ultimate: 0 }, economy: { loadout_value: { overall: 0, average: 0 }, spent: { overall: 0, average: 0 } } },
        { puuid: 'private-opponent-puuid', name: 'PrivateOpponent', tag: 'XX', team_id: 'Red', agent: { id: 'sage-id', name: 'Sage' }, stats: { kills: 0, deaths: 1, assists: 0, score: 0, headshots: 0, bodyshots: 0, legshots: 0, damage: { dealt: 0, received: 150 } }, ability_casts: null, economy: 'malformed' },
      ],
      teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 0 } }, { team_id: 'Red', won: false, rounds: { won: 0, lost: 1 } }],
      rounds: [{
        id: 1, winning_team: 'Blue', result: 'Eliminated', plant: null,
        stats: [
          { player: { puuid: 'consenting-puuid' }, stats: { kills: 1, score: 300 }, economy: { loadout_value: 3900, remaining: 100, weapon: { id: 'vandal-id', name: 'Vandal' } } },
          { player: { puuid: 'private-teammate-puuid' }, stats: { kills: 0, score: 100 }, economy: { loadout_value: 2900, remaining: 200, weapon: { id: 'phantom-id', name: 'Phantom' } } },
          { player: { puuid: 'private-opponent-puuid' }, stats: { kills: 0, score: 0 }, economy: { loadout_value: 0, remaining: 800 } },
        ],
      }],
      kills: [{ round: 1, time_in_round_in_ms: 10_000, time_in_match_in_ms: 10_000, killer: { puuid: 'consenting-puuid', team: 'Blue' }, victim: { puuid: 'private-opponent-puuid', team: 'Red' }, assistants: [{ puuid: 'private-teammate-puuid', team: 'Blue' }], weapon: { id: 'vandal-id', name: 'Vandal' }, location: { x: 0, y: 42 }, player_locations: [{ player: { puuid: 'consenting-puuid', team: 'Blue' }, location: { x: 0, y: 42 }, view_radians: 1.5 }, { player: { puuid: 'private-teammate-puuid', team: 'Blue' }, location: { x: 50, y: 70 }, view_radians: 0.25 }] }],
    }],
  };
}

async function scalar(database: SqlDatabase, table: string): Promise<number> {
  const result = await database.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

describe('durable database and consent foundation', () => {
  let database: PGliteDatabase;
  beforeEach(async () => {
    database = new PGliteDatabase(new PGlite());
    await applyMigrations(database, await loadMigrations(resolve('migrations')));
  });
  afterEach(async () => { await database.close(); });

  it('applies deterministic migrations once and creates the required relational grain', async () => {
    expect(await applyMigrations(database, await loadMigrations(resolve('migrations')))).toEqual([]);
    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
      'players', 'consents', 'source_matches', 'match_participants', 'rounds', 'round_participants',
      'kill_events', 'kill_assistants', 'event_player_locations', 'rank_observations', 'sync_runs', 'sync_cursors', 'deletion_jobs',
    ]));
  });

  it('applies immutable migration 0002 once with durable cursor, lease, coverage, and retry state', async () => {
    const versions = await database.query<{ version: string; applied: string }>(
      `SELECT version,count(*)::text AS applied FROM schema_migrations GROUP BY version ORDER BY version`,
    );
    expect(versions.rows).toEqual([
      { version: '0001', applied: '1' },
      { version: '0002', applied: '1' },
      { version: '0003', applied: '1' },
      { version: '0004', applied: '1' },
      { version: '0005', applied: '1' },
      { version: '0006', applied: '1' },
      { version: '0007', applied: '1' },
      { version: '0008', applied: '1' },
      { version: '0009', applied: '1' },
      { version: '0010', applied: '1' },
      { version: '0011', applied: '1' },
      { version: '0012', applied: '1' },
    ]);
    const cursorColumns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='sync_cursors'`,
    );
    expect(cursorColumns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      'sync_kind', 'last_successful_page', 'last_page_fingerprint_hmac', 'last_error_category',
      'next_attempt_at', 'coverage_complete_for_provider_window', 'coverage_incomplete_reason',
      'lease_token', 'lease_expires_at',
    ]));
    const evidenceColumns = await database.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns
       WHERE (table_name='source_matches' AND column_name IN ('rounds_evidence_status','kills_evidence_status'))
          OR (table_name='match_participants' AND column_name IN ('ability_evidence_status','economy_evidence_status'))
          OR (table_name='rounds' AND column_name='participants_evidence_status')
       ORDER BY table_name,column_name`,
    );
    expect(evidenceColumns.rows).toHaveLength(5);
  });

  it('validates member-identity-v1 invariants: 1 member per account, <=1 primary, no empty or colliding members', async () => {
    const writer = new DurableEvidenceService(database, hmacKey);
    for (const [index, name] of ['IdentityOne', 'IdentityTwo', 'IdentityThree'].entries()) {
      await writer.persistConnection({ ...input, gameName: name }, `identity-puuid-${index}`);
    }
    expect(await new MemberAdminService(database).invariants()).toEqual({
      members: 3, archivedMembers: 0, accounts: 3, liveAccounts: 3, accountsWithoutMember: 0, membersWithMultiplePrimaries: 0,
      activeMembersWithoutLiveAccount: 0, liveAccountsOnArchivedMember: 0, sameMatchMemberCollisions: 0, accountsPerMember: { 1: 3 },
    });
    const columns = await database.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='players' AND column_name IN ('member_id','is_primary_account') ORDER BY column_name`);
    expect(columns.rows).toEqual([{ column_name: 'is_primary_account', is_nullable: 'NO' }, { column_name: 'member_id', is_nullable: 'NO' }]);
  });

  it('enforces database uniqueness independently of application checks', async () => {
    await database.query(`INSERT INTO squads (id, slug, display_name) VALUES ('00000000-0000-4000-8000-000000000001','unique-squad','Unique')`);
    await expect(database.query(`INSERT INTO squads (id, slug, display_name) VALUES ('00000000-0000-4000-8000-000000000002','unique-squad','Duplicate')`)).rejects.toThrow();
  });

  it('upgrades an existing 0001-0004 database through 0007 and reruns idempotently', async () => {
    const existing = new PGliteDatabase(new PGlite());
    try {
      const migrations = await loadMigrations(resolve('migrations'));
      expect(await applyMigrations(existing, migrations.slice(0, 4))).toEqual(['0001', '0002', '0003', '0004']);
      await existing.query(`INSERT INTO players (id,public_id,display_name,display_tag)
        VALUES ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102','Upgrade','TW')`);
      await existing.query(`INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at)
        VALUES ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000101','active','self_asserted','old-v1',now())`);
      expect(await applyMigrations(existing, migrations)).toEqual(['0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012']);
      expect(await applyMigrations(existing, migrations)).toEqual([]);
    } finally {
      await existing.close();
    }
  });

  it('upgrades populated 0006 sync records to 0007 without resetting legacy cursor, run or evidence', async () => {
    const existing = new PGliteDatabase(new PGlite());
    try {
      const migrations = await loadMigrations(resolve('migrations'));
      // The CURRENT writer also maintains analysis-match-facts-v1 (0011) and position-evidence-v1 (0012), both
      // independent of 0007–0010, so the populated pre-0007 state is written with those additive objects present.
      await applyMigrations(existing, [...migrations.slice(0, 6), ...migrations.filter((migration) => migration.version === '0011' || migration.version === '0012')]);
      const writer = new DurableEvidenceService(existing, hmacKey);
      const connected = await writer.persistConnection(input, 'consenting-puuid');
      await writer.persistMatches({ ...input, playerId: connected.publicPlayerId! }, rawPayload());
      await existing.query(`INSERT INTO sync_cursors (id,player_id,provider,affinity,sync_kind,next_start,retry_count)
        SELECT '00000000-0000-4000-8000-000000000121',id,'HenrikDev','ap','backfill',159,2 FROM players LIMIT 1`);
      await existing.query(`INSERT INTO sync_runs (id,squad_id,player_id,provider,trigger_kind,status,started_at,sync_kind,matches_seen)
        SELECT '00000000-0000-4000-8000-000000000122',squad_id,player_id,'HenrikDev','manual','paused',now(),'backfill',159 FROM squad_memberships LIMIT 1`);
      expect(await applyMigrations(existing, migrations)).toEqual(['0007', '0008', '0009', '0010']);
      expect(await applyMigrations(existing, migrations)).toEqual([]);
      expect((await existing.query('SELECT sync_kind,next_start,retry_count,stored_page,stored_item_index FROM sync_cursors')).rows[0]).toEqual({ sync_kind: 'backfill', next_start: 159, retry_count: 2, stored_page: 1, stored_item_index: 0 });
      expect((await existing.query('SELECT sync_kind,status,matches_seen FROM sync_runs')).rows[0]).toEqual({ sync_kind: 'backfill', status: 'paused', matches_seen: 159 });
      expect(await scalar(existing, 'source_matches')).toBe(1);
      expect(await scalar(existing, 'kill_events')).toBe(1);
    } finally { await existing.close(); }
  });

  it('enforces at most one active consent per player across privacy versions', async () => {
    await database.query(`INSERT INTO players (id,public_id,display_name,display_tag)
      VALUES ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000112','UniqueConsent','TW')`);
    await database.query(`INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at)
      VALUES ('00000000-0000-4000-8000-000000000113','00000000-0000-4000-8000-000000000111','active','self_asserted','old-v1',now())`);
    await expect(database.query(`INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at)
      VALUES ('00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000111','active','self_asserted',$1,now())`,
    [PUBLIC_DATASET_PRIVACY_VERSION])).rejects.toThrow();
  });

  it('atomically upgrades explicit old consent to the current public policy and issues a new credential', async () => {
    const service = new DurableEvidenceService(database, hmacKey);
    const first = await service.persistConnection(input, 'policy-upgrade-puuid', '2026-10-01T00:00:00.000Z');
    expect(first.managementCredential).toBeDefined();
    await database.query("UPDATE consents SET privacy_version='old-private-v1'");
    const upgraded = await service.persistConnection(input, 'policy-upgrade-puuid', '2026-10-02T00:00:00.000Z');
    expect(upgraded.managementCredential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await database.query<{ status: string; privacy_version: string; revoked_at: string | Date | null }>(
      'SELECT status,privacy_version,revoked_at FROM consents ORDER BY consented_at',
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ status: 'revoked', privacy_version: 'old-private-v1' });
    expect(new Date(rows.rows[0]!.revoked_at!).toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(rows.rows[1]).toMatchObject({ status: 'active', privacy_version: PUBLIC_DATASET_PRIVACY_VERSION, revoked_at: null });
    expect(rows.rows.filter((row) => row.status === 'active')).toHaveLength(1);
  });

  it('blocks an old-policy manual import before provider access', async () => {
    const service = new DurableEvidenceService(database, hmacKey);
    const connected = await service.persistConnection(input, 'old-policy-import-puuid', '2026-10-01T00:00:00.000Z');
    await database.query("UPDATE consents SET privacy_version='old-private-v1' WHERE status='active'");
    let providerCalls = 0;
    const provider = new HenrikDataProvider('configured', {
      durableWriter: service,
      fetchImpl: async () => {
        providerCalls += 1;
        return new Response(JSON.stringify(rawPayload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    await expect(provider.importMatches({ ...input, playerId: connected.publicPlayerId! })).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(providerCalls).toBe(0);
  });

  it('writes one consenting player, one active consent and one match idempotently', async () => {
    const service = new DurableEvidenceService(database, hmacKey);
    const connected = await service.persistConnection(input, 'consenting-puuid', '2026-09-30T00:00:00.000Z');
    const authorizedInput = { ...input, playerId: connected.publicPlayerId! };
    const summary = await service.persistMatches(authorizedInput, rawPayload(), '2026-09-30T00:00:00.000Z');
    const tables = ['players', 'consents', 'source_matches', 'match_teams', 'match_participants', 'rounds', 'round_participants', 'kill_events', 'kill_assistants', 'event_player_locations'];
    const first = await Promise.all(tables.map((table) => scalar(database, table)));
    await service.persistMatches(authorizedInput, rawPayload(), '2026-09-30T00:01:00.000Z');
    const second = await Promise.all(tables.map((table) => scalar(database, table)));
    expect(first).toEqual([1, 1, 1, 2, 3, 1, 3, 1, 1, 2]);
    expect(second).toEqual(first);
    const corrected = rawPayload();
    corrected.data[0]!.players[0]!.ability_casts = { ability1: 4, ability2: 0, grenade: 0, ultimate: 0 };
    corrected.data[0]!.players[0]!.economy = { loadout_value: { overall: 7000, average: 3500 }, spent: { overall: 5000, average: 2500 } };
    await service.persistMatches(authorizedInput, corrected, '2026-09-30T00:02:00.000Z');
    const correctedRow = await database.query<{ ability_1_casts: number; spent_total: number }>(
      'SELECT ability_1_casts,spent_total FROM match_participants WHERE player_id IS NOT NULL',
    );
    expect(correctedRow.rows[0]).toEqual({ ability_1_casts: 4, spent_total: 5000 });
    expect(summary.performance).toMatchObject({
      sqlQueryCount: 17, // + import gate, identity resolution, participant-conflict check (historical-identity-v1) and the analysis-fact source read + write (analysis-match-facts-v1)
      evidenceCounts: { participants: 3, teams: 2, rounds: 1, roundParticipants: 3, kills: 1, assistants: 1, locations: 2 },
    });
    const orphaned = await database.query<{ count: string }>(`
      SELECT (
        (SELECT count(*) FROM kill_events k LEFT JOIN rounds r ON r.id=k.round_id WHERE r.id IS NULL) +
        (SELECT count(*) FROM kill_assistants a LEFT JOIN kill_events k ON k.id=a.kill_event_id WHERE k.id IS NULL) +
        (SELECT count(*) FROM event_player_locations l LEFT JOIN kill_events k ON k.id=l.kill_event_id WHERE k.id IS NULL)
      )::text AS count
    `);
    expect(Number(orphaned.rows[0]?.count ?? -1)).toBe(0);
    expect(JSON.stringify(await database.query('SELECT * FROM provider_identities'))).not.toContain('consenting-puuid');
  });

  it('preserves observed zero, marks missing evidence and does not create a non-consenting player', async () => {
    const evidence = normalizeHenrikEvidence(rawPayload(), input, hmacKey, expectedIdentity)[0]!;
    expect(evidence).toMatchObject({ normalizationVersion: 'durable-evidence-v2', roundsStatus: 'observed', killsStatus: 'observed' });
    expect(evidence.participants[0]).toMatchObject({ abilityStatus: 'observed', ability1Casts: 3, economyStatus: 'observed', spentTotal: 4300 });
    expect(evidence.participants[1]).toMatchObject({ abilityStatus: 'observed', ability1Casts: 0, economyStatus: 'observed', spentTotal: 0 });
    expect(evidence.participants[2]).toMatchObject({ kills: 0, deaths: 1, status: 'observed' });
    expect(evidence.participants[2]).toMatchObject({ abilityStatus: 'unavailable', economyStatus: 'unavailable' });
    expect(evidence.rounds[0]).toMatchObject({ plantStatus: 'absent', defuseStatus: 'missing' });
    expect(evidence.rounds[0]?.participants[2]).toMatchObject({ loadoutValue: 0, weaponStatus: 'missing', armorStatus: 'missing' });
    expect(evidence.participants[2]?.providerIdentityHmac).toBeUndefined();
    const service = new DurableEvidenceService(database, hmacKey);
    const connected = await service.persistConnection(input, 'consenting-puuid');
    await service.persistMatches({ ...input, playerId: connected.publicPlayerId! }, rawPayload());
    expect(await scalar(database, 'players')).toBe(1);
    expect(await scalar(database, 'match_participants')).toBe(3);
    const persisted = await database.query<{ ability_1_casts: number | null; spent_total: number | null; ability_evidence_status: string; economy_evidence_status: string }>(
      `SELECT ability_1_casts,spent_total,ability_evidence_status,economy_evidence_status
       FROM match_participants WHERE player_id IS NOT NULL`,
    );
    expect(persisted.rows[0]).toEqual({ ability_1_casts: 3, spent_total: 4300, ability_evidence_status: 'observed', economy_evidence_status: 'observed' });
  });

  it('keeps missing, null and malformed match-level evidence distinct from observed zero', () => {
    const payload = rawPayload();
    const source = payload.data[0]!.players;
    const missingPlayer: Record<string, unknown> = { ...source[0] };
    delete missingPlayer.ability_casts;
    delete missingPlayer.economy;
    const missing = normalizeHenrikEvidence({ ...payload, data: [{ ...payload.data[0], players: [missingPlayer] }] }, input, hmacKey, expectedIdentity)[0]!.participants[0]!;
    const unavailable = normalizeHenrikEvidence({ ...payload, data: [{ ...payload.data[0], players: [{ ...source[0], ability_casts: null, economy: [] }] }] }, input, hmacKey, expectedIdentity)[0]!.participants[0]!;
    expect(missing).toMatchObject({ abilityStatus: 'missing', economyStatus: 'missing' });
    expect(missing.ability1Casts).toBeUndefined();
    expect(unavailable).toMatchObject({ abilityStatus: 'unavailable', economyStatus: 'unavailable' });
    expect(unavailable.ability1Casts).toBeUndefined();
  });

  it('distinguishes observed empty, missing and malformed event collections', () => {
    const payload = rawPayload();
    const base = payload.data[0]!;
    const observedEmpty = normalizeHenrikEvidence({ ...payload, data: [{ ...base, rounds: [], kills: [] }] }, input, hmacKey, expectedIdentity)[0]!;
    const missingMatch: Record<string, unknown> = { ...base };
    delete missingMatch.rounds;
    delete missingMatch.kills;
    const missing = normalizeHenrikEvidence({ ...payload, data: [missingMatch] }, input, hmacKey, expectedIdentity)[0]!;
    const unavailable = normalizeHenrikEvidence({ ...payload, data: [{ ...base, rounds: null, kills: {} }] }, input, hmacKey, expectedIdentity)[0]!;
    expect(observedEmpty).toMatchObject({ roundsStatus: 'observed', killsStatus: 'observed', rounds: [] });
    expect(missing).toMatchObject({ roundsStatus: 'missing', killsStatus: 'missing', rounds: [] });
    expect(unavailable).toMatchObject({ roundsStatus: 'unavailable', killsStatus: 'unavailable', rounds: [] });
  });

  it('rolls back the full match when a batched child write fails', async () => {
    const service = new DurableEvidenceService(new KillWriteFailureDatabase(database), hmacKey);
    const connected = await service.persistConnection(input, 'consenting-puuid');
    await expect(service.persistMatches({ ...input, playerId: connected.publicPlayerId! }, rawPayload())).rejects.toThrow('forced evidence write failure');
    expect(await scalar(database, 'players')).toBe(1);
    expect(await scalar(database, 'consents')).toBe(1);
    for (const table of ['source_matches', 'match_participants', 'rounds', 'kill_events']) {
      expect(await scalar(database, table), table).toBe(0);
    }
  });

  it('rolls back a failed transaction without a partial durable player', async () => {
    await expect(database.transaction(async (transaction) => {
      await transaction.query(`INSERT INTO players (id, public_id, display_name, display_tag) VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','Rollback','TW')`);
      throw new Error('forced rollback');
    })).rejects.toThrow('forced rollback');
    expect(await scalar(database, 'players')).toBe(0);
  });

  it('uses domain-separated stable HMACs and match-scoped participant pseudonyms', () => {
    const identity = providerIdentityHmac('HenrikDev', 'ap', 'same-raw-value', hmacKey);
    expect(identity).toMatch(/^[a-f0-9]{64}$/);
    expect(identity).not.toContain('same-raw-value');
    expect(participantHmac('match-a', 'same-raw-value', hmacKey)).not.toBe(participantHmac('match-b', 'same-raw-value', hmacKey));
    expect(identity).not.toBe(participantHmac('match-a', 'same-raw-value', hmacKey));
  });

  it('disables the provider evidence audit in production', () => {
    expect(() => assertProviderAuditAllowed('production')).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => assertProviderAuditAllowed('preview')).not.toThrow();
  });
});
