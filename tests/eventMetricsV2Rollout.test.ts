import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANALYSIS_FACTS_ENGINE_KEY, analysisFactsEngineKey, refreshAnalysisFacts } from '../server/dataset/analysisFacts';
import { hydrateAnalysisFacts } from '../server/dataset/analysisFactHydration';
import { ServerAnalysisService, type AnalysisRequest } from '../server/dataset/analysisService';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { CANONICAL_EVENT_METRIC_RULE_VERSION, EVENT_METRIC_RULE_VERSION_V1, EventMetricEngine } from '../server/metrics/eventMetricEngine';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { postgresExportSources, withConsistentReadSnapshot } from '../server/staticExport/sources';
import { SHARED_MATCH_EVIDENCE_EVENT_ENGINE } from '../server/sharedMatch/stagingMatches';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import type { AnalysisQuery } from '../src/dataSources/server/analysisResult';
import { validSynergyContract } from '../src/dataSources/server/synergyContract';
import { StaticQueryEngine } from '../src/dataSources/static/StaticQueryEngine';
import type { StaticSnapshotIndex } from '../src/dataSources/static/contract';
import { isEventMetricRuleVersion } from '../src/types/advancedMetrics';
import type { MatchRecord } from '../src/types/valorant';
import { benchDatabase, type BenchDatabase } from './support/analysisBenchFixture';
import { exportFrom } from './support/staticSnapshotFixture';

/**
 * TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01 — versioning, facts, rebuild idempotency and static parity of the
 * CANONICAL engine over the real durable write path, with legitimate complex round topology (revive, Spike / self
 * death, recorded-dead kill, team kill). Fictional identifiers only; no network.
 */
const hmacKey = 'test-event-metrics-rollout-hmac-key-32bytes!';
const open: BenchDatabase[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

interface Seat { puuid: string; name: string; team: 'Blue' | 'Red'; agent: string }
const A: Seat = { puuid: 'fictional-rollout-a', name: 'RolloutAlpha', team: 'Blue', agent: 'Sage' };
const B: Seat = { puuid: 'fictional-rollout-b', name: 'RolloutBravo', team: 'Blue', agent: 'Jett' };
const blue: Seat[] = [{ puuid: 'fictional-rollout-x1', name: 'Mate1', team: 'Blue', agent: 'Omen' }, { puuid: 'fictional-rollout-x2', name: 'Mate2', team: 'Blue', agent: 'Sova' },
  { puuid: 'fictional-rollout-x3', name: 'Mate3', team: 'Blue', agent: 'Killjoy' }];
const red: Seat[] = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id, i) => ({ puuid: `fictional-rollout-${id}`, name: `Opp${i}`, team: 'Red' as const, agent: ['Raze', 'Fade', 'Viper', 'Cypher', 'Clove'][i]! }));
const seats = [A, B, ...blue, ...red];
type Kill = [killer: string, victim: string, timeMs: number, weapon?: string];

/** Round scripts: ordinary rounds plus every legitimate complex class event-metrics-v1 fails closed on. */
function roundsFor(variant: number): Kill[][] {
  const [x1, x2, x3] = blue.map((s) => s.puuid); const [r1, r2, r3, r4, r5] = red.map((s) => s.puuid);
  const ordinary = (shift: number): Kill[] => [[A.puuid, r1!, 2000 + shift], [r2!, x1!, 4000], [B.puuid, r2!, 5500], [r3!, x2!, 9000], [x3!, r3!, 11000]];
  return [
    ordinary(variant * 10),
    // REVIVE: A dies, is revived, kills, dies again.
    [[r1!, A.puuid, 3000], [B.puuid, r1!, 4500], [A.puuid, r2!, 20000], [r3!, A.puuid, 26000], [x1!, r3!, 27000]],
    // SELF / SPIKE death of an opponent, then ordinary kills.
    [[r4!, r4!, 1000, 'Bomb'], [A.puuid, r5!, 6000], [r1!, B.puuid, 8000], [x2!, r1!, 9500]],
    // RECORDED-DEAD KILL (lingering utility or revive — undecidable): B dies, then is credited with a kill.
    [[r2!, B.puuid, 2500], [B.puuid, r2!, 7000], [A.puuid, r3!, 9000]],
    // TEAM KILL (friendly-fire ability) — a death, never a kill or an opening.
    [[x1!, x2!, 1500, 'Hot Hands'], [A.puuid, r1!, 5000], [r2!, B.puuid, 9000]],
    ordinary(variant * 20 + 5),
    ordinary(variant * 30 + 7),
    ordinary(variant * 40 + 9),
    ordinary(variant * 50 + 11),
    ordinary(variant * 60 + 13),
  ];
}

