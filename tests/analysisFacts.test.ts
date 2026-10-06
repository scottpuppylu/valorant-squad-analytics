import { afterEach, describe, expect, it } from 'vitest';
import type { SqlDatabase } from '../server/db/types';
import { ANALYSIS_FACTS_ENGINE_KEY } from '../server/dataset/analysisFacts';
import { hydrateAnalysisFacts } from '../server/dataset/analysisFactHydration';
import { ServerAnalysisService, type AnalysisRequest } from '../server/dataset/analysisService';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { RevocationDeletionService } from '../server/deletion/revocationDeletionService';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { benchDatabase, seedBenchAccounts, seedBenchMatches, type BenchDatabase } from './support/analysisBenchFixture';

/**
 * TASK-DATA-03B.2D analysis-match-facts-v1 correctness: the fact path must equal the raw reconstruction
 * (the pre-change engine, kept as the exact fallback) byte for byte, through every durable mutation.
 * All identifiers and names are fictional.
 */
const hmacKey = 'test-analysis-facts-hmac-key-with-32-bytes!!';
const open: BenchDatabase[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });
const r = (p: Partial<AnalysisRequest>): AnalysisRequest => ({ feature: 'lifetimeTotals', map: 'all', agent: 'all', role: 'all', mode: 'all', player: 'all', form: false, ...p });
const requests: AnalysisRequest[] = [
  r({}), r({ feature: 'mapStats' }), r({ feature: 'agentStats' }), r({ feature: 'actOverview', act: 'e11a5' }), r({ feature: 'synergy' }),
  r({ feature: 'currentStrength', form: true }), r({ feature: 'fixedRecent', recent: 10 }), r({ feature: 'improvementIndex' }),
];
const service = (db: SqlDatabase) => new ServerAnalysisService(db, new DatasetProjectionService(new PostgresDatasetReadRepository(db)));

/** Analysis payloads on the fact path, then on the raw path (every fact made stale), then facts restored. */
async function factVersusRaw(db: BenchDatabase) {
  const facts = [];
  for (const request of requests) facts.push(await service(db).analyze(request));
  await db.query("UPDATE analysis_participant_facts SET engine_key='superseded-for-test'");
  const raw = [];
  for (const request of requests) raw.push(await service(db).analyze(request));
  await db.query('UPDATE analysis_participant_facts SET engine_key=$1', [ANALYSIS_FACTS_ENGINE_KEY]);
  for (const result of raw) expect(result.metrics.factMatches).toBe(0);
  return { facts, raw };
}
function expectIdentical(pair: Awaited<ReturnType<typeof factVersusRaw>>) {
  pair.facts.forEach((result, index) => expect(JSON.stringify(result.payload)).toBe(JSON.stringify(pair.raw[index]!.payload)));
}

