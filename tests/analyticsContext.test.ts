import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlResult } from '../server/db/types';
import { buildAnalyticsContext, PostgresAnalyticsContextRepository } from '../server/dataset/analyticsContext';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import datasetHandler from '../api/valorant/dataset';
import type { ApiResponse } from '../server/contracts';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { isDatasetAnalyticsContextResponse } from '../src/dataSources/server/datasetContract';

const squadId = '00000000-0000-4000-8000-000000000001';
const open: PGlite[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function database(): Promise<SqlDatabase> {
  const pg = new PGlite();
  open.push(pg);
  const db: SqlDatabase = {
    query: async <Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> => {
      const value = await pg.query<Row>(sql, params);
      return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
    },
    transaction: async (work) => work(db),
    close: async () => undefined,
  };
  await applyMigrations(db, await loadMigrations(resolve('migrations')));
  return db;
}

const uuid = (kind: number, value: number) => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const hex = (value: number) => value.toString(16).padStart(64, '0');

interface Seed { n: number; player: number; queue?: string; seasonShort?: string | null; seasonId?: string | null; lengthMs?: number | null; startedAt?: string | null }

async function seed(db: SqlDatabase, playerCount: number, matches: Seed[]): Promise<void> {
  await db.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3)', [squadId, 'friends', 'Friends']);
  for (let p = 1; p <= playerCount; p += 1) {
    await db.query('INSERT INTO players (id,public_id,display_name,display_tag,default_emoji) VALUES ($1,$2,$3,$4,$5)', [uuid(1, p), uuid(2, p), `Player${p}`, 'T', '🐺']);
    await db.query('INSERT INTO squad_memberships (id,squad_id,player_id,status) VALUES ($1,$2,$3,$4)', [uuid(3, p), squadId, uuid(1, p), 'active']);
    await db.query('INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at) VALUES ($1,$2,$3,$4,$5,$6)', [uuid(4, p), uuid(1, p), 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00Z']);
  }
  for (const m of matches) {
    const started = m.startedAt === undefined ? new Date(Date.UTC(2026, 8, 30) - m.n * 3_600_000).toISOString() : m.startedAt;
    await db.query(`INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status,season_id,season_short)
      VALUES ($1,$2,'HenrikDev',$3,'v4','durable-evidence-v2','ap','Ascent',$4,$4,$5,$6,now(),now(),$7,'observed','observed',$8,$9)`,
    [uuid(5, m.n), squadId, hex(m.n), m.queue ?? 'competitive', started, m.lengthMs === undefined ? 1_800_000 : m.lengthMs, uuid(6, m.n), m.seasonId ?? null, m.seasonShort ?? null]);
    await db.query('INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost) VALUES ($1,$2,$3,true,1,0)', [uuid(7, m.n), uuid(5, m.n), 'Blue']);
    await db.query(`INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots)
      VALUES ($1,$2,$3,$4,'Blue','Jett','observed',1,0,1,300,150,1,1,0)`, [uuid(8, m.n), uuid(5, m.n), uuid(1, m.player), hex(100_000 + m.n)]);
    await db.query("INSERT INTO rounds (id,source_match_id,round_number,participants_evidence_status,plant_status,defuse_status) VALUES ($1,$2,1,'observed','missing','missing')", [uuid(9, m.n), uuid(5, m.n)]);
    await db.query("INSERT INTO round_participants (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status) VALUES ($1,$2,$3,'observed','missing','missing','missing')", [uuid(10, m.n), uuid(9, m.n), uuid(8, m.n)]);
  }
}

describe('view=analytics context facts (analytics-context-v1)', () => {
  it('reports truthful unavailable Act/rank evidence when nothing is ingested (current production shape)', async () => {
    const db = await database();
    await seed(db, 2, [{ n: 1, player: 1 }, { n: 2, player: 2, queue: 'unrated' }, { n: 3, player: 1, lengthMs: null }]);
    const payload = buildAnalyticsContext(await new PostgresAnalyticsContextRepository(db).readContextRows());
    expect(isDatasetAnalyticsContextResponse(payload)).toBe(true);
    expect(payload).toMatchObject({
      view: 'analytics', analyticsVersion: 'analytics-context-v1', scopeRuleVersion: 'analysis-scope-v1',
      featurePolicyVersion: 'feature-scope-policy-v1', adaptiveWindowVersion: 'adaptive-window-v1',
      population: { trackedMatchCount: 3, snapshotWindow: 300, snapshotCoversTrackedHistory: true, lifetimeComplete: false },
    });
    expect(payload.evidence.season).toMatchObject({ status: 'unavailable', matchesWithAct: 0, matchesWithoutAct: 3, currentActKnown: false, acts: [] });
    expect(payload.evidence.rank).toEqual({ status: 'unavailable', observations: 0, reason: 'not_ingested' });
    expect(payload.evidence.duration).toEqual({ status: 'partial', matchesWithDuration: 2, matchesWithoutDuration: 1 });
    expect(payload.evidence.queues).toEqual([{ gameMode: 'Competitive', matches: 2 }, { gameMode: 'Unrated', matches: 1 }]);
    expect(payload.policies.find((policy) => policy.feature === 'currentStrength')).toMatchObject({ horizon: 'ADAPTIVE', queues: ['Competitive'] });
  });

  it('counts only public Act codes, never exposes season or identity identifiers, and follows current consent', async () => {
    const db = await database();
    const seasonUuid = 'abcdef01-2345-4678-9abc-def012345678';
    await seed(db, 2, [
      { n: 1, player: 1, seasonShort: 'e9a3', seasonId: seasonUuid },
      { n: 2, player: 1, seasonShort: 'E9A3', seasonId: seasonUuid },
      { n: 3, player: 1, seasonShort: 'e9a2' },
      { n: 4, player: 1, seasonShort: 'weird-format' },
      { n: 5, player: 1, seasonId: seasonUuid },
      { n: 6, player: 2, seasonShort: 'e9a1' },
      { n: 7, player: 1, startedAt: null },
    ]);
    await db.query("INSERT INTO rank_observations (id,player_id,provider,observed_at,tier_id,rr) VALUES ($1,$2,'HenrikDev',now(),12,40)", [uuid(11, 1), uuid(1, 1)]);
    const repository = new PostgresAnalyticsContextRepository(db);
    const payload = buildAnalyticsContext(await repository.readContextRows());
    expect(payload.population.trackedMatchCount).toBe(6);
    expect(payload.evidence.season).toMatchObject({ status: 'partial', matchesWithAct: 4, seasonIdWithoutPublicAct: 1, unrecognizedSeasonCodes: 1 });
    expect(payload.evidence.season.acts).toEqual([{ key: 'e9a3', label: 'E9:A3', matches: 2 }, { key: 'e9a2', label: 'E9:A2', matches: 1 }, { key: 'e9a1', label: 'E9:A1', matches: 1 }]);
    expect(payload.evidence.rank).toEqual({ status: 'partial', observations: 1, reason: 'not_tied_to_matches' });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu);
    expect(serialized).not.toMatch(/[0-9a-f]{64}|hmac|puuid|henrik|Player1|weird-format/iu);

    await db.query("UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id=$1", [uuid(1, 2)]);
    const revoked = buildAnalyticsContext(await repository.readContextRows());
    expect(revoked.population.trackedMatchCount).toBe(5);
    expect(revoked.evidence.season.acts.map((act) => act.key)).toEqual(['e9a3', 'e9a2']);

    const projected = (await new DatasetProjectionService(new PostgresDatasetReadRepository(db)).read()).payload.dataset.matches;
    expect(projected.filter((match) => match.seasonKey === 'e9a3')).toHaveLength(2);
    expect(projected.some((match) => match.seasonKey === undefined)).toBe(true);
    expect(JSON.stringify(projected)).not.toContain(seasonUuid);
    expect(JSON.stringify(projected)).not.toContain('weird-format');
  });

  it('detects when tracked history exceeds the newest-300 transport snapshot', async () => {
    const payload = buildAnalyticsContext({ sqlQueryCount: 2, rankObservations: 0, groups: [
      { queue_id: 'competitive', queue_name: 'Competitive', season_short: null, has_season_id: false, has_duration: true, has_start: true, matches: 301 },
    ] });
    expect(payload.population).toMatchObject({ trackedMatchCount: 301, snapshotCoversTrackedHistory: false });
  });

  it('fails closed while public reads are disabled and keeps no-store', async () => {
    const previous = process.env.REAL_DATASET_READ_MODE;
    delete process.env.REAL_DATASET_READ_MODE;
    let status = 0; let body: unknown; const headers = new Map<string, string>();
    const response: ApiResponse = { status(code) { status = code; return this; }, json(value) { body = value; }, setHeader(name, value) { headers.set(name.toLowerCase(), value); } };
    try {
      await datasetHandler({ method: 'GET', headers: {}, query: { view: 'analytics' }, socket: { remoteAddress: 'analytics-test' } }, response);
    } finally {
      if (previous === undefined) delete process.env.REAL_DATASET_READ_MODE; else process.env.REAL_DATASET_READ_MODE = previous;
    }
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, schemaVersion: 4, state: 'disabled', source: 'REAL_SERVER' });
    expect(headers.get('cache-control')).toBe('no-store');
  });
});