function v4(id: number, queue = 'competitive') {
  const rounds = roundsFor(id);
  const tally = new Map(seats.map((s) => [s.puuid, { kills: 0, deaths: 0, assists: 0 }]));
  const team = new Map(seats.map((s) => [s.puuid, s.team]));
  const kills = rounds.flatMap((list, index) => list.map(([killer, victim, time, weapon]) => {
    if (killer !== victim) tally.get(killer)!.kills += 1;
    tally.get(victim)!.deaths += 1;
    return { round: index + 1, time_in_round_in_ms: time, killer: { puuid: killer, team: team.get(killer) }, victim: { puuid: victim, team: team.get(victim) },
      assistants: [], weapon: { id: `w-${weapon ?? 'Vandal'}`, name: weapon ?? 'Vandal' } };
  }));
  return {
    metadata: { match_id: `fictional-rollout-match-${id}`, started_at: new Date(Date.UTC(2026, 8, 1) + id * 86_400_000).toISOString(), game_length_in_ms: 1_800_000,
      map: { id: 'map', name: ['Ascent', 'Bind', 'Lotus'][id % 3] }, queue: { id: queue, name: queue === 'unrated' ? 'Unrated' : 'Competitive' },
      season: { id: '0a1b2c3d-0000-4000-8000-000000000001', short: 'e11a5' } },
    players: seats.map((s) => ({ puuid: s.puuid, name: s.name, tag: 'TW', team_id: s.team, agent: { id: s.agent, name: s.agent },
      stats: { ...tally.get(s.puuid), score: 220 * rounds.length, headshots: 4, bodyshots: 12, legshots: 1, damage: { dealt: 140 * rounds.length, received: 100 * rounds.length } },
      ability_casts: { ability1: 3, ability2: 2, grenade: 1, ultimate: 1 }, economy: { loadout_value: { overall: 3000 * rounds.length, average: 3000 }, spent: { overall: 2800 * rounds.length, average: 2800 } } })),
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 6, lost: 4 } }, { team_id: 'Red', won: false, rounds: { won: 4, lost: 6 } }],
    rounds: rounds.map((_, i) => ({ id: i + 1, winning_team: i % 5 === 3 ? 'Red' : 'Blue', result: 'Eliminated', plant: null, defuse: null,
      stats: seats.map((s) => ({ player: { puuid: s.puuid }, stats: { kills: 0, score: 200 }, economy: { loadout_value: 3900, remaining: 300 } })) })),
    kills,
  };
}

