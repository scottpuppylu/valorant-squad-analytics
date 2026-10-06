import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, loadMigrations } from '../../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../../server/db/types';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../../shared/privacyPolicy';

/**
 * TASK-DATA-03B.2D deterministic durable-evidence generator with REALISTIC topology: 10 participants per
 * match (consenting accounts + non-consenting players), every participant present in every round, kill
 * events with assistants and valid alive-topology, mixed queues, Acts, maps and agents, plus partial
 * evidence (missing kills / missing rounds). Nothing is committed as a fixture file; it is generated.
 * All identifiers are fictional and derived from small integers.
 */
export const benchSquadId = '00000000-0000-4000-8000-000000000001';
export const uuid = (kind: number, value: number) => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const hex = (kind: number, value: number) => `${kind.toString(16).padStart(8, '0')}${value.toString(16).padStart(56, '0')}`;

export class BenchDatabase implements SqlDatabase {
  queries = 0;
  constructor(readonly pg: PGlite) {}
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    this.queries += 1;
    const value = await this.pg.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.pg.exec('BEGIN');
    try { const value = await work(this); await this.pg.exec('COMMIT'); return value; }
    catch (error) { await this.pg.exec('ROLLBACK'); throw error; }
  }
  async close(): Promise<void> { await this.pg.close(); }
}

export async function benchDatabase(): Promise<BenchDatabase> {
  const db = new BenchDatabase(new PGlite());
  await applyMigrations(db, await loadMigrations(resolve('migrations')));
  return db;
}

function placeholders(rows: number, width: number): string {
  let index = 1;
  return Array.from({ length: rows }, () => `(${Array.from({ length: width }, () => `$${index++}`).join(',')})`).join(',');
}
export async function insertRows(db: SqlDatabase, sql: string, rows: unknown[][], width: number) {
  const chunk = Math.floor(30_000 / width);
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    if (slice.length) await db.query(`${sql} VALUES ${placeholders(slice.length, width)}`, slice.flat());
  }
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BenchOptions {
  matches: number;
  /** Consenting accounts (1:1 members unless `linkAccounts` merges some). */
  accounts?: number;
  /** Pairs [secondaryAccount, primaryAccount] (1-based) merged into one member. */
  linkAccounts?: [number, number][];
  seed?: number;
  /** Rounds per match range. */
  minRounds?: number;
  maxRounds?: number;
}

const maps = ['Ascent', 'Bind', 'Haven', 'Lotus', 'Split', 'Sunset'];
const agents = ['Jett', 'Sova', 'Omen', 'Killjoy', 'Raze', 'Skye', 'Cypher', 'Brimstone', 'Reyna', 'Fade'];
/** [queue_id, queue_name, weight] — Competitive-heavy like production, plus every other policy class. */
const queues: [string | null, string | null, number][] = [
  ['competitive', 'Competitive', 0.62], ['unrated', 'Unrated', 0.16], ['swiftplay', 'Swiftplay', 0.06],
  ['deathmatch', 'Deathmatch', 0.05], ['premier', 'Premier', 0.04], ['custom', 'Custom', 0.03], ['spikerush', 'Spike Rush', 0.02], [null, null, 0.02],
];