// ---- Henrik v4 payloads for the real write path (DurableEvidenceService → upsertMatch).
interface Seat { puuid: string; name: string; team: 'Blue' | 'Red'; agent: string }
function v4(id: number, seats: Seat[], options: { rounds?: number; killSeed?: number; queue?: string; absentFromRounds?: string[] } = {}) {
  const rounds = options.rounds ?? 6;
  const absent = new Set(options.absentFromRounds ?? []);
  let seed = options.killSeed ?? id;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const kills: unknown[] = [];
  const tally = new Map<string, { kills: number; deaths: number; assists: number }>(seats.map((s) => [s.puuid, { kills: 0, deaths: 0, assists: 0 }]));
  for (let round = 1; round <= rounds; round += 1) {
    const alive = new Set(seats.map((s) => s.puuid));
    let time = 0;
    for (let k = 0; k < 3; k += 1) {
      const team = next() < 0.5 ? 'Blue' : 'Red';
      const killers = seats.filter((s) => s.team === team && alive.has(s.puuid));
      const victims = seats.filter((s) => s.team !== team && alive.has(s.puuid));
      if (!killers.length || !victims.length) break;
      const killer = killers[Math.floor(next() * killers.length)]!;
      const victim = victims[Math.floor(next() * victims.length)]!;
      const helper = killers.find((s) => s.puuid !== killer.puuid);
      time += 1500 + Math.floor(next() * 6000);
      kills.push({ round, time_in_round_in_ms: time, killer: { puuid: killer.puuid, team }, victim: { puuid: victim.puuid, team: victim.team },
        assistants: helper ? [{ puuid: helper.puuid, team }] : [], weapon: { id: 'vandal-id', name: 'Vandal' } });
      tally.get(killer.puuid)!.kills += 1; tally.get(victim.puuid)!.deaths += 1; if (helper) tally.get(helper.puuid)!.assists += 1;
      alive.delete(victim.puuid);
    }
  }
  return {
    metadata: { match_id: `fictional-facts-match-${id}`, started_at: new Date(Date.UTC(2026, 8, 1) + id * 3_600_000).toISOString(), game_length_in_ms: 1_800_000,
      map: { id: 'map', name: ['Ascent', 'Bind', 'Lotus'][id % 3] }, queue: { id: options.queue ?? 'competitive', name: options.queue === 'unrated' ? 'Unrated' : 'Competitive' },
      season: { id: '0a1b2c3d-0000-4000-8000-000000000001', short: 'e11a5' } },
    players: seats.map((s) => ({ puuid: s.puuid, name: s.name, tag: 'TW', team_id: s.team, agent: { id: s.agent, name: s.agent },
      stats: { ...tally.get(s.puuid), score: 220 * rounds, headshots: 4, bodyshots: 12, legshots: 1, damage: { dealt: 140 * rounds, received: 100 * rounds } },
      ability_casts: { ability1: 3, ability2: 2, grenade: 1, ultimate: 1 }, economy: { loadout_value: { overall: 3000 * rounds, average: 3000 }, spent: { overall: 2800 * rounds, average: 2800 } } })),
    teams: [{ team_id: 'Blue', won: true, rounds: { won: Math.ceil(rounds / 2), lost: Math.floor(rounds / 2) } }, { team_id: 'Red', won: false, rounds: { won: Math.floor(rounds / 2), lost: Math.ceil(rounds / 2) } }],
    rounds: Array.from({ length: rounds }, (_, i) => ({ id: i + 1, winning_team: i % 2 === 0 ? 'Blue' : 'Red', result: 'Eliminated', plant: null, defuse: null,
      stats: seats.filter((s) => !absent.has(s.puuid)).map((s) => ({ player: { puuid: s.puuid }, stats: { kills: 0, score: 200 }, economy: { loadout_value: 3900, remaining: 300 } })) })),
    kills,
  };
}
const A: Seat = { puuid: 'fictional-puuid-a', name: 'FactAlpha', team: 'Blue', agent: 'Jett' };
const B: Seat = { puuid: 'fictional-puuid-b', name: 'FactBravo', team: 'Blue', agent: 'Omen' };
const others: Seat[] = [
  { puuid: 'fictional-x1', name: 'StrangerOne', team: 'Blue', agent: 'Sova' }, { puuid: 'fictional-x2', name: 'StrangerTwo', team: 'Red', agent: 'Raze' },
  { puuid: 'fictional-x3', name: 'StrangerThree', team: 'Red', agent: 'Sage' }, { puuid: 'fictional-x4', name: 'StrangerFour', team: 'Red', agent: 'Fade' },
];
const page = (...data: unknown[]) => ({ status: 200, data });
const connection = { tag: 'TW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;

async function writePathDatabase() {
  const db = await benchDatabase(); open.push(db);
  const durable = new DurableEvidenceService(db, hmacKey);
  const a = await durable.persistConnection({ ...connection, gameName: A.name }, A.puuid, '2026-10-01T00:00:00.000Z');
  const b = await durable.persistConnection({ ...connection, gameName: B.name }, B.puuid, '2026-10-01T00:00:00.000Z');
  const importAs = (who: 'a' | 'b', ...matches: unknown[]) => durable.persistMatches({ ...connection, gameName: who === 'a' ? A.name : B.name,
    playerId: (who === 'a' ? a : b).publicPlayerId!, limit: 10 }, page(...matches));
  return { db, durable, a, b, importAs };
}
const factCount = async (db: SqlDatabase, where = 'true') => Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM analysis_participant_facts WHERE ${where}`)).rows[0]!.n);

describe('analysis-match-facts-v1 write path', () => {
  it('commits facts with every durable write, refreshes them on reimport, links on healing, and stays exact', async () => {
    const { db, importAs } = await writePathDatabase();
    await importAs('a', v4(1, [A, B, ...others]), v4(2, [A, ...others]), v4(3, [A, B, ...others], { queue: 'unrated' }));
    // Only LINKED participants get facts (B is not linked until B's own import heals the shared rows).
    expect(await factCount(db)).toBe(3);
    expect(await factCount(db, `engine_key='${ANALYSIS_FACTS_ENGINE_KEY}'`)).toBe(3);
    expectIdentical(await factVersusRaw(db));

    // Incremental: one new match → the fact path equals a full raw rebuild, no manual refresh.
    await importAs('a', v4(4, [A, ...others], { rounds: 9 }));
    expect(await factCount(db)).toBe(4);
    const incremental = await factVersusRaw(db);
    expect(incremental.facts[0]!.metrics.fallbackMatches).toBe(0);
    expectIdentical(incremental);

    // Correction / reimport of match 2 with different kills: the fact is replaced and stays fresh.
    const before = (await db.query<{ metrics: unknown }>("SELECT metrics::text AS metrics FROM analysis_participant_facts f JOIN source_matches sm ON sm.id=f.source_match_id WHERE sm.started_at=$1", [new Date(Date.UTC(2026, 8, 1) + 2 * 3_600_000).toISOString()])).rows[0]!.metrics;
    await importAs('a', v4(2, [A, ...others], { killSeed: 999 }));
    const after = (await db.query<{ metrics: unknown }>("SELECT metrics::text AS metrics FROM analysis_participant_facts f JOIN source_matches sm ON sm.id=f.source_match_id WHERE sm.started_at=$1", [new Date(Date.UTC(2026, 8, 1) + 2 * 3_600_000).toISOString()])).rows[0]!.metrics;
    expect(after).not.toBe(before);
    expect(await factCount(db)).toBe(4);
    expectIdentical(await factVersusRaw(db));

    // Healing: B imports the shared matches → B's participant rows link and get their own facts.
    await importAs('b', v4(1, [A, B, ...others]), v4(3, [A, B, ...others], { queue: 'unrated' }));
    expect(await factCount(db)).toBe(6);
    expectIdentical(await factVersusRaw(db));
    // Replay is idempotent: no duplicate fact.
    await importAs('b', v4(1, [A, B, ...others]));
    expect(await factCount(db)).toBe(6);
  });

  it('never trusts a stale or missing fact: that match alone is reconstructed from raw evidence, exactly', async () => {
    const { db, importAs } = await writePathDatabase();
    await importAs('a', v4(1, [A, ...others]), v4(2, [A, ...others]), v4(3, [A, ...others]), v4(4, [A, ...others]));
    // An evidence write that did not refresh facts (e.g. an older deployment during rollout) → stale.
    await db.query("UPDATE source_matches SET last_observed_at=last_observed_at + interval '1 second' WHERE id=(SELECT source_match_id FROM analysis_participant_facts ORDER BY source_match_id LIMIT 1)");
    // A fact that is simply absent.
    await db.query('DELETE FROM analysis_participant_facts WHERE match_participant_id=(SELECT match_participant_id FROM analysis_participant_facts ORDER BY source_match_id DESC LIMIT 1)');
    const result = await service(db).analyze(r({}));
    expect(result.metrics).toMatchObject({ factMatches: 2, fallbackMatches: 2 });
    expect(result.payload.coverage.populationComplete).toBe(true);
    expectIdentical(await factVersusRaw(db));
    // Hydration repairs exactly those matches; a second run has nothing to do.
    expect(await hydrateAnalysisFacts(db)).toMatchObject({ scannedMatches: 2, refreshedMatches: 2 });
    expect(await hydrateAnalysisFacts(db)).toMatchObject({ scannedMatches: 0 });
    expect((await service(db).analyze(r({}))).metrics).toMatchObject({ factMatches: 4, fallbackMatches: 0 });
  });

  it('withholds facts when visibility could change the reconstruction (linked participant outside every round but in events)', async () => {
    const { db, importAs } = await writePathDatabase();
    await importAs('b', v4(5, [A, B, ...others], { absentFromRounds: [A.puuid] }));
    await importAs('a', v4(5, [A, B, ...others], { absentFromRounds: [A.puuid] }), v4(6, [A, ...others]));
    // Match 5 has a linked participant (A) absent from every round yet referenced by kill events.
    const withheld = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM source_matches sm WHERE NOT EXISTS (SELECT 1 FROM analysis_participant_facts f WHERE f.source_match_id=sm.id)`);
    expect(Number(withheld.rows[0]!.n)).toBe(1);
    expect(await hydrateAnalysisFacts(db)).toMatchObject({ withheldMatches: 1, refreshedMatches: 0 });
    expectIdentical(await factVersusRaw(db));
  });

  it('removes the facts of a deleted account: shared matches drop the anonymized participant, exclusive ones cascade', async () => {
    const { db, importAs, b } = await writePathDatabase();
    await importAs('a', v4(1, [A, B, ...others]), v4(2, [A, ...others]));
    await importAs('b', v4(1, [A, B, ...others]), v4(7, [B, ...others]));
    expect(await factCount(db)).toBe(4);
    const deletion = new RevocationDeletionService(db, hmacKey, () => new Date('2026-10-06T00:00:00.000Z'));
    const pending = await deletion.revoke(b.publicPlayerId!, b.managementCredential!);
    await deletion.continue(pending.jobId, b.managementCredential!);
    // A's two facts remain (shared match 1 + solo match 2); B's shared fact and exclusive match are gone.
    expect(await factCount(db)).toBe(2);
    expect(await factCount(db, 'match_participant_id IN (SELECT id FROM match_participants WHERE player_id IS NULL)')).toBe(0);
    const pair = await factVersusRaw(db);
    expectIdentical(pair);
    expect(pair.facts[0]!.payload.summary!.analytics).toHaveLength(1);
  });

  it('stores only derived evidence: no provider identifier, HMAC, name or score', async () => {
    const { db, importAs } = await writePathDatabase();
    await importAs('a', v4(1, [A, B, ...others]));
    const text = JSON.stringify((await db.query('SELECT * FROM analysis_participant_facts')).rows);
    expect(text).not.toMatch(/puuid|fictional|Fact(Alpha|Bravo)|Stranger|[0-9a-f]{64}|overall|community-score/iu);
  });
});

