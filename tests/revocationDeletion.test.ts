import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateAnalysisFacts } from '../server/dataset/analysisFactHydration';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { RevocationDeletionService } from '../server/deletion/revocationDeletionService';
import { DeletionRetentionService } from '../server/deletion/retentionService';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { PostgresSyncStore } from '../server/sync/postgresSyncStore';
import { HistoricalSyncService } from '../server/sync/historicalSyncService';
import { HenrikDataProvider, type HistoricalMatchProvider } from '../server/henrikDataProvider';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';

const hmacKey = 'test-revocation-key-with-at-least-thirty-two-bytes';
const connection = {
  gameName: 'DeleteGoblin', tag: 'TW', affinity: 'ap', consent: true,
  privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION,
} as const;

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

class FailingDeletionDatabase implements SqlDatabase {
  constructor(private readonly database: SqlDatabase) {}
  query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    return this.database.query<Row>(sql, params);
  }
  transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) => work({
      query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
        if (sql.includes('exclusive_matches_removed=exclusive_matches_removed')) throw new Error('forced deletion checkpoint failure');
        return transaction.query<Row>(sql, params);
      },
    }));
  }
  close(): Promise<void> { return Promise.resolve(); }
}

async function count(database: SqlDatabase, table: string, where = 'true'): Promise<number> {
  const result = await database.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE ${where}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function internalPlayerId(database: SqlDatabase, publicId: string): Promise<string> {
  const result = await database.query<{ id: string }>('SELECT id FROM players WHERE public_id=$1', [publicId]);
  return result.rows[0]!.id;
}

async function seedMatch(database: SqlDatabase, targetPlayerId: string, otherPlayerId?: string): Promise<string> {
  const sourceId = randomUUID();
  const targetParticipant = randomUUID();
  const otherParticipant = randomUUID();
  const roundId = randomUUID();
  const killId = randomUUID();
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO source_matches (
         id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,
         affinity,first_observed_at,last_observed_at
       ) VALUES ($1,'00000000-0000-4000-8000-000000000001','HenrikDev',$2,'v4','test','ap',now(),now())`,
      [sourceId, randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64)],
    );
    await transaction.query(
      `INSERT INTO match_participants (
         id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_id,agent_name,stats_evidence_status,
         kills,deaths,assists,score,damage_dealt,damage_received,headshots,bodyshots,legshots,
         ability_1_casts,loadout_value_total,spent_total
       ) VALUES ($1,$2,$3,$4,'Blue','agent','Jett','observed',20,10,5,5000,3000,1500,10,20,0,4,3900,3000)`,
      [targetParticipant, sourceId, targetPlayerId, randomUUID().replaceAll('-', '').padEnd(64, 'b').slice(0, 64)],
    );
    await transaction.query(
      `INSERT INTO match_participants (
         id,source_match_id,player_id,participant_lookup_hmac,team_key,stats_evidence_status
       ) VALUES ($1,$2,$3,$4,'Red','observed')`,
      [otherParticipant, sourceId, otherPlayerId ?? null, randomUUID().replaceAll('-', '').padEnd(64, 'c').slice(0, 64)],
    );
    await transaction.query(
      `INSERT INTO rounds (id,source_match_id,round_number,plant_status,defuse_status)
       VALUES ($1,$2,1,'absent','absent')`, [roundId, sourceId],
    );
    await transaction.query(
      `INSERT INTO round_participants (
         id,round_id,match_participant_id,stats_evidence_status,kills,score,
         loadout_evidence_status,loadout_value,remaining_credits,weapon_evidence_status,weapon_id,weapon_name,
         armor_evidence_status,armor_id,armor_name
       ) VALUES ($1,$2,$3,'observed',1,300,'observed',3900,100,'observed','weapon','Vandal','observed','armor','Heavy')`,
      [randomUUID(), roundId, targetParticipant],
    );
    await transaction.query(
      `INSERT INTO kill_events (
         id,source_match_id,round_id,event_lookup_hmac,event_sequence,time_in_round_ms,
         killer_participant_id,victim_participant_id,weapon_id,weapon_name,location_x,location_y
       ) VALUES ($1,$2,$3,$4,1,10000,$5,$6,'weapon','Vandal',10,20)`,
      [killId, sourceId, roundId, randomUUID().replaceAll('-', '').padEnd(64, 'd').slice(0, 64), targetParticipant, otherParticipant],
    );
    await transaction.query(
      `INSERT INTO event_player_locations (kill_event_id,match_participant_id,location_x,location_y)
       VALUES ($1,$2,10,20)`, [killId, targetParticipant],
    );
  });
  return sourceId;
}

/**
 * position-evidence-v1 (migration 0012) shared match: the revoking participant T plants round 1 and defuses round 2;
 * the retained participant O defuses round 1 and plants round 2; an untracked participant U is killed by O. Every
 * coordinate is a distinctive synthetic value so residue is detectable.
 */
async function seedSpatialSharedMatch(database: SqlDatabase, targetPlayerId: string, otherPlayerId: string) {
  const ids = { source: randomUUID(), target: randomUUID(), other: randomUUID(), untracked: randomUUID(), round1: randomUUID(), round2: randomUUID(),
    killByTarget: randomUUID(), killByOther: randomUUID() };
  const hex = (c: string) => randomUUID().replaceAll('-', '').padEnd(64, c).slice(0, 64);
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,
         affinity,first_observed_at,last_observed_at,position_evidence_version)
       VALUES ($1,'00000000-0000-4000-8000-000000000001','HenrikDev',$2,'v4','test','ap',now(),now(),'position-evidence-v1')`, [ids.source, hex('a')]);
    for (const [id, player, team] of [[ids.target, targetPlayerId, 'Blue'], [ids.other, otherPlayerId, 'Red'], [ids.untracked, null, 'Blue']] as const) {
      await transaction.query(
        `INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths)
         VALUES ($1,$2,$3,$4,$5,'Jett','observed',7,3)`, [id, ids.source, player, hex('b'), team]);
    }
    await transaction.query(
      `INSERT INTO rounds (id,source_match_id,round_number,plant_status,plant_participant_id,plant_time_ms,plant_site,plant_location_x,plant_location_y,
         defuse_status,defuse_participant_id,defuse_time_ms,defuse_location_x,defuse_location_y,winning_team_role,attacking_team_key,side_source)
       VALUES ($1,$2,1,'present',$3,30000,'A',7101,7102,'present',$4,60000,4201,4202,'Defender','Blue','plant'),
              ($5,$2,2,'present',$4,31000,'B',4301,4302,'present',$3,61000,7201,7202,'Defender','Red','plant')`,
      [ids.round1, ids.source, ids.target, ids.other, ids.round2]);
    await transaction.query(
      `INSERT INTO kill_events (id,source_match_id,round_id,event_lookup_hmac,event_sequence,time_in_round_ms,killer_participant_id,victim_participant_id,
         weapon_id,weapon_name,location_x,location_y)
       VALUES ($1,$2,$3,$4,1,10000,$5,$6,'weapon','Vandal',7301,7302), ($7,$2,$8,$9,2,12000,$6,$10,'weapon','Phantom',4401,4402)`,
      [ids.killByTarget, ids.source, ids.round1, hex('d'), ids.target, ids.other, ids.killByOther, ids.round2, hex('e'), ids.untracked]);
    await transaction.query(
      `INSERT INTO event_player_locations (kill_event_id,match_participant_id,location_x,location_y,view_radians)
       VALUES ($1,$2,7401,7402,1.25), ($1,$3,4501,4502,2.5)`, [ids.killByOther, ids.target, ids.other]);
  });
  return ids;
}