export async function seedBenchAccounts(db: SqlDatabase, options: BenchOptions) {
  const count = options.accounts ?? 6;
  await db.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [benchSquadId, 'bench', 'Bench']);
  const players = Array.from({ length: count }, (_, i) => [uuid(1, i + 1), uuid(2, i + 1), `BenchPlayer${i + 1}`, 'B', '🐺']);
  await insertRows(db, 'INSERT INTO players (id,public_id,display_name,display_tag,default_emoji)', players, 5);
  await insertRows(db, 'INSERT INTO squad_memberships (id,squad_id,player_id,status)', players.map((p, i) => [uuid(3, i + 1), benchSquadId, p[0], 'active']), 4);
  await insertRows(db, 'INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at)', players.map((p, i) => [uuid(4, i + 1), p[0], 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00Z']), 6);
  for (const [secondary, primary] of options.linkAccounts ?? []) {
    await db.query('UPDATE players SET member_id=$2, is_primary_account=false WHERE id=$1', [uuid(1, secondary), uuid(1, primary)]);
    await db.query('DELETE FROM members WHERE id=$1', [uuid(1, secondary)]);
  }
}

export interface BenchCounts { matches: number; participants: number; rounds: number; roundParticipants: number; kills: number; assistants: number }

/** Seeds `matches` source matches with realistic topology. Returns raw row counts. */
export async function seedBenchMatches(db: SqlDatabase, options: BenchOptions, first = 1): Promise<BenchCounts> {
  const random = rng(options.seed ?? 20261006);
  const accounts = options.accounts ?? 6;
  const minRounds = options.minRounds ?? 13;
  const maxRounds = options.maxRounds ?? 20;
  const anchor = Date.UTC(2026, 9, 5, 12);
  const counts: BenchCounts = { matches: 0, participants: 0, rounds: 0, roundParticipants: 0, kills: 0, assistants: 0 };
  const flush = async (buffers: Record<string, unknown[][]>) => {
    await insertRows(db, 'INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status,season_short)', buffers.matches!, 18);
    await insertRows(db, 'INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost)', buffers.teams!, 6);
    await insertRows(db, 'INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots,ability_evidence_status,ability_1_casts,ability_2_casts,grenade_casts,ultimate_casts,economy_evidence_status,loadout_value_total,loadout_value_average,spent_total,spent_average)', buffers.parts!, 25);
    await insertRows(db, 'INSERT INTO rounds (id,source_match_id,round_number,winning_team,participants_evidence_status,plant_status,defuse_status)', buffers.rounds!, 7);
    await insertRows(db, 'INSERT INTO round_participants (id,round_id,match_participant_id,stats_evidence_status,loadout_evidence_status,weapon_evidence_status,armor_evidence_status)', buffers.presences!, 7);
    await insertRows(db, 'INSERT INTO kill_events (id,source_match_id,round_id,event_lookup_hmac,event_sequence,time_in_round_ms,killer_participant_id,victim_participant_id)', buffers.kills!, 8);
    await insertRows(db, 'INSERT INTO kill_assistants (kill_event_id,match_participant_id)', buffers.assists!, 2);
  };
  let buffers: Record<string, unknown[][]> = { matches: [], teams: [], parts: [], rounds: [], presences: [], kills: [], assists: [] };
  let roundSeq = 0; let presenceSeq = 0; let killSeq = 0;
  for (let i = 0; i < options.matches; i += 1) {
    const n = first + i;
    const matchId = uuid(5, n);
    const started = new Date(anchor - (i * 5 + Math.floor(random() * 4)) * 3_600_000).toISOString();
    let pick = random(); let queue = queues[0]!;
    for (const q of queues) { if (pick < q[2]) { queue = q; break; } pick -= q[2]; }
    const roundCount = minRounds + Math.floor(random() * (maxRounds - minRounds + 1));
    // Partial evidence classes: ~4% missing kills, ~2% missing rounds entirely.
    const killsMissing = n % 25 === 7;
    const roundsMissing = n % 50 === 13;
    const season = n % 19 === 0 ? null : i < options.matches * 0.6 ? 'e11a5' : i < options.matches * 0.85 ? 'e11a4' : 'e11a3';
    counts.matches += 1;
    buffers.matches!.push([matchId, benchSquadId, 'HenrikDev', hex(5, n), 'v4', 'durable-evidence-v2', 'ap', maps[n % maps.length], queue[0], queue[1], started, 2_000_000 + roundCount * 90_000,
      started, started, uuid(6, n), roundsMissing ? 'missing' : 'observed', killsMissing || roundsMissing ? 'missing' : 'observed', season]);
    // 1–3 consenting accounts, deterministic, on the same or opposite team; the rest are non-consenting.
    const consenting = new Set<number>();
    const want = 1 + Math.floor(random() * 3);
    while (consenting.size < Math.min(want, accounts)) consenting.add(1 + Math.floor(random() * accounts));
    const seats = [...consenting];
    // Seats: accounts 1–2 on Blue; a 3rd account sits on Red for even matches (opponent appearances).
    const seatIndex = [0, 1, n % 2 === 0 ? 7 : 2];
    const participants: { id: string; team: 'Blue' | 'Red'; account?: number }[] = [];
    for (let s = 0; s < 10; s += 1) {
      const team = s < 5 ? 'Blue' as const : 'Red' as const;
      const seat = seatIndex.indexOf(s);
      participants.push({ id: uuid(8, n * 16 + s), team, ...(seat >= 0 && seat < seats.length ? { account: seats[seat] } : {}) });
    }
    const blueWins = Math.floor(roundCount / 2) + (random() < 0.5 ? 1 : 0);
    buffers.teams!.push([uuid(7, n * 2), matchId, 'Blue', blueWins * 2 > roundCount, blueWins, roundCount - blueWins], [uuid(7, n * 2 + 1), matchId, 'Red', blueWins * 2 < roundCount, roundCount - blueWins, blueWins]);
    const killsBy = new Map<string, number>(); const deathsBy = new Map<string, number>(); const assistsBy = new Map<string, number>();
    const roundIds: string[] = [];
    if (!roundsMissing) for (let r = 1; r <= roundCount; r += 1) {
      const roundId = uuid(9, ++roundSeq);
      roundIds.push(roundId);
      const winner = r <= blueWins ? 'Blue' : 'Red';
      counts.rounds += 1;
      buffers.rounds!.push([roundId, matchId, r, winner, 'observed', 'absent', 'absent']);
      for (const participant of participants) {
        counts.roundParticipants += 1;
        buffers.presences!.push([uuid(10, ++presenceSeq), roundId, participant.id, 'observed', 'missing', 'missing', 'missing']);
      }
      if (killsMissing) continue;
      const alive = new Set(participants.map((p) => p.id));
      const killsThisRound = 3 + Math.floor(random() * 5);
      let time = 0;
      for (let k = 1; k <= killsThisRound; k += 1) {
        const aliveList = participants.filter((p) => alive.has(p.id));
        const killerTeam = random() < 0.5 ? 'Blue' : 'Red';
        const killers = aliveList.filter((p) => p.team === killerTeam);
        const victims = aliveList.filter((p) => p.team !== killerTeam);
        if (!killers.length || !victims.length) break;
        const killer = killers[Math.floor(random() * killers.length)]!;
        const victim = victims[Math.floor(random() * victims.length)]!;
        time += 800 + Math.floor(random() * 9000);
        const killId = uuid(11, ++killSeq);
        counts.kills += 1;
        buffers.kills!.push([killId, matchId, roundId, hex(11, killSeq), k, time, killer.id, victim.id]);
        killsBy.set(killer.id, (killsBy.get(killer.id) ?? 0) + 1);
        deathsBy.set(victim.id, (deathsBy.get(victim.id) ?? 0) + 1);
        const helpers = killers.filter((p) => p.id !== killer.id);
        if (helpers.length && random() < 0.8) {
          const helper = helpers[Math.floor(random() * helpers.length)]!;
          counts.assistants += 1;
          buffers.assists!.push([killId, helper.id]);
          assistsBy.set(helper.id, (assistsBy.get(helper.id) ?? 0) + 1);
        }
        alive.delete(victim.id);
      }
    }
    for (const [s, participant] of participants.entries()) {
      const kills = killsMissing || roundsMissing ? 8 + ((n + s) % 17) : killsBy.get(participant.id) ?? 0;
      const deaths = killsMissing || roundsMissing ? 9 + ((n * 3 + s) % 11) : deathsBy.get(participant.id) ?? 0;
      const score = 150 * roundCount + Math.floor(random() * 120 * roundCount);
      const damage = 110 * roundCount + Math.floor(random() * 70 * roundCount);
      const economyObserved = n % 9 !== 0;
      counts.participants += 1;
      buffers.parts!.push([participant.id, matchId, participant.account ? uuid(1, participant.account) : null, hex(8, n * 16 + s), participant.team,
        agents[(n + s) % agents.length], 'observed', kills, deaths, assistsBy.get(participant.id) ?? (n + s) % 9, score, damage,
        n % 31 === 0 ? null : 5 + ((n + s) % 13), 20 + ((n * 7 + s) % 30), 2 + (s % 5),
        n % 11 === 0 ? 'missing' : 'observed', 10 + (s % 7), 8 + (n % 5), 5 + (s % 3), 2 + (n % 4),
        economyObserved ? 'observed' : 'missing', economyObserved ? 60_000 + roundCount * 900 : null, economyObserved ? 3900 : null,
        economyObserved ? 55_000 + roundCount * 800 : null, economyObserved ? 3500 : null]);
    }
    if (buffers.presences!.length > 40_000) {
      await flush(buffers);
      buffers = { matches: [], teams: [], parts: [], rounds: [], presences: [], kills: [], assists: [] };
    }
  }
  await flush(buffers);
  return counts;
}