describe('analysis-match-facts-v1 on realistic history', () => {
  it('mixed modes: absolute analytics equal a Competitive-only database exactly', async () => {
    const db = await benchDatabase(); open.push(db);
    await seedBenchAccounts(db, { matches: 160 });
    await seedBenchMatches(db, { matches: 160, seed: 11 });
    await hydrateAnalysisFacts(db);
    const mixed = await Promise.all([r({}), r({ feature: 'mapStats' }), r({ feature: 'synergy' })].map((request) => service(db).analyze(request)));
    await db.query("DELETE FROM source_matches WHERE queue_id IS DISTINCT FROM 'competitive'");
    const competitiveOnly = await Promise.all([r({}), r({ feature: 'mapStats' }), r({ feature: 'synergy' })].map((request) => service(db).analyze(request)));
    // The member PROFILE (player.agents / player.role) is derived from all durable history by design and is
    // not a strength metric; every statistic, score, map, agent group and synergy value must be identical.
    const withoutProfile = (value: unknown) => JSON.stringify(value, (key, item) => (key === 'player' && item && typeof item === 'object'
      ? { ...(item as Record<string, unknown>), agents: undefined, role: undefined } : item));
    mixed.forEach((result, index) => {
      const other = competitiveOnly[index]!;
      expect(withoutProfile(result.payload.summary ?? result.payload.synergy)).toBe(withoutProfile(other.payload.summary ?? other.payload.synergy));
      expect(result.payload.coverage.populationMatches).toBe(other.payload.coverage.populationMatches);
    });
  });

  it('multi-account member and revoked account: fact path equals raw for the full request matrix', async () => {
    const db = await benchDatabase(); open.push(db);
    await seedBenchAccounts(db, { matches: 140, accounts: 7, linkAccounts: [[6, 1]] });
    await seedBenchMatches(db, { matches: 140, accounts: 7, seed: 5 });
    await db.query("UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id='00000001-0000-4000-8000-000000000005'");
    const hydration = await hydrateAnalysisFacts(db, { batchSize: 40 });
    expect(hydration.refreshedMatches).toBe(140);
    expectIdentical(await factVersusRaw(db));
  });
});
