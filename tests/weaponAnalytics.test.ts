import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { ServerAnalysisService } from '../server/dataset/analysisService';
import { parseWeaponRequest, WeaponAnalyticsService, type WeaponRequest } from '../server/dataset/weaponAnalytics';
import { MemberAdminService } from '../server/identity/memberAdminService';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { aggregateWeaponFacts, buildWeaponAnalytics, type WeaponMatchFact } from '../src/analytics/weapons/engine';

const squadId = '00000000-0000-4000-8000-000000000001';
const open: PGlite[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

class PGliteDatabase implements SqlDatabase {
  constructor(readonly pg: PGlite) { open.push(pg); }
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
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
const uuid = (kind: number, value: number) => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const hex = (value: number) => value.toString(16).padStart(64, '0');
function placeholders(rows: number, width: number) { let i = 1; return Array.from({ length: rows }, () => `(${Array.from({ length: width }, () => `$${i++}`).join(',')})`).join(','); }
async function insertRows(db: SqlDatabase, sql: string, rows: unknown[][], width: number) {
  const chunk = Math.floor(30_000 / width);
  for (let i = 0; i < rows.length; i += chunk) { const slice = rows.slice(i, i + chunk); if (slice.length) await db.query(`${sql} VALUES ${placeholders(slice.length, width)}`, slice.flat()); }
}

type Weapon = [string | null, string | null];
const V: Weapon = ['vandal-id', 'Vandal'];
const O: Weapon = ['operator-id', 'Operator'];
const S: Weapon = ['sheriff-id', 'Sheriff'];
type RoundWeapon = Weapon | 'missing' | 'unavailable';
interface Seat { account: number; team?: 'Blue' | 'Red'; agent?: string; weapons: RoundWeapon[]; scores?: (number | null)[]; loadouts?: (number | null)[]; absent?: number[]; kills?: { round: number; weapon: Weapon | null }[] }
interface Match { n: number; hoursAgo: number; map?: string; season?: string | null; queue?: string; winners: ('Blue' | 'Red' | null)[]; seats: Seat[] }
const anchor = Date.UTC(2026, 9, 5, 12);

async function database(accounts: number[]): Promise<PGliteDatabase> {
  const db = new PGliteDatabase(new PGlite());
  await applyMigrations(db, await loadMigrations(resolve('migrations')));
  await db.query('INSERT INTO squads (id,slug,display_name) VALUES ($1,$2,$3)', [squadId, 'friends', 'Friends']);
  await insertRows(db, 'INSERT INTO players (id,public_id,display_name,display_tag)', accounts.map((a) => [uuid(1, a), uuid(2, a), `Fictional${a}`, `T${a}`]), 4);
  await insertRows(db, 'INSERT INTO squad_memberships (id,squad_id,player_id,status)', accounts.map((a) => [uuid(3, a), squadId, uuid(1, a), 'active']), 4);
  await insertRows(db, 'INSERT INTO consents (id,player_id,status,consent_method,privacy_version,consented_at)', accounts.map((a) => [uuid(4, a), uuid(1, a), 'active', 'self_asserted', PUBLIC_DATASET_PRIVACY_VERSION, '2026-09-29T00:00:00Z']), 6);
  return db;
}

async function seed(db: SqlDatabase, matches: Match[]) {
  const sm: unknown[][] = []; const teams: unknown[][] = []; const parts: unknown[][] = []; const rounds: unknown[][] = []; const rps: unknown[][] = []; const kills: unknown[][] = [];
  for (const m of matches) {
    let killSeq = 0;
    const started = new Date(anchor - m.hoursAgo * 3_600_000).toISOString();
    sm.push([uuid(5, m.n), squadId, 'HenrikDev', hex(m.n), 'v4', 'durable-evidence-v2', 'ap', m.map ?? 'Ascent', m.queue ?? 'competitive', m.queue ?? 'Competitive', started, 2_100_000, started, started, uuid(6, m.n), 'observed', 'observed', m.season === undefined ? 'e11a5' : m.season]);
    teams.push([uuid(7, m.n * 2), uuid(5, m.n), 'Blue', true, 13, 9], [uuid(7, m.n * 2 + 1), uuid(5, m.n), 'Red', false, 9, 13]);
    m.winners.forEach((winner, r) => rounds.push([uuid(9, m.n * 64 + r), uuid(5, m.n), r + 1, winner, 'observed', 'missing', 'missing']));
    m.seats.forEach((seat, ordinal) => {
      const pid = uuid(8, m.n * 16 + ordinal);
      parts.push([pid, uuid(5, m.n), uuid(1, seat.account), hex(1_000_000 + m.n * 16 + ordinal), seat.team ?? 'Blue', seat.agent ?? 'Jett', 'observed', 10, 10, 2, 3000, 2000, 5, 10, 1]);
      m.winners.forEach((_winner, r) => {
        const weapon = seat.weapons[r] ?? 'missing';
        const status = weapon === 'missing' || weapon === 'unavailable' ? weapon : 'observed';
        const score = seat.scores?.[r];
        const loadout = seat.loadouts?.[r];
        rps.push([uuid(10, (m.n * 16 + ordinal) * 64 + r), uuid(9, m.n * 64 + r), pid, !(seat.absent ?? []).includes(r), score === undefined || score === null ? 'missing' : 'observed', score ?? null,
          loadout === undefined || loadout === null ? 'missing' : 'observed', loadout ?? null, status, status === 'observed' ? (weapon as Weapon)[0] : null, status === 'observed' ? (weapon as Weapon)[1] : null, 'missing']);
      });
      for (const kill of seat.kills ?? []) {
        killSeq += 1;
        const killId = m.n * 256 + killSeq;
        kills.push([uuid(11, killId), uuid(5, m.n), uuid(9, m.n * 64 + kill.round), hex(9_000_000 + killId), killId, 1000, pid, pid, kill.weapon?.[0] ?? null, kill.weapon?.[1] ?? null]);
      }
    });
  }
  await insertRows(db, 'INSERT INTO source_matches (id,squad_id,provider,provider_match_lookup_hmac,provider_schema_version,normalization_version,affinity,map_name,queue_id,queue_name,started_at,game_length_ms,first_observed_at,last_observed_at,public_id,rounds_evidence_status,kills_evidence_status,season_short)', sm, 18);
  await insertRows(db, 'INSERT INTO match_teams (id,source_match_id,team_key,won,rounds_won,rounds_lost)', teams, 6);
  await insertRows(db, 'INSERT INTO match_participants (id,source_match_id,player_id,participant_lookup_hmac,team_key,agent_name,stats_evidence_status,kills,deaths,assists,score,damage_dealt,headshots,bodyshots,legshots)', parts, 15);
  await insertRows(db, 'INSERT INTO rounds (id,source_match_id,round_number,winning_team,participants_evidence_status,plant_status,defuse_status)', rounds, 7);
  await insertRows(db, 'INSERT INTO round_participants (id,round_id,match_participant_id,present,stats_evidence_status,score,loadout_evidence_status,loadout_value,weapon_evidence_status,weapon_id,weapon_name,armor_evidence_status)', rps, 12);
  await insertRows(db, 'INSERT INTO kill_events (id,source_match_id,round_id,event_lookup_hmac,event_sequence,time_in_round_ms,killer_participant_id,victim_participant_id,weapon_id,weapon_name)', kills, 10);
}

/** The same scenario as engine facts (memberOf maps an account to its member's public id). */
function facts(matches: Match[], memberOf: (account: number) => string, visible: (account: number) => boolean = () => true): WeaponMatchFact[] {
  return matches.flatMap((m) => m.seats.filter((seat) => visible(seat.account)).map((seat): WeaponMatchFact => ({
    memberId: memberOf(seat.account), accountId: uuid(2, seat.account), matchId: uuid(6, m.n), map: m.map ?? 'Ascent', agent: seat.agent ?? 'Jett',
    act: m.season === undefined ? 'e11a5' : m.season ?? 'unknown', startedAt: new Date(anchor - m.hoursAgo * 3_600_000).toISOString(),
    rounds: m.winners.flatMap((winner, r) => ((seat.absent ?? []).includes(r) ? [] : [{
      won: winner === null ? null : winner === (seat.team ?? 'Blue'),
      weaponStatus: (seat.weapons[r] === 'missing' || seat.weapons[r] === 'unavailable' || seat.weapons[r] === undefined ? (seat.weapons[r] ?? 'missing') : 'observed') as 'observed' | 'missing' | 'unavailable',
      weaponId: Array.isArray(seat.weapons[r]) ? (seat.weapons[r] as Weapon)[0] : null, weaponName: Array.isArray(seat.weapons[r]) ? (seat.weapons[r] as Weapon)[1] : null,
      loadoutStatus: (seat.loadouts?.[r] ?? null) === null ? 'missing' as const : 'observed' as const, loadoutValue: seat.loadouts?.[r] ?? null,
      statsStatus: (seat.scores?.[r] ?? null) === null ? 'missing' as const : 'observed' as const, score: seat.scores?.[r] ?? null,
    }])),
    kills: (seat.kills ?? []).map((kill) => ({ weaponId: kill.weapon?.[0] ?? null, weaponName: kill.weapon?.[1] ?? null })),
  })));
}

const service = (db: SqlDatabase) => new WeaponAnalyticsService(db, new ServerAnalysisService(db, new DatasetProjectionService(new PostgresDatasetReadRepository(db))));
const req = (partial: Partial<WeaponRequest>): WeaponRequest => ({ player: 'all', scope: 'all', map: 'all', agent: 'all', mode: 'Competitive', ...partial });
const weapon = (result: { weapons: { weaponKey: string }[] }, key: string) => result.weapons.find((w) => w.weaponKey === key) as Record<string, unknown> | undefined;

describe('weapon-analytics-v1 exact formulas (hand calculated)', () => {
  it('computes usage, kill, per-100-round, win-rate, score and loadout metrics exactly', async () => {
    const db = await database([1]);
    // 5 rounds: Vandal R1-R3 (won, won, lost), Operator R4 (lost), R5 weapon missing.
    const m: Match = { n: 1, hoursAgo: 1, winners: ['Blue', 'Blue', 'Red', 'Red', 'Blue'], seats: [{ account: 1, weapons: [V, V, V, O, 'missing'],
      scores: [200, 100, 0, 300, 50], loadouts: [3900, 4000, null, 5700, 800], kills: [{ round: 0, weapon: V }, { round: 1, weapon: V }, { round: 3, weapon: O }, { round: 4, weapon: S }, { round: 4, weapon: null }] }] };
    await seed(db, [m]);
    const { payload } = await service(db).analyze(req({ player: uuid(2, 1) }));
    const member = payload.member!;
    expect(member.coverage).toEqual({ roundWeapon: { observed: 4, eligible: 5, coverage: 0.8, status: 'partial' }, killWeapon: { weaponLabeledKills: 4, eligibleKillEvents: 5, coverage: 0.8, status: 'partial' },
      loadout: { observed: 4, eligible: 5, coverage: 0.8, status: 'partial' }, lifetimeComplete: false });
    expect(weapon(member, 'vandal')).toMatchObject({ weaponName: 'Vandal', category: 'Rifle', isFirearm: true, observedWeaponRounds: 3, observedWeaponRoundShare: 0.75, matchesWithWeaponObservation: 1,
      roundWinsWhenWeaponObserved: 2, roundLossesWhenWeaponObserved: 1, roundWinRateWhenObserved: 2 / 3, avgRoundScoreWhenObserved: 100, avgLoadoutValueWhenObserved: 3950,
      weaponKills: 2, weaponKillShare: 0.5, matchesWithWeaponKill: 1, weaponKillsPer100PlayedRounds: 40 });
    expect(weapon(member, 'operator')).toMatchObject({ category: 'Sniper', observedWeaponRounds: 1, observedWeaponRoundShare: 0.25, roundWinRateWhenObserved: 0, avgRoundScoreWhenObserved: 300, weaponKills: 1, weaponKillShare: 0.25, weaponKillsPer100PlayedRounds: 20 });
    expect(weapon(member, 'sheriff')).toMatchObject({ category: 'Sidearm', observedWeaponRounds: 0, weaponKills: 1, weaponKillShare: 0.25 });
    // Never observed as a round weapon while 4 rounds were observed: a true 0 share, not missing evidence.
    expect(weapon(member, 'sheriff')).toMatchObject({ observedWeaponRoundShare: 0 });
    expect(weapon(member, 'sheriff')).not.toHaveProperty('roundWinRateWhenObserved');
    expect(JSON.stringify(payload)).not.toMatch(/NaN|Infinity/u);
    expect(payload.unsupported.weaponHeadshotPercentage.status).toBe('unavailable');
    expect(payload.unsupported.attackDefenseSplit.status).toBe('unavailable');
    expect(member.weapons.every((w) => !('headshotPercentage' in w) && !('adr' in w))).toBe(true);
  });
});

describe('evidence variants, canonicalization and categories', () => {
  it('keeps missing/unavailable rounds out of usage, merges id/name forms, and separates firearms from other kill methods', async () => {
    const db = await database([1]);
    await seed(db, [{ n: 1, hoursAgo: 1, winners: ['Blue', 'Red', 'Blue', 'Blue', 'Red', null], seats: [{ account: 1,
      weapons: [V, ['vandal-id', null], [null, 'Vandal'], 'unavailable', ['mystery-weapon-id', null], ['PHANTOM-ID', 'Phantom']],
      kills: [{ round: 0, weapon: ['vandal-id', null] }, { round: 1, weapon: [null, 'Melee'] }, { round: 2, weapon: ['ability-x', 'Showstopper'] }, { round: 3, weapon: null }, { round: 4, weapon: ['mystery-weapon-id', null] }] }] }]);
    const { payload } = await service(db).analyze(req({ player: uuid(2, 1) }));
    const member = payload.member!;
    expect(member.coverage.roundWeapon).toMatchObject({ observed: 5, eligible: 6 });
    expect(weapon(member, 'vandal')).toMatchObject({ observedWeaponRounds: 3, weaponKills: 1, matchesWithWeaponObservation: 1 });
    expect(weapon(member, 'phantom')).toMatchObject({ observedWeaponRounds: 1, roundWinsWhenWeaponObserved: 0, roundLossesWhenWeaponObserved: 0 });
    expect(weapon(member, 'phantom')).not.toHaveProperty('roundWinRateWhenObserved');
    expect(weapon(member, 'melee')).toMatchObject({ category: 'Melee', isFirearm: false, weaponKills: 1 });
    const unknown = member.weapons.filter((w) => w.weaponKey.startsWith('x-'));
    expect(unknown.map((w) => [w.weaponName, w.category, w.isFirearm]).sort()).toEqual([['Showstopper', 'Other', false], ['未知武器', 'Other', false]]);
    expect(JSON.stringify(payload)).not.toContain('mystery-weapon-id');
    expect(member.coverage.killWeapon).toMatchObject({ weaponLabeledKills: 4, eligibleKillEvents: 5 });
  });

  it('reports no weapon evidence as unavailable, never as zero usage, and zero kills as zero', async () => {
    const db = await database([1, 2]);
    await seed(db, [{ n: 1, hoursAgo: 1, winners: ['Blue', 'Red'], seats: [{ account: 1, weapons: ['missing', 'unavailable'] }, { account: 2, weapons: [V, V] }] }]);
    const { payload } = await service(db).analyze(req({ player: uuid(2, 1) }));
    expect(payload.member!.coverage.roundWeapon).toEqual({ observed: 0, eligible: 2, coverage: 0, status: 'unavailable' });
    expect(payload.member!.coverage.killWeapon).toEqual({ weaponLabeledKills: 0, eligibleKillEvents: 0, status: 'unavailable' });
    expect(payload.member!.weapons).toEqual([]);
    expect(payload.member).not.toHaveProperty('mostUsed');
    const other = payload.members.find((m) => m.memberId === uuid(2, 2))!;
    expect(other.weapons[0]).toMatchObject({ weaponKey: 'vandal', weaponKills: 0, weaponKillsPer100PlayedRounds: 0, status: 'partial', reasons: ['small_sample'] });
    expect(other.weapons[0]).not.toHaveProperty('weaponKillShare');
  });
});

/** Member A = accounts 1 (Vandal-heavy) + 2 (Operator-heavy); member B = account 3. */
function multiMatches(): Match[] {
  return Array.from({ length: 30 }, (_, i): Match => {
    const n = i + 1;
    const a = n % 3 === 0 ? 2 : 1;
    const winners: ('Blue' | 'Red')[] = Array.from({ length: 8 }, (_v, r) => ((n + r) % 3 === 0 ? 'Red' : 'Blue'));
    return { n, hoursAgo: i * 8, map: ['Ascent', 'Bind', 'Haven'][n % 3], season: n <= 20 ? 'e11a5' : 'e11a4', winners, seats: [
      { account: a, agent: a === 2 ? 'Jett' : 'Sova', weapons: winners.map((_w, r) => (a === 1 ? (r % 4 === 0 ? S : V) : (r % 2 === 0 ? O : S))),
        scores: winners.map((_w, r) => 100 + r * 10), loadouts: winners.map((_w, r) => 3000 + r * 100), kills: Array.from({ length: a === 1 ? 4 : 3 }, (_k, k) => ({ round: k, weapon: a === 1 ? V : O })) },
      ...(n % 2 === 0 ? [{ account: 3, agent: 'Omen', team: 'Red' as const, weapons: winners.map(() => ['phantom-id', 'Phantom'] as Weapon), kills: [{ round: 1, weapon: ['phantom-id', 'Phantom'] as Weapon }] }] : []),
    ] };
  });
}

describe('member aggregation, consent and identity safety', () => {
  async function linked() {
    const db = await database([1, 2, 3]);
    await seed(db, multiMatches());
    await new MemberAdminService(db).linkAccount(uuid(2, 2), uuid(2, 1));
    return db;
  }
  const memberOf = (account: number) => (account === 2 ? uuid(2, 1) : uuid(2, account));

  it('combines both accounts BEFORE aggregation (union, not an average) and equals the facts engine exactly', async () => {
    const db = await linked();
    const { payload } = await service(db).analyze(req({ player: uuid(2, 1) }));
    const scope = payload.scope;
    const local = buildWeaponAnalytics(aggregateWeaponFacts(facts(multiMatches(), memberOf)), { memberIds: [uuid(2, 1), uuid(2, 3)], memberId: uuid(2, 1), scope });
    expect(JSON.parse(JSON.stringify({ members: payload.members, member: payload.member }))).toEqual(JSON.parse(JSON.stringify({ members: local.members, member: local.member })));
    const member = payload.member!;
    expect(payload.members.map((m) => m.memberId)).toEqual([uuid(2, 1), uuid(2, 3)]);
    expect(weapon(member, 'vandal')).toMatchObject({ observedWeaponRounds: 20 * 6, weaponKills: 20 * 4 });
    expect(weapon(member, 'operator')).toMatchObject({ observedWeaponRounds: 10 * 4, weaponKills: 10 * 3 });
    expect(member.accounts.map((a) => [a.accountId, a.playedRounds, a.weaponLabeledKills])).toEqual([[uuid(2, 1), 160, 80], [uuid(2, 2), 80, 30]]);
    // Union share != average of per-account shares.
    const unionShare = weapon(member, 'vandal')!.observedWeaponRoundShare as number;
    expect(unionShare).toBeCloseTo(120 / 240, 10);
    expect(unionShare).not.toBeCloseTo((120 / 160 + 0 / 80) / 2, 6);
    expect(member.mostUsed).toBe('vandal');
    expect(member.mostKills).toBe('vandal');
    expect(member.breakdowns.agents.map((row) => [row.value, row.playedRounds])).toEqual([['Sova', 160], ['Jett', 80]]);
    expect(weapon(member.breakdowns.agents.find((row) => row.value === 'Jett')!, 'operator')).toMatchObject({ observedWeaponRounds: 40, observedWeaponRoundShare: 0.5 });
    expect(member.breakdowns.acts.map((row) => row.value).sort()).toEqual(['e11a4', 'e11a5']);
    expect(member.breakdowns.maps.map((row) => row.value).sort()).toEqual(['Ascent', 'Bind', 'Haven']);
  }, 60_000);

  it('revoking one linked account removes only its weapon rounds and kills; the member stays', async () => {
    const db = await linked();
    await db.query("UPDATE consents SET status='revoked', revoked_at=now() WHERE player_id=$1", [uuid(1, 2)]);
    const { payload } = await service(db).analyze(req({ player: uuid(2, 1) }));
    expect(payload.members.map((m) => m.memberId)).toEqual([uuid(2, 1), uuid(2, 3)]);
    expect(weapon(payload.member!, 'operator')).toBeUndefined();
    expect(weapon(payload.member!, 'vandal')).toMatchObject({ observedWeaponRounds: 120, weaponKills: 80 });
    expect(payload.member!.accounts.map((a) => a.accountId)).toEqual([uuid(2, 1)]);
    expect(JSON.stringify(payload)).not.toContain(uuid(2, 2));
  }, 60_000);

  it('withholds a same-match member collision instead of double counting', async () => {
    const db = await database([1, 2]);
    await seed(db, [{ n: 1, hoursAgo: 1, winners: ['Blue'], seats: [{ account: 1, weapons: [V], kills: [{ round: 0, weapon: V }] }, { account: 2, team: 'Red', weapons: [O], kills: [{ round: 0, weapon: O }] }] },
      { n: 2, hoursAgo: 2, winners: ['Blue'], seats: [{ account: 1, weapons: [V] }] }]);
    await db.query('UPDATE players SET member_id=$1, is_primary_account=false WHERE id=$2', [uuid(1, 1), uuid(1, 2)]);
    const { payload } = await service(db).analyze(req({ player: uuid(2, 1) }));
    expect(payload.member!.coverage.roundWeapon.eligible).toBe(1);
    expect(payload.member!.weapons.map((w) => w.weaponKey)).toEqual(['vandal']);
    expect(payload.member!.coverage.killWeapon.eligibleKillEvents).toBe(0);
  });

  it('exposes only public member/account ids — no internal ids, hmacs or provider weapon ids', async () => {
    const db = await linked();
    const text = JSON.stringify((await service(db).analyze(req({ player: uuid(2, 1) }))).payload);
    for (const secret of [uuid(1, 1), uuid(1, 2), uuid(1, 3), hex(1), 'lookup_hmac', 'puuid', 'vandal-id', 'operator-id', 'participant', 'member_id']) expect(text).not.toContain(secret);
  }, 60_000);
});

describe('scopes and filters', () => {
  it('filters by map, agent, Act and Competitive by default; unknown Act is unavailable without fallback', async () => {
    const db = await database([1]);
    await seed(db, [
      { n: 1, hoursAgo: 1, map: 'Ascent', season: 'e11a5', winners: ['Blue', 'Blue'], seats: [{ account: 1, agent: 'Jett', weapons: [O, O] }] },
      { n: 2, hoursAgo: 2, map: 'Bind', season: 'e11a4', winners: ['Blue', 'Blue'], seats: [{ account: 1, agent: 'Sova', weapons: [V, V] }] },
      { n: 3, hoursAgo: 3, map: 'Bind', season: null, winners: ['Blue'], seats: [{ account: 1, agent: 'Sova', weapons: [V] }] },
      { n: 4, hoursAgo: 4, map: 'Bind', queue: 'deathmatch', winners: ['Blue', 'Blue', 'Blue'], seats: [{ account: 1, agent: 'Sova', weapons: [S, S, S] }] },
    ]);
    const run = async (partial: Partial<WeaponRequest>) => (await service(db).analyze(req({ player: uuid(2, 1), ...partial }))).payload;
    expect((await run({})).member!.coverage.roundWeapon.eligible).toBe(5);
    // weapon-analytics-v2: 'all' means every ELIGIBLE mode (Competitive); Deathmatch never contributes.
    expect((await run({ mode: 'all' })).member!.coverage.roundWeapon.eligible).toBe(5);
    const excluded = await run({ mode: 'Deathmatch' });
    expect(excluded.member?.coverage.roundWeapon.eligible ?? 0).toBe(0);
    expect(excluded.scope.reasons).toContain('queue_excluded_by_policy');
    expect((await run({ map: 'Ascent' })).member!.weapons.map((w) => w.weaponKey)).toEqual(['operator']);
    expect((await run({ agent: 'Sova' })).member!.weapons.map((w) => [w.weaponKey, w.observedWeaponRounds])).toEqual([['vandal', 3]]);
    const act = await run({ scope: 'act', act: 'e11a4' });
    expect(act.member!.weapons.map((w) => [w.weaponKey, w.observedWeaponRounds])).toEqual([['vandal', 2]]);
    expect(act.member!.breakdowns.acts.map((row) => row.value)).toEqual(['e11a4']);
    const all = await run({});
    expect(all.member!.breakdowns.acts.map((row) => row.value).sort()).toEqual(['e11a4', 'e11a5', 'unknown']);
    const missing = await run({ scope: 'act', act: 'e9a1' });
    expect(missing.scope).toMatchObject({ mode: 'act', status: 'unavailable', reasons: ['act_not_observed'] });
    expect(missing.member!.weapons).toEqual([]);
    expect((await run({ map: 'Lotus' })).scope.status).toBe('unavailable');
  });

  it('CURRENT uses the server currentStrength adaptive selection; an older match outside it changes nothing', async () => {
    const db = await database([1]);
    const recent = Array.from({ length: 40 }, (_, i): Match => ({ n: i + 1, hoursAgo: i * 20, winners: Array.from({ length: 20 }, () => 'Blue' as const), seats: [{ account: 1, weapons: Array.from({ length: 20 }, () => V), kills: [{ round: 0, weapon: V }] }] }));
    await seed(db, recent);
    const current = (await service(db).analyze(req({ player: uuid(2, 1), scope: 'current' }))).payload;
    expect(current.scope.reasons).toContain('current_strength_adaptive_window');
    const all = (await service(db).analyze(req({ player: uuid(2, 1) }))).payload;
    expect(current.member!.coverage.roundWeapon.eligible).toBeLessThan(all.member!.coverage.roundWeapon.eligible);
    await seed(db, [{ n: 99, hoursAgo: 24 * 120, winners: ['Blue'], seats: [{ account: 1, weapons: [O], kills: [{ round: 0, weapon: O }] }] }]);
    const again = (await service(db).analyze(req({ player: uuid(2, 1), scope: 'current' }))).payload;
    expect(JSON.stringify(again.member)).toEqual(JSON.stringify(current.member));
    expect(weapon((await service(db).analyze(req({ player: uuid(2, 1) }))).payload.member!, 'operator')).toMatchObject({ observedWeaponRounds: 1 });
  }, 60_000);

  it('rejects client-chosen sample sizes and malformed scopes', () => {
    expect(parseWeaponRequest({ feature: 'weaponAnalytics' })).toEqual({ player: 'all', scope: 'all', map: 'all', agent: 'all', mode: 'Competitive' });
    for (const bad of [{ recent: '10' }, { limit: '50' }, { scope: 'recent30' }, { scope: 'act' }, { scope: 'all', act: 'e11a5' }, { player: 'not-a-uuid' }, { from: '2026-01-01' }]) {
      expect(() => parseWeaponRequest({ feature: 'weaponAnalytics', ...bad })).toThrow();
    }
  });
});

describe('history beyond the snapshot and the 2000-match analysis bound', () => {
  it('ALL TRACKED aggregates every eligible match (2100 > 300 and > 2000) with fixed SQL statements', async () => {
    const db = await database([1]);
    const many = Array.from({ length: 2100 }, (_, i): Match => ({ n: i + 1, hoursAgo: i, winners: ['Blue', 'Red'], seats: [{ account: 1, weapons: i >= 2000 ? [O, O] : [V, V], kills: [{ round: 0, weapon: i >= 2000 ? O : V }] }] }));
    await seed(db, many);
    const { payload, metrics } = await service(db).analyze(req({ player: uuid(2, 1) }));
    expect(payload.member!.coverage.roundWeapon.eligible).toBe(4200);
    expect(weapon(payload.member!, 'operator')).toMatchObject({ observedWeaponRounds: 200, weaponKills: 100, matchesWithWeaponObservation: 100 });
    expect(weapon(payload.member!, 'vandal')).toMatchObject({ observedWeaponRounds: 4000, weaponKills: 2000 });
    expect(payload.member!.matches).toBe(2100);
    expect(payload.scope.status).toBe('available');
    expect(metrics.sqlQueryCount).toBe(4);
    expect(JSON.stringify(payload).length).toBeLessThan(20_000);
  }, 120_000);
});
