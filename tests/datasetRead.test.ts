import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { normalizeHenrikMatches } from '../server/normalizeHenrik';
import datasetHandler from '../api/valorant/dataset';
import type { ApiRequest, ApiResponse, MatchImportInput } from '../server/contracts';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { datasetReadMode } from '../server/dataset/runtime';
import { buildSynergy } from '../src/synergy/analytics';

const migrationsPath = resolve('migrations');
const squadId = '00000000-0000-4000-8000-000000000001';
const hmacKey = 'dataset-test-key-material-with-at-least-thirty-two-bytes';
const openDatabases: PGliteDatabase[] = [];

class PGliteDatabase implements SqlDatabase {
  constructor(private readonly database: PGlite) { openDatabases.push(this); }
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

afterEach(async () => {
  while (openDatabases.length > 0) await openDatabases.pop()!.close();
});

async function migratedDatabase(limit?: number): Promise<PGliteDatabase> {
  const database = new PGliteDatabase(new PGlite());
  const migrations = await loadMigrations(migrationsPath);
  await applyMigrations(database, limit === undefined ? migrations : migrations.slice(0, limit));
  return database;
}

function uuid(kind: number, value: number): string {
  return `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function lookup(value: number): string {
  return value.toString(16).padStart(64, '0');
}

function placeholders(rows: number, width: number): string {
  let index = 1;
  return Array.from({ length: rows }, () => `(${Array.from({ length: width }, () => `$${index++}`).join(',')})`).join(',');
}

function objectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(objectKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...objectKeys(nested)]);
}

async function seedProjection(database: SqlDatabase, playerCount: number, matchCount: number, nonConsentingParticipants = 0): Promise<void> {
  await database.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3)', [squadId, 'friends', 'Friends']);
  const playerRows = Array.from({ length: playerCount }, (_, index) => [uuid(1, index + 1), uuid(2, index + 1), `Player${index + 1}`, `T${index + 1}`, index % 2 === 0 ? '🐺' : '🦊']);
  await database.query(`INSERT INTO players (id,public_id,display_name,display_tag,default_emoji) VALUES ${placeholders(playerRows.length, 5)}`, playerRows.flat());
  const membershipRows = playerRows.map((row, index) => [uuid(3, index + 1), squadId, row[0], 'active']);
  await database.query(`INSERT INTO squad_memberships (id,squad_id,player_id,status) VALUES ${placeholders(membershipRows.length, 4)}`, membershipRows.flat());
  const consentRows = playerRows.map((row, index) => [uuid(4, index + 1), row[0], 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00.000Z']);
  await database.query(`INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at) VALUES ${placeholders(consentRows.length, 6)}`, consentRows.flat());

  const matchRows = Array.from({ length: matchCount }, (_, index) => {
    const id = uuid(5, index + 1);
    const playedAt = new Date(Date.UTC(2026, 8, 29) - index * 60_000).toISOString();
    return [id, squadId, 'HenrikDev', lookup(index + 1), 'v4', 'durable-evidence-v2', 'ap', 'Ascent', 'competitive', 'Competitive', playedAt, 120_000, playedAt, playedAt, uuid(6, index + 1), 'observed', 'observed'];
  });
  if (matchRows.length === 0) return;
  await database.query(`INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status) VALUES ${placeholders(matchRows.length, 17)}`, matchRows.flat());
  const teamRows = matchRows.map((row, index) => [uuid(7, index + 1), row[0], 'Blue', true, 1, 0]);
  await database.query(`INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost) VALUES ${placeholders(teamRows.length, 6)}`, teamRows.flat());
  const participantRows: unknown[][] = [];
  const roundRows: unknown[][] = [];
  const roundParticipantRows: unknown[][] = [];
  const killRows: unknown[][] = [];
  let participantSequence = 1;
  for (let matchIndex = 0; matchIndex < matchRows.length; matchIndex += 1) {
    const matchId = matchRows[matchIndex]![0];
    const roundId = uuid(9, matchIndex + 1);
    const matchParticipantIds: string[] = [];
    roundRows.push([roundId, matchId, 1, 'observed', 'missing', 'missing']);
    for (let playerIndex = 0; playerIndex < playerRows.length; playerIndex += 1) {
      const participantId = uuid(8, participantSequence);
      matchParticipantIds.push(participantId);
      participantRows.push([participantId, matchId, playerRows[playerIndex]![0], lookup(10_000 + participantSequence), 'Blue', playerIndex % 2 === 0 ? 'Jett' : 'Sova', 'observed', 1, 0, 1, 300, 150, 1, 1, 0]);
      roundParticipantRows.push([uuid(10, participantSequence), roundId, participantId, 'observed', 'missing', 'missing', 'missing']);
      participantSequence += 1;
    }
    for (let privateIndex = 0; privateIndex < nonConsentingParticipants; privateIndex += 1) {
      const participantId = uuid(8, participantSequence);
      matchParticipantIds.push(participantId);
      participantRows.push([participantId, matchId, null, lookup(10_000 + participantSequence), privateIndex < 4 ? 'Blue' : 'Red', 'Cypher', 'observed', 0, 1, 0, 100, 50, 0, 1, 0]);
      roundParticipantRows.push([uuid(10, participantSequence), roundId, participantId, 'observed', 'missing', 'missing', 'missing']);
      participantSequence += 1;
    }
    if (nonConsentingParticipants > 0 && matchParticipantIds.length > 1) {
      killRows.push([uuid(13, matchIndex + 1), matchId, roundId, lookup(50_000 + matchIndex), 0, 1000, matchParticipantIds[0], matchParticipantIds.at(-1)]);
    }
  }
  await database.query(`INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots) VALUES ${placeholders(participantRows.length, 15)}`, participantRows.flat());
  await database.query(`INSERT INTO rounds (id,source_match_id,round_number,participants_evidence_status,plant_status,defuse_status) VALUES ${placeholders(roundRows.length, 6)}`, roundRows.flat());
  await database.query(`INSERT INTO round_participants (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status) VALUES ${placeholders(roundParticipantRows.length, 7)}`, roundParticipantRows.flat());
  if (killRows.length > 0) await database.query(`INSERT INTO kill_events (id,source_match_id,round_id,event_lookup_hmac,event_sequence,time_in_round_ms,killer_participant_id,victim_participant_id) VALUES ${placeholders(killRows.length, 8)}`, killRows.flat());
}

function parityPayload() {
  return { status: 200, data: [{
    metadata: { match_id: 'provider-parity-match', started_at: '2026-09-29T12:00:00.000Z', game_length_in_ms: 120_000, map: { id: 'ascent', name: 'Ascent' }, queue: { id: 'competitive', name: 'Competitive' } },
    players: [
      { puuid: 'target', name: 'ParityPlayer', tag: 'TW', team_id: 'Blue', agent: { id: 'jett', name: 'Jett' }, stats: { kills: 1, deaths: 1, assists: 0, score: 400, damage: { dealt: 300, received: 150 }, headshots: 1, bodyshots: 1, legshots: 0 } },
      { puuid: 'friend', name: 'PrivateFriend', tag: 'XX', team_id: 'Blue', agent: { id: 'sova', name: 'Sova' }, stats: { kills: 1, deaths: 0, assists: 1, score: 200, damage: { dealt: 150, received: 0 }, headshots: 0, bodyshots: 1, legshots: 0 } },
      { puuid: 'enemy', name: 'PrivateEnemy', tag: 'XX', team_id: 'Red', agent: { id: 'sage', name: 'Sage' }, stats: { kills: 1, deaths: 2, assists: 0, score: 200, damage: { dealt: 150, received: 300 }, headshots: 0, bodyshots: 1, legshots: 0 } },
    ],
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 1 } }, { team_id: 'Red', won: false, rounds: { won: 1, lost: 1 } }],
    rounds: [
      { id: 1, winning_team: 'Blue', result: 'Eliminated', plant: null, defuse: null, stats: [
        { player: { puuid: 'target' }, stats: { kills: 1, score: 250 }, economy: {} },
        { player: { puuid: 'friend' }, stats: { kills: 0, score: 0 }, economy: {} },
        { player: { puuid: 'enemy' }, stats: { kills: 0, score: 0 }, economy: {} },
      ] },
      { id: 2, winning_team: 'Blue', result: 'Eliminated', plant: null, defuse: null, stats: [
        { player: { puuid: 'target' }, stats: { kills: 0, score: 150 }, economy: {} },
        { player: { puuid: 'friend' }, stats: { kills: 1, score: 200 }, economy: {} },
        { player: { puuid: 'enemy' }, stats: { kills: 1, score: 200 }, economy: {} },
      ] },
    ],
    kills: [
      { round: 1, time_in_round_in_ms: 1000, killer: { puuid: 'target', team: 'Blue' }, victim: { puuid: 'enemy', team: 'Red' }, assistants: [], weapon: {}, player_locations: [] },
      { round: 2, time_in_round_in_ms: 1000, killer: { puuid: 'enemy', team: 'Red' }, victim: { puuid: 'target', team: 'Blue' }, assistants: [], weapon: {}, player_locations: [] },
      { round: 2, time_in_round_in_ms: 4000, killer: { puuid: 'friend', team: 'Blue' }, victim: { puuid: 'enemy', team: 'Red' }, assistants: [{ puuid: 'target', team: 'Blue' }], weapon: {}, player_locations: [] },
    ],
  }] };
}

describe('dataset runtime migrations', () => {
  it('projects opaque per-performance sides and preserves each correct team outcome', async () => {
    const database = await migratedDatabase();
    await seedProjection(database,2,1,1);
    await database.query("INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost) VALUES ($1,$2,'Red',false,0,1)",[uuid(7,999),uuid(5,1)]);
    await database.query("UPDATE match_participants SET team_key='Red' WHERE id=$1",[uuid(8,2)]);
    const result = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    expect(result.payload.schemaVersion).toBe(5);
    const match = result.payload.dataset.matches[0]!;
    expect(match.performances[0]).toMatchObject({teamGroup:'A',teamWon:true,teamRoundsWon:1,teamRoundsLost:0});
    expect(match.performances[1]).toMatchObject({teamGroup:'B',teamWon:false,teamRoundsWon:0,teamRoundsLost:1});
    expect(match.synergyEvidence).toBeUndefined();
    expect(result.metrics.sqlQueryCount).toBe(6);
  });

  it('projects only consenting direct trade directions from the existing event rule', async () => {
    const database = await migratedDatabase();
    await seedProjection(database,2,1,1);
    await database.query("UPDATE match_participants SET team_key='Red' WHERE id=$1",[uuid(8,3)]);
    await database.query('UPDATE kill_events SET killer_participant_id=$1,victim_participant_id=$2 WHERE id=$3',[uuid(8,3),uuid(8,1),uuid(13,1)]);
    await database.query(`INSERT INTO kill_events (id,source_match_id,round_id,event_lookup_hmac,event_sequence,time_in_round_ms,killer_participant_id,victim_participant_id)
      VALUES ($1,$2,$3,$4,1,4000,$5,$6)`,[uuid(13,2),uuid(5,1),uuid(9,1),lookup(60000),uuid(8,2),uuid(8,3)]);
    const result = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    expect(result.payload.dataset.matches[0]!.synergyEvidence).toEqual({ruleVersion:'event-metrics-v1',status:'reconstructed',reconstructedRounds:1,pairs:[[0,1,0,1]]});
    const serialized = JSON.stringify(result.payload);
    for (const privateValue of [uuid(8,1),uuid(8,2),uuid(8,3),lookup(60000)]) expect(serialized).not.toContain(privateValue);
    await database.query("UPDATE consents SET status='revoked',revoked_at=now() WHERE player_id=$1",[uuid(1,2)]);
    const revoked = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    expect(revoked.payload.dataset.matches[0]!.synergyEvidence).toBeUndefined();
    expect(revoked.payload.dataset.matches[0]!.performances[0]!.kast).toBe(1);
  });

  it('applies 0004 through 0006 on a fresh database, upgrades an existing database, and reruns without changing public ids', async () => {
    const fresh = await migratedDatabase();
    expect((await fresh.query<{ version: string }>("SELECT version FROM schema_migrations WHERE version='0004'")).rows).toEqual([{ version: '0004' }]);

    const existing = await migratedDatabase(3);
    await existing.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3)', [squadId, 'existing', 'Existing']);
    await existing.query(`INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,first_observed_at,last_observed_at)
      VALUES ($1,$2,'HenrikDev',$3,'v4','durable-evidence-v1','ap',now(),now())`, [uuid(5, 999), squadId, lookup(999)]);
    const all = await loadMigrations(migrationsPath);
    expect(await applyMigrations(existing, all)).toEqual(['0004', '0005', '0006', '0007', '0008']);
    const before = (await existing.query<{ public_id: string }>('SELECT public_id FROM source_matches')).rows[0]!.public_id;
    expect(before).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await applyMigrations(existing, all)).toEqual([]);
    expect((await existing.query<{ public_id: string }>('SELECT public_id FROM source_matches')).rows[0]!.public_id).toBe(before);
  }, 30_000);
});

describe('durable dataset projection privacy and compatibility', () => {
  it('returns one active player and one performance while omitting nine non-consenting identities', async () => {
    const database = await migratedDatabase();
    await seedProjection(database, 1, 1, 9);
    // TASK-IDENTITY-01: the public emoji is the member's.
    await database.query("UPDATE members SET default_emoji='not-an-emoji' WHERE id=$1", [uuid(1, 1)]);
    const result = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    expect(result.payload.dataset.players).toHaveLength(1);
    expect(result.payload.dataset.players[0]!.defaultEmoji).toBe('🤖');
    expect(result.payload.dataset.matches).toHaveLength(1);
    expect(result.payload.dataset.matches[0]!.performances).toHaveLength(1);
    const serialized = JSON.stringify(result.payload).toLowerCase();
    expect(serialized).not.toContain('henrikdev');
    expect(serialized).not.toContain(lookup(10_001));
    expect(serialized).not.toContain(uuid(8, 1));
    expect(serialized).not.toContain('puuid');
    expect(serialized).not.toContain('hmac');
    const keys = objectKeys(result.payload);
    for (const forbidden of [
      'puuid', 'provider_match_lookup_hmac', 'participant_lookup_hmac', 'event_lookup_hmac',
      'management_credential_hmac', 'internal_player_id', 'internal_match_id', 'source_match_id',
      'DATABASE_URL', 'IDENTIFIER_HMAC_KEY', 'HENRIK_API_KEY',
    ]) expect(keys).not.toContain(forbidden);
  });

  it('hides an old-policy player and every match visible solely through that player', async () => {
    const database = await migratedDatabase();
    await seedProjection(database, 1, 1);
    await database.query("UPDATE consents SET privacy_version='old-private-v1' WHERE status='active'");
    const result = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    expect(result.payload.state).toBe('empty');
    expect(result.payload.dataset.players).toEqual([]);
    expect(result.payload.dataset.matches).toEqual([]);
  });

  it('returns two active members once in a shared match and removes a revoked member from the projection', async () => {
    const database = await migratedDatabase();
    await seedProjection(database, 2, 1);
    const service = new DatasetProjectionService(new PostgresDatasetReadRepository(database));
    const shared = await service.read();
    expect(shared.payload.dataset.players).toHaveLength(2);
    expect(shared.payload.dataset.matches).toHaveLength(1);
    expect(shared.payload.dataset.matches[0]!.performances).toHaveLength(2);
    await database.query("UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id=$1", [uuid(1, 2)]);
    await database.query("UPDATE squad_memberships SET status='inactive', left_at=now() WHERE player_id=$1", [uuid(1, 2)]);
    const revoked = await service.read();
    expect(revoked.payload.dataset.players.map((player) => player.displayName)).toEqual(['Player1']);
    expect(revoked.payload.dataset.matches[0]!.performances).toHaveLength(1);
    expect(JSON.stringify(revoked.payload)).not.toContain('Player2');
  });

  it('matches the legacy normalizer for the explicitly supported projection metrics', async () => {
    const database = await migratedDatabase();
    const durable = new DurableEvidenceService(database, hmacKey);
    const connection = {
      gameName: 'ParityPlayer', tag: 'TW', affinity: 'ap' as const, consent: true as const,
      privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION,
    };
    const connected = await durable.persistConnection(connection, 'target');
    const input: MatchImportInput = { ...connection, playerId: connected.publicPlayerId!, limit: 1 };
    await durable.persistMatches(input, parityPayload());
    const legacy = normalizeHenrikMatches(parityPayload(), input).matches[0]!;
    const projected = (await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read()).payload.dataset.matches[0]!;
    expect(projected).toMatchObject({ map: legacy.map, gameMode: legacy.gameMode, scoreFor: legacy.scoreFor, scoreAgainst: legacy.scoreAgainst, won: legacy.won, durationMinutes: legacy.durationMinutes });
    expect(projected.performances[0]).toMatchObject({
      kills: legacy.performances[0]!.kills,
      deaths: legacy.performances[0]!.deaths,
      assists: legacy.performances[0]!.assists,
      acs: legacy.performances[0]!.acs,
      adr: legacy.performances[0]!.adr,
      kast: legacy.performances[0]!.kast,
      headshotPercentage: legacy.performances[0]!.headshotPercentage,
      firstKills: legacy.performances[0]!.firstKills,
      firstDeaths: legacy.performances[0]!.firstDeaths,
      advancedMetrics: {
        ruleVersion: 'event-metrics-v1',
        evidence: { trade: 'reconstructed', clutch: 'reconstructed' },
        trade: { tradedDeaths: 1 },
      },
    });
    expect(projected.id).not.toBe(legacy.id);
    expect(projected.performances[0]!.playerId).not.toBe(legacy.performances[0]!.playerId);
  });

  it('omits a performance and match when round presence is incomplete', async () => {
    const database = await migratedDatabase();
    await seedProjection(database, 1, 1);
    const service = new DatasetProjectionService(new PostgresDatasetReadRepository(database));
    const completeSnapshot = (await service.read()).payload.snapshot.version;
    await database.query(
      'INSERT INTO rounds (id,source_match_id,round_number,plant_status,defuse_status) VALUES ($1,$2,2,$3,$4)',
      [uuid(11, 1), uuid(5, 1), 'missing', 'missing'],
    );

    const result = await service.read();
    expect(result.payload.dataset.players).toHaveLength(1);
    expect(result.payload.dataset.matches).toEqual([]);
    expect(result.payload.state).toBe('empty');
    expect(result.payload.evidence).toMatchObject({ kast: 'partial', firstKills: 'partial', firstDeaths: 'partial' });
    expect(result.payload.snapshot.version).not.toBe(completeSnapshot);
  });

  it('omits combat stats when there are no durable round rows', async () => {
    const database = await migratedDatabase();
    await seedProjection(database, 1, 1);
    await database.query('DELETE FROM rounds WHERE source_match_id=$1', [uuid(5, 1)]);

    const result = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    expect(result.payload.state).toBe('empty');
    expect(result.payload.dataset.matches).toEqual([]);
    expect(JSON.stringify(result.payload.dataset)).not.toMatch(/"(?:acs|adr|kast)":0/iu);
  });

  it('omits a performance when a required combat aggregate is missing', async () => {
    const database = await migratedDatabase();
    await seedProjection(database, 1, 1);
    await database.query('UPDATE match_participants SET score=NULL WHERE id=$1', [uuid(8, 1)]);

    const result = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    expect(result.payload.state).toBe('empty');
    expect(result.payload.dataset.matches).toEqual([]);
  });

  it('keeps a shared match with only its complete consenting performance', async () => {
    const database = await migratedDatabase();
    await seedProjection(database, 2, 1);
    await database.query(
      'INSERT INTO rounds (id,source_match_id,round_number,participants_evidence_status,plant_status,defuse_status) VALUES ($1,$2,2,$3,$4,$5)',
      [uuid(11, 2), uuid(5, 1), 'observed', 'missing', 'missing'],
    );
    await database.query(
      `INSERT INTO round_participants
        (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status)
       VALUES ($1,$2,$3,'observed','missing','missing','missing')`,
      [uuid(12, 1), uuid(11, 2), uuid(8, 1)],
    );

    const result = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    expect(result.payload.dataset.players).toHaveLength(2);
    expect(result.payload.dataset.matches).toHaveLength(1);
    expect(result.payload.dataset.matches[0]!.performances).toEqual([
      expect.objectContaining({ playerId: uuid(2, 1) }),
    ]);
    expect(result.payload.evidence).toMatchObject({ kast: 'partial', firstKills: 'partial', firstDeaths: 'partial' });
  });

  it('preserves legitimate observed zero values with complete evidence', async () => {
    const database = await migratedDatabase();
    await seedProjection(database, 1, 1, 1);
    await database.query(
      `UPDATE match_participants SET kills=0,deaths=1,assists=0,score=0,damage_dealt=0,
        headshots=0,bodyshots=0,legshots=0 WHERE id=$1`,
      [uuid(8, 1)],
    );
    await database.query("UPDATE match_participants SET team_key='Red' WHERE id=$1", [uuid(8, 2)]);
    await database.query('DELETE FROM kill_events WHERE source_match_id=$1', [uuid(5, 1)]);
    await database.query(
      `INSERT INTO kill_events
        (id,source_match_id,round_id,event_lookup_hmac,event_sequence,time_in_round_ms,killer_participant_id,victim_participant_id)
       VALUES ($1,$2,$3,$4,0,1000,$5,$6)`,
      [uuid(13, 1), uuid(5, 1), uuid(9, 1), lookup(50_001), uuid(8, 2), uuid(8, 1)],
    );

    const performance = (await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read())
      .payload.dataset.matches[0]!.performances[0]!;
    expect(performance).toMatchObject({
      kills: 0,
      assists: 0,
      acs: 0,
      adr: 0,
      kast: 0,
      headshotPercentage: 0,
      firstKills: 0,
      firstDeaths: 1,
    });
  });

  it('omits HS percentage instead of converting a missing shot count to zero', async () => {
    const database = await migratedDatabase();
    await seedProjection(database, 1, 1);
    await database.query('UPDATE match_participants SET headshots=NULL WHERE id=$1', [uuid(8, 1)]);

    const result = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    const performance = result.payload.dataset.matches[0]!.performances[0]!;
    expect(performance).not.toHaveProperty('headshotPercentage');
    expect(result.payload.evidence.headshotPercentage).toBe('partial');
  });
});

describe('bounded projection performance', () => {
  it.each([[1, 30], [4, 300]])('uses six set-based queries for %i players and %i matches', async (players, matches) => {
    const database = await migratedDatabase();
    await seedProjection(database, players, matches, 1);
    const result = await new DatasetProjectionService(new PostgresDatasetReadRepository(database)).read();
    expect(result.payload.dataset.matches).toHaveLength(matches);
    expect(result.payload.dataset.players).toHaveLength(players);
    expect(result.metrics.sqlQueryCount).toBe(6);
    expect(result.metrics.databaseMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.projectionMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.serializedBytes).toBeGreaterThan(0);
    expect(result.metrics.eventCount).toBe(matches);
    const pairStarted = performance.now();
    const pairs = buildSynergy(result.payload.dataset);
    const pairMs = performance.now() - pairStarted;
    expect(pairs.length).toBe(players * (players - 1) / 2);
    expect(result.metrics.serializedBytes).toBeLessThan(players === 1 ? 30000 : 950000);
    process.stdout.write(`SYNERGY_PERFORMANCE ${players}p/${matches}m ${JSON.stringify({pairMs,observedPairs:pairs.length,pairMatchRecords:result.payload.dataset.matches.reduce((n,m)=>n+(m.synergyEvidence?.pairs.length??0),0)})}\n`);
    process.stdout.write(`DATASET_PERFORMANCE ${players}p/${matches}m ${JSON.stringify(result.metrics)}\n`);
  }, 30_000);
});

describe('dataset read gate', () => {
  it.each([undefined, '', 'enabled', 'true', '1', 'PUBLIC', 'typo'])(
    'fails closed unless mode is exact public: %s',
    (value) => {
      const previous = process.env.REAL_DATASET_READ_MODE;
      try {
        if (value === undefined) delete process.env.REAL_DATASET_READ_MODE;
        else process.env.REAL_DATASET_READ_MODE = value;
        expect(datasetReadMode()).toBe('disabled');
        process.env.REAL_DATASET_READ_MODE = 'public';
        expect(datasetReadMode()).toBe('public');
      } finally {
        if (previous === undefined) delete process.env.REAL_DATASET_READ_MODE;
        else process.env.REAL_DATASET_READ_MODE = previous;
      }
    },
  );

  it('fails closed with no private counts while exposure is disabled', async () => {
    const previous = process.env.REAL_DATASET_READ_MODE;
    delete process.env.REAL_DATASET_READ_MODE;
    let status = 0;
    let body: unknown;
    const headers = new Map<string, string>();
    const response: ApiResponse = {
      status(code) { status = code; return this; },
      json(value) { body = value; },
      setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    };
    const request: ApiRequest = { method: 'GET', headers: {}, socket: { remoteAddress: 'dataset-test' } };
    try {
      await datasetHandler(request, response);
    } finally {
      if (previous === undefined) delete process.env.REAL_DATASET_READ_MODE;
      else process.env.REAL_DATASET_READ_MODE = previous;
    }
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, schemaVersion: 5, state: 'disabled', source: 'REAL_SERVER' });
    expect(JSON.stringify(body)).not.toMatch(/player|match|count/iu);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(request.headers).toEqual({});
  });
});