const connection = { tag: 'TW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;
async function complexDatabase(matches = 12) {
  const db = await benchDatabase(); open.push(db);
  const durable = new DurableEvidenceService(db, hmacKey);
  const a = await durable.persistConnection({ ...connection, gameName: A.name }, A.puuid, '2026-08-01T00:00:00.000Z');
  const b = await durable.persistConnection({ ...connection, gameName: B.name }, B.puuid, '2026-08-01T00:00:00.000Z');
  const docs = Array.from({ length: matches }, (_, i) => v4(i + 1, i % 4 === 3 ? 'unrated' : 'competitive'));
  for (const [who, id] of [[A, a], [B, b]] as const) {
    for (let i = 0; i < docs.length; i += 5) {
      await durable.persistMatches({ ...connection, gameName: who.name, playerId: id.publicPlayerId!, limit: 10 }, { status: 200, data: docs.slice(i, i + 5) });
    }
  }
  return db;
}
const r = (p: Partial<AnalysisRequest>): AnalysisRequest => ({ feature: 'lifetimeTotals', map: 'all', agent: 'all', role: 'all', mode: 'all', player: 'all', form: false, ...p });
const service = (db: BenchDatabase) => new ServerAnalysisService(db, new DatasetProjectionService(new PostgresDatasetReadRepository(db)));
const factTableHash = async (db: BenchDatabase) => createHash('sha256').update(JSON.stringify((await db.query(
  `SELECT f.engine_key, mp.participant_lookup_hmac, f.observed_rounds, f.present_every_round, f.metrics::text AS metrics, f.trade_edges::text AS trade_edges
   FROM analysis_participant_facts f JOIN match_participants mp ON mp.id=f.match_participant_id ORDER BY mp.participant_lookup_hmac, f.source_match_id`)).rows)).digest('hex');

describe('versioning', () => {
  it('the facts engine key names the engine that wrote the fact; v1 and v2 keys are distinct and deterministic', () => {
    expect(analysisFactsEngineKey('event-metrics-v1')).not.toBe(analysisFactsEngineKey('event-metrics-v2'));
    expect(ANALYSIS_FACTS_ENGINE_KEY).toBe(analysisFactsEngineKey(CANONICAL_EVENT_METRIC_RULE_VERSION));
    expect(analysisFactsEngineKey('event-metrics-v2')).toBe('analysis-match-facts-v1:event-metrics-v2:durable-evidence-v2');
    expect(new EventMetricEngine().ruleVersion).toBe(CANONICAL_EVENT_METRIC_RULE_VERSION);
  });
  it('rollback: event-metrics-v1 stays callable and labelled exactly as before; shared-match evidence stays pinned to v1', () => {
    expect(new EventMetricEngine({ ruleVersion: EVENT_METRIC_RULE_VERSION_V1 }).ruleVersion).toBe('event-metrics-v1');
    expect(SHARED_MATCH_EVIDENCE_EVENT_ENGINE).toBe('event-metrics-v1');
    expect(isEventMetricRuleVersion('event-metrics-v1') && isEventMetricRuleVersion('event-metrics-v2')).toBe(true);
    expect(isEventMetricRuleVersion('event-metrics-v3')).toBe(false);
  });
  it('public contracts accept both known rule versions with the identical evidence shape and reject unknown ones', () => {
    const match = (ruleVersion: string) => ({ id: 'm', playedAt: '2026-09-01T00:00:00.000Z', map: 'Ascent', gameMode: 'Competitive', opponent: 'x', scoreFor: 13, scoreAgainst: 9,
      won: true, durationMinutes: 40, performances: [], synergyEvidence: { ruleVersion, status: 'reconstructed', reconstructedRounds: 22, pairs: [] } }) as unknown as MatchRecord;
    expect(validSynergyContract(match('event-metrics-v1'), new Set())).toBe(true);
    expect(validSynergyContract(match('event-metrics-v2'), new Set())).toBe(true);
    expect(validSynergyContract(match('event-metrics-v3'), new Set())).toBe(false);
  });
});

describe('canonical engine over the real durable write path (complex topology)', () => {
  it('reconstructs legitimate complex rounds according to the canonical engine; v1 keeps failing closed', async () => {
    const db = await complexDatabase(4);
    const statuses = (await db.query<{ status: string }>("SELECT DISTINCT metrics::json->'kast'->>'status' AS status FROM analysis_participant_facts")).rows.map((row) => row.status);
    expect(statuses).toEqual([CANONICAL_EVENT_METRIC_RULE_VERSION === 'event-metrics-v2' ? 'reconstructed' : 'partial']);
    // The explicit v1 engine still fails closed on the same raw evidence (historical behaviour reproducible).
    const ids = (await db.query<{ id: string }>('SELECT id FROM source_matches ORDER BY id')).rows.map((row) => row.id);
    await db.transaction((tx) => refreshAnalysisFacts(tx, ids, new EventMetricEngine({ ruleVersion: 'event-metrics-v1' })));
    const v1 = (await db.query<{ status: string; key: string }>("SELECT DISTINCT metrics::json->'kast'->>'status' AS status, engine_key AS key FROM analysis_participant_facts")).rows;
    expect(v1).toEqual([{ status: 'partial', key: analysisFactsEngineKey('event-metrics-v1') }]);
  });

  it('switching engines re-keys every fact; hydration rebuilds them exactly once, without duplicates (idempotent)', async () => {
    const db = await complexDatabase(8);
    const facts = async () => Number((await db.query<{ n: string }>('SELECT count(*)::text AS n FROM analysis_participant_facts')).rows[0]!.n);
    const count = await facts();
    const canonicalHash = await factTableHash(db);
    // Facts written by the other engine are never fresh for the canonical engine …
    const other = CANONICAL_EVENT_METRIC_RULE_VERSION === 'event-metrics-v2' ? 'event-metrics-v1' : 'event-metrics-v2';
    const ids = (await db.query<{ id: string }>('SELECT id FROM source_matches ORDER BY id')).rows.map((row) => row.id);
    await db.transaction((tx) => refreshAnalysisFacts(tx, ids, new EventMetricEngine({ ruleVersion: other })));
    expect(await facts()).toBe(count);
    expect((await service(db).analyze(r({}))).metrics.factMatches).toBe(0);
    // … hydration replaces them with canonical facts, byte-identical to the first build, then has nothing left to do.
    const first = await hydrateAnalysisFacts(db);
    expect(first.refreshedMatches).toBe(ids.length);
    expect(await facts()).toBe(count);
    expect(await factTableHash(db)).toBe(canonicalHash);
    expect(await hydrateAnalysisFacts(db)).toMatchObject({ scannedMatches: 0, refreshedMatches: 0 });
    // A full second rebuild from scratch produces the same bytes.
    await db.query('DELETE FROM analysis_participant_facts');
    await hydrateAnalysisFacts(db);
    expect(await factTableHash(db)).toBe(canonicalHash);
    expect(await facts()).toBe(count);
  });

  it('the fact path equals the raw reconstruction byte for byte', async () => {
    const db = await complexDatabase(8);
    const requests = [r({}), r({ feature: 'mapStats' }), r({ feature: 'agentStats' }), r({ feature: 'synergy' }), r({ feature: 'currentStrength', form: true }),
      r({ feature: 'fixedRecent', recent: 10 }), r({ feature: 'improvementIndex' })];
    const factPath = await Promise.all(requests.map((request) => service(db).analyze(request)));
    await db.query("UPDATE analysis_participant_facts SET engine_key='superseded-for-test'");
    const rawPath = await Promise.all(requests.map((request) => service(db).analyze(request)));
    rawPath.forEach((result, index) => {
      expect(result.metrics.factMatches).toBe(0);
      expect(JSON.stringify(factPath[index]!.payload)).toBe(JSON.stringify(result.payload));
    });
  });

  it('static query parity: the browser engine over the exported public facts equals the server, byte for byte; no private identifier is exported', async () => {
    const db = await complexDatabase(12);
    const work = await mkdtemp(join(tmpdir(), 'v2-rollout-static-'));
    try {
      const exported = await exportFrom(db, join(work, 'export'), { tier: 'facts' });
      // Deterministic candidate export: same durable data -> same snapshot id and byte-identical integrity manifest.
      const again = await exportFrom(db, join(work, 'export-again'), { tier: 'facts' });
      expect(again.snapshotId).toBe(exported.snapshotId);
      expect(await readFile(join(again.directory, 'integrity.json'), 'utf8')).toBe(await readFile(join(exported.directory, 'integrity.json'), 'utf8'));
      const index = JSON.parse(await readFile(join(exported.directory, 'index.json'), 'utf8')) as StaticSnapshotIndex;
      const engine = new StaticQueryEngine(async (path) => JSON.parse(await readFile(join(exported.directory, path), 'utf8')), index.facts!);
      const players = (await db.query<{ public_id: string }>('SELECT public_id::text FROM members ORDER BY public_id')).rows.map((row) => row.public_id);
      const queries: AnalysisQuery[] = [{ feature: 'lifetimeTotals' }, { feature: 'currentStrength' }, { feature: 'currentStrength', form: true }, { feature: 'mapStats' },
        { feature: 'agentStats' }, { feature: 'fixedRecent', recent: 10 }, { feature: 'actOverview', act: 'e11a5' }, { feature: 'synergy' },
        { feature: 'lifetimeTotals', mode: 'Unrated' }, ...players.map((player): AnalysisQuery => ({ feature: 'improvementIndex', player }))];
      await withConsistentReadSnapshot(db, async (snapshot) => {
        const server = postgresExportSources(snapshot);
        for (const query of queries) expect(JSON.stringify(await engine.analysis(query)), JSON.stringify(query)).toBe(JSON.stringify(await server.analysis(query)));
      });
      const files = await readdir(exported.directory, { recursive: true });
      const text = (await Promise.all(files.filter((file) => file.endsWith('.json')).map((file) => readFile(join(exported.directory, file), 'utf8')))).join('\n');
      // Consenting members' public Riot names are allowed public fields; file checksums are manifest content hashes.
      const withoutChecksums = text.replace(/"sha256":"[0-9a-f]{64}"/gu, '');
      expect(withoutChecksums).not.toMatch(/fictional-rollout|Mate[123]|Opp[0-4]|[0-9a-f]{64}/u);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }, 300_000);
});