/** Every precise coordinate still attributable to `participant` (snapshots, kill events it took part in, its plants and defuses). */
async function spatialResidue(database: SqlDatabase, participant: string) {
  const one = async (sql: string) => Number((await database.query<{ n: string }>(sql, [participant])).rows[0]!.n);
  return {
    snapshots: await one('SELECT count(*)::text AS n FROM event_player_locations WHERE match_participant_id=$1'),
    killPositions: await one(`SELECT count(*)::text AS n FROM kill_events WHERE (killer_participant_id=$1 OR victim_participant_id=$1)
      AND (location_x IS NOT NULL OR location_y IS NOT NULL)`),
    plantPositions: await one('SELECT count(*)::text AS n FROM rounds WHERE plant_participant_id=$1 AND (plant_location_x IS NOT NULL OR plant_location_y IS NOT NULL)'),
    defusePositions: await one('SELECT count(*)::text AS n FROM rounds WHERE defuse_participant_id=$1 AND (defuse_location_x IS NOT NULL OR defuse_location_y IS NOT NULL)'),
  };
}
const NO_RESIDUE = { snapshots: 0, killPositions: 0, plantPositions: 0, defusePositions: 0 };

describe('consent revocation and durable deletion', () => {
  let database: PGliteDatabase;
  let durable: DurableEvidenceService;
  let service: RevocationDeletionService;
  let publicPlayerId: string;
  let playerId: string;
  let managementCredential: string;

  beforeEach(async () => {
    database = new PGliteDatabase(new PGlite());
    await applyMigrations(database, await loadMigrations('migrations'));
    durable = new DurableEvidenceService(database, hmacKey);
    const connected = await durable.persistConnection(connection, 'revocation-player-puuid', '2026-09-30T00:00:00.000Z');
    publicPlayerId = connected.publicPlayerId!;
    managementCredential = connected.managementCredential!;
    playerId = await internalPlayerId(database, publicPlayerId);
    service = new RevocationDeletionService(database, hmacKey, () => new Date('2026-09-30T01:00:00.000Z'));
  });

  afterEach(async () => { await database.close(); });

  it('issues a high-entropy credential only once and never silently upgrades a legacy active consent', async () => {
    expect(managementCredential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const again = await durable.persistConnection(connection, 'revocation-player-puuid', '2026-09-30T00:05:00.000Z');
    expect(again.managementCredential).toBeUndefined();
    await database.query(`UPDATE consents SET management_credential_hmac=NULL, management_credential_version=NULL, management_credential_issued_at=NULL`);
    const legacy = await durable.persistConnection(connection, 'revocation-player-puuid', '2026-09-30T00:10:00.000Z');
    expect(legacy.managementCredential).toBeUndefined();
    await expect(service.revoke(publicPlayerId, managementCredential)).rejects.toMatchObject({ code: 'MANAGEMENT_CREDENTIAL_REQUIRED' });
  });

  it('rejects public-id-only and invalid-credential revocation without changing consent', async () => {
    await expect(service.revoke(publicPlayerId, 'A'.repeat(43))).rejects.toMatchObject({ code: 'REVOCATION_FORBIDDEN' });
    expect(await count(database, 'consents', `status='active'`)).toBe(1);
    expect(await count(database, 'deletion_jobs')).toBe(0);
  });

  it('atomically revokes consent, deactivates membership, cancels paused/running sync, and releases leases', async () => {
    const store = new PostgresSyncStore(database);
    const subject = await store.findSubject(publicPlayerId);
    const lease = await store.acquireCursorLease(subject!, 'backfill', '2026-09-30T00:00:00.000Z', '2026-09-30T02:00:00.000Z');
    await store.createRun(subject!, 'backfill', 0, '2026-09-30T00:00:00.000Z');
    const revoked = await service.revoke(publicPlayerId, managementCredential);
    expect(revoked).toMatchObject({ status: 'pending', stage: 'cancel_sync' });
    expect(await count(database, 'consents', `status='active'`)).toBe(0);
    expect(await count(database, 'squad_memberships', `status='active'`)).toBe(0);
    expect(await count(database, 'sync_runs', `status='cancelled'`)).toBe(1);
    const cursor = await database.query<{ lease_token: string | null }>('SELECT lease_token FROM sync_cursors WHERE id=$1', [lease!.cursor.id]);
    expect(cursor.rows[0]?.lease_token).toBeNull();
  });

  it('deletes one or many exclusive matches and both zero/nonzero rank histories', async () => {
    await seedMatch(database, playerId);
    await seedMatch(database, playerId);
    await database.query(
      `INSERT INTO rank_observations (id,player_id,provider,observed_at,tier_id,rr)
       VALUES ($1,$2,'HenrikDev','2026-09-29T00:00:00Z',0,0),($3,$2,'HenrikDev','2026-09-30T00:00:00Z',20,75)`,
      [randomUUID(), playerId, randomUUID()],
    );
    const pending = await service.revoke(publicPlayerId, managementCredential);
    const complete = await service.continue(pending.jobId, managementCredential);
    expect(complete).toMatchObject({ status: 'complete', progress: { rankRowsRemoved: 2, exclusiveMatchesRemoved: 2 } });
    expect(await count(database, 'source_matches')).toBe(0);
    expect(await count(database, 'rank_observations')).toBe(0);
  });

  it('anonymizes a shared match while preserving referential event topology for the active player', async () => {
    const other = await durable.persistConnection({ ...connection, gameName: 'OtherGoblin' }, 'other-player-puuid');
    const otherId = await internalPlayerId(database, other.publicPlayerId!);
    const sourceId = await seedMatch(database, playerId, otherId);
    const before = await database.query<{ participant_lookup_hmac: string }>(
      'SELECT participant_lookup_hmac FROM match_participants WHERE source_match_id=$1 AND player_id=$2', [sourceId, playerId],
    );
    const eventBefore = await database.query<{ event_lookup_hmac: string }>(
      'SELECT event_lookup_hmac FROM kill_events WHERE source_match_id=$1', [sourceId],
    );
    const pending = await service.revoke(publicPlayerId, managementCredential);
    const complete = await service.continue(pending.jobId, managementCredential);
    expect(complete).toMatchObject({ status: 'complete', progress: { sharedMatchesAnonymized: 1, participantsAnonymized: 1 } });
    expect(await count(database, 'source_matches', `id='${sourceId}'`)).toBe(1);
    expect(await count(database, 'kill_events', `source_match_id='${sourceId}'`)).toBe(1);
    const target = await database.query<{
      player_id: string | null; participant_lookup_hmac: string; agent_name: string | null; kills: number | null;
    }>('SELECT player_id,participant_lookup_hmac,agent_name,kills FROM match_participants WHERE source_match_id=$1 AND player_id IS NULL ORDER BY id LIMIT 1', [sourceId]);
    expect(target.rows[0]).toMatchObject({ player_id: null, agent_name: null, kills: null });
    expect(target.rows[0]?.participant_lookup_hmac).not.toBe(before.rows[0]?.participant_lookup_hmac);
    expect(await count(database, 'event_player_locations')).toBe(0);
    const event = await database.query<{ event_lookup_hmac: string; weapon_name: string | null; location_x: number | null }>('SELECT event_lookup_hmac,weapon_name,location_x FROM kill_events WHERE source_match_id=$1', [sourceId]);
    expect(event.rows[0]).toMatchObject({ weapon_name: null, location_x: null });
    expect(event.rows[0]?.event_lookup_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(event.rows[0]?.event_lookup_hmac).not.toBe(eventBefore.rows[0]?.event_lookup_hmac);
    await expect(service.continue(pending.jobId, managementCredential)).resolves.toMatchObject({ status: 'complete' });
    const eventAfterRetry = await database.query<{ event_lookup_hmac: string }>(
      'SELECT event_lookup_hmac FROM kill_events WHERE source_match_id=$1', [sourceId],
    );
    expect(eventAfterRetry.rows[0]?.event_lookup_hmac).toBe(event.rows[0]?.event_lookup_hmac);
  });

  describe('position-evidence-v1 spatial telemetry in a retained shared match', () => {
    async function revokeTarget() {
      const other = await durable.persistConnection({ ...connection, gameName: 'OtherGoblin' }, 'other-player-puuid');
      const otherId = await internalPlayerId(database, other.publicPlayerId!);
      const ids = await seedSpatialSharedMatch(database, playerId, otherId);
      const pending = await service.revoke(publicPlayerId, managementCredential);
      const complete = await service.continue(pending.jobId, managementCredential);
      return { ids, otherId, pending, complete };
    }

    it('erases every coordinate attributable to the revoked planter / defuser (snapshots with view, kills, plants, defuses)', async () => {
      const { ids, complete } = await revokeTarget();
      expect(complete).toMatchObject({ status: 'complete', progress: { sharedMatchesAnonymized: 1, participantsAnonymized: 1 } });
      expect(await spatialResidue(database, ids.target)).toEqual(NO_RESIDUE);
      expect(await count(database, 'event_player_locations', 'view_radians=1.25')).toBe(0);
    });

    it('keeps the shared match, its round topology and site / side labels, and the retained participant evidence', async () => {
      const { ids, otherId } = await revokeTarget();
      expect(await count(database, 'source_matches', `id='${ids.source}'`)).toBe(1);
      const rounds = await database.query<Record<string, unknown>>(
        `SELECT round_number, plant_status, plant_site, plant_time_ms, defuse_status, defuse_time_ms, winning_team_role, attacking_team_key, side_source,
           plant_participant_id IS NOT NULL AS has_planter, defuse_participant_id IS NOT NULL AS has_defuser,
           plant_location_x::text AS plant_x, plant_location_y::text AS plant_y, defuse_location_x::text AS defuse_x, defuse_location_y::text AS defuse_y
         FROM rounds WHERE source_match_id=$1 ORDER BY round_number`, [ids.source]);
      expect(rounds.rows).toEqual([
        { round_number: 1, plant_status: 'present', plant_site: 'A', plant_time_ms: 30000, defuse_status: 'present', defuse_time_ms: 60000,
          winning_team_role: 'Defender', attacking_team_key: 'Blue', side_source: 'plant', has_planter: true, has_defuser: true,
          plant_x: null, plant_y: null, defuse_x: '4201', defuse_y: '4202' },
        { round_number: 2, plant_status: 'present', plant_site: 'B', plant_time_ms: 31000, defuse_status: 'present', defuse_time_ms: 61000,
          winning_team_role: 'Defender', attacking_team_key: 'Red', side_source: 'plant', has_planter: true, has_defuser: true,
          plant_x: '4301', plant_y: '4302', defuse_x: null, defuse_y: null },
      ]);
      // The planter / defuser references now point only at the anonymized participant row (random lookup HMAC, no player).
      const anonymized = await database.query<{ player_id: string | null }>('SELECT player_id FROM match_participants WHERE id=$1', [ids.target]);
      expect(anonymized.rows[0]).toEqual({ player_id: null });
      // Retained participant: identity, stats, own snapshot (with view) and the kill it took against an untracked player.
      const retained = await database.query<Record<string, unknown>>('SELECT player_id, kills, deaths, agent_name FROM match_participants WHERE id=$1', [ids.other]);
      expect(retained.rows[0]).toEqual({ player_id: otherId, kills: 7, deaths: 3, agent_name: 'Jett' });
      const otherSnapshot = await database.query<Record<string, unknown>>(
        'SELECT location_x::text AS x, location_y::text AS y, view_radians::text AS view FROM event_player_locations WHERE match_participant_id=$1', [ids.other]);
      expect(otherSnapshot.rows).toEqual([{ x: '4501', y: '4502', view: '2.5' }]);
      const otherKill = await database.query<Record<string, unknown>>('SELECT location_x::text AS x, weapon_name FROM kill_events WHERE id=$1', [ids.killByOther]);
      expect(otherKill.rows[0]).toEqual({ x: '4401', weapon_name: 'Phantom' });
      expect(await count(database, 'kill_events', `source_match_id='${ids.source}'`)).toBe(2);
    });

    it('is idempotent: a repeated continue and a repeated revoke attempt resurrect nothing and change nothing', async () => {
      const { ids, pending, complete } = await revokeTarget();
      const snapshot = async () => JSON.stringify((await database.query(
        `SELECT r.round_number, r.plant_location_x::text, r.defuse_location_x::text, r.plant_participant_id, r.defuse_participant_id
         FROM rounds r WHERE r.source_match_id=$1 ORDER BY r.round_number`, [ids.source])).rows);
      const before = await snapshot();
      await expect(service.continue(pending.jobId, managementCredential)).resolves.toEqual(complete);
      const again = await service.revoke(publicPlayerId, managementCredential); // returns the existing job
      expect(again.jobId).toBe(pending.jobId);
      await expect(service.continue(again.jobId, managementCredential)).resolves.toMatchObject({ status: 'complete' });
      expect(await snapshot()).toBe(before);
      expect(await spatialResidue(database, ids.target)).toEqual(NO_RESIDUE);
    });

    it('a later analysis-fact rebuild from the application database cannot recreate revoked telemetry', async () => {
      const { ids } = await revokeTarget();
      await hydrateAnalysisFacts(database);
      expect(await count(database, 'analysis_participant_facts', `match_participant_id='${ids.target}'`)).toBe(0);
      expect(await spatialResidue(database, ids.target)).toEqual(NO_RESIDUE);
    });
  });

  it('is resumable after a bounded pause, recovers a stale lease, and is idempotent after completion', async () => {
    await seedMatch(database, playerId);
    const pending = await service.revoke(publicPlayerId, managementCredential);
    const paused = await service.continue(pending.jobId, managementCredential, 0);
    expect(paused.status).toBe('paused');
    await database.query(
      `UPDATE deletion_jobs SET lease_token=$2, lease_expires_at='2026-09-30T00:59:59Z' WHERE public_id=$1`,
      [pending.jobId, randomUUID()],
    );
    const complete = await service.continue(pending.jobId, managementCredential);
    expect(complete.status).toBe('complete');
    expect(await service.continue(pending.jobId, managementCredential)).toEqual(complete);
    expect(await service.revoke(publicPlayerId, managementCredential)).toEqual(complete);
  });

  it('removes provider identity and PII, retains only a tombstone plus privacy-safe aggregate audit', async () => {
    const pending = await service.revoke(publicPlayerId, managementCredential);
    const complete = await service.continue(pending.jobId, managementCredential);
    expect(complete.status).toBe('complete');
    expect(await count(database, 'provider_identities')).toBe(0);
    expect(await count(database, 'consents')).toBe(0);
    const player = await database.query<{ display_name: string; display_tag: string; anonymized_at: Date | null }>(
      'SELECT display_name,display_tag,anonymized_at FROM players WHERE id=$1', [playerId],
    );
    expect(player.rows[0]).toMatchObject({ display_name: '已刪除玩家', display_tag: 'deleted' });
    expect(player.rows[0]?.anonymized_at).not.toBeNull();
    expect(JSON.stringify(complete)).not.toContain(publicPlayerId);
    expect(JSON.stringify(complete)).not.toContain(managementCredential);
  });

  it('treats re-consent after completed deletion as a new unlinked identity', async () => {
    const pending = await service.revoke(publicPlayerId, managementCredential);
    await service.continue(pending.jobId, managementCredential);
    const reconnected = await durable.persistConnection(connection, 'revocation-player-puuid', '2026-10-01T00:00:00.000Z');
    expect(reconnected.publicPlayerId).not.toBe(publicPlayerId);
    expect(reconnected.managementCredential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await count(database, 'players')).toBe(2);
  });

  it('makes revocation win a provider-fetch race without cursor advance or cancellation overwrite', async () => {
    let releaseProvider: (() => void) | undefined;
    let providerStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const provider: HistoricalMatchProvider = {
      async fetchHistoryPage() {
        providerStarted?.();
        await new Promise<void>((resolve) => { releaseProvider = resolve; });
        return { status: 200, data: [] };
      },
    };
    const store = new PostgresSyncStore(database);
    const sync = new HistoricalSyncService(store, durable, provider, hmacKey);
    const running = sync.start(publicPlayerId, 'backfill');
    await started;
    const deletion = await service.revoke(publicPlayerId, managementCredential);
    releaseProvider?.();
    await expect(running).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    const run = await database.query<{ status: string; page_count: number }>('SELECT status,page_count FROM sync_runs LIMIT 1');
    expect(run.rows[0]).toMatchObject({ status: 'cancelled', page_count: 0 });
    await service.continue(deletion.jobId, managementCredential);
  });

  it('blocks manual import before any post-revocation provider request', async () => {
    let calls = 0;
    await service.revoke(publicPlayerId, managementCredential);
    const provider = new HenrikDataProvider('configured', {
      durableWriter: durable,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ status: 200, data: [] }), { status: 200 });
      },
    });
    await expect(provider.importMatches({ ...connection, playerId: publicPlayerId, limit: 1 })).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(calls).toBe(0);
  });

  it('blocks reconnect before provider access until deletion completes', async () => {
    let calls = 0;
    const pending = await service.revoke(publicPlayerId, managementCredential);
    const provider = new HenrikDataProvider('configured', {
      durableWriter: durable,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ status: 200, data: { name: connection.gameName, tag: connection.tag, puuid: 'same' } }), { status: 200 });
      },
    });
    await expect(provider.resolveAccount(connection)).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(calls).toBe(0);
    await service.continue(pending.jobId, managementCredential);
    await expect(provider.resolveAccount(connection)).resolves.toMatchObject({ account: { gameName: connection.gameName } });
    expect(calls).toBe(1);
  });

  it('rolls back a deletion batch on worker failure and resumes without partial child deletion', async () => {
    await seedMatch(database, playerId);
    const pending = await service.revoke(publicPlayerId, managementCredential);
    const failing = new RevocationDeletionService(
      new FailingDeletionDatabase(database), hmacKey, () => new Date('2026-09-30T01:00:00.000Z'),
    );
    await expect(failing.continue(pending.jobId, managementCredential)).rejects.toThrow('forced deletion checkpoint failure');
    expect(await count(database, 'source_matches')).toBe(1);
    expect((await service.status(pending.jobId, managementCredential)).status).toBe('paused');
    await expect(service.continue(pending.jobId, managementCredential)).resolves.toMatchObject({ status: 'complete' });
    expect(await count(database, 'source_matches')).toBe(0);
  });

  it('purges expired aggregate deletion audit and its unreferenced player tombstone in a bounded batch', async () => {
    const pending = await service.revoke(publicPlayerId, managementCredential);
    await service.continue(pending.jobId, managementCredential);
    const retention = new DeletionRetentionService(database);
    expect(await retention.purgeExpired('2026-10-01T00:00:00.000Z')).toEqual({ jobsRemoved: 0, playerTombstonesRemoved: 0 });
    expect(await retention.purgeExpired('2027-01-01T00:00:00.000Z')).toEqual({ jobsRemoved: 1, playerTombstonesRemoved: 1 });
    expect(await count(database, 'deletion_jobs')).toBe(0);
    expect(await count(database, 'players')).toBe(0);
  });
});
