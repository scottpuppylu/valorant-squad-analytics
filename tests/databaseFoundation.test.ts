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

const hmacKey = 'test-only-key-material-with-at-least-thirty-two-bytes';
const input: MatchImportInput = {
  playerId: '11111111-1111-4111-8111-111111111111',
  gameName: 'GoblinScout', tag: 'TW', affinity: 'ap', consent: true, limit: 3,
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
        { puuid: 'consenting-puuid', name: 'GoblinScout', tag: 'TW', team_id: 'Blue', agent: { id: 'jett-id', name: 'Jett' }, stats: { kills: 1, deaths: 0, assists: 0, score: 300, headshots: 1, bodyshots: 0, legshots: 0, damage: { dealt: 150, received: 0 } } },
        { puuid: 'private-teammate-puuid', name: 'PrivateTeammate', tag: 'XX', team_id: 'Blue', agent: { id: 'sova-id', name: 'Sova' }, stats: { kills: 0, deaths: 0, assists: 1, score: 100, headshots: 0, bodyshots: 0, legshots: 0, damage: { dealt: 30, received: 0 } } },
        { puuid: 'private-opponent-puuid', name: 'PrivateOpponent', tag: 'XX', team_id: 'Red', agent: { id: 'sage-id', name: 'Sage' }, stats: { kills: 0, deaths: 1, assists: 0, score: 0, headshots: 0, bodyshots: 0, legshots: 0, damage: { dealt: 0, received: 150 } } },
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
      kills: [{ round: 1, time_in_round_in_ms: 10_000, time_in_match_in_ms: 10_000, killer: { puuid: 'consenting-puuid', team: 'Blue' }, victim: { puuid: 'private-opponent-puuid', team: 'Red' }, assistants: [{ puuid: 'private-teammate-puuid', team: 'Blue' }], weapon: { id: 'vandal-id', name: 'Vandal' }, location: { x: 0, y: 42 }, player_locations: [{ puuid: 'consenting-puuid', x: 0, y: 42 }, { puuid: 'private-opponent-puuid', x: 50, y: 70 }] }],
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
    ]);
    const cursorColumns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='sync_cursors'`,
    );
    expect(cursorColumns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      'sync_kind', 'last_successful_page', 'last_page_fingerprint_hmac', 'last_error_category',
      'next_attempt_at', 'coverage_complete_for_provider_window', 'coverage_incomplete_reason',
      'lease_token', 'lease_expires_at',
    ]));
  });

  it('enforces database uniqueness independently of application checks', async () => {
    await database.query(`INSERT INTO squads (id, slug, display_name) VALUES ('00000000-0000-4000-8000-000000000001','unique-squad','Unique')`);
    await expect(database.query(`INSERT INTO squads (id, slug, display_name) VALUES ('00000000-0000-4000-8000-000000000002','unique-squad','Duplicate')`)).rejects.toThrow();
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
    expect(summary.performance).toMatchObject({
      sqlQueryCount: 12,
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
    const evidence = normalizeHenrikEvidence(rawPayload(), input, hmacKey)[0]!;
    expect(evidence.participants[2]).toMatchObject({ kills: 0, deaths: 1, status: 'observed' });
    expect(evidence.rounds[0]).toMatchObject({ plantStatus: 'absent', defuseStatus: 'missing' });
    expect(evidence.rounds[0]?.participants[2]).toMatchObject({ loadoutValue: 0, weaponStatus: 'missing', armorStatus: 'missing' });
    expect(evidence.participants[2]?.providerIdentityHmac).toBeUndefined();
    const service = new DurableEvidenceService(database, hmacKey);
    const connected = await service.persistConnection(input, 'consenting-puuid');
    await service.persistMatches({ ...input, playerId: connected.publicPlayerId! }, rawPayload());
    expect(await scalar(database, 'players')).toBe(1);
    expect(await scalar(database, 'match_participants')).toBe(3);
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
