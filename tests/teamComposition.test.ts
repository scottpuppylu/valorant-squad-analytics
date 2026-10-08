import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FitModel, FIT_SHRINK_K } from '../src/analytics/teamComposition/fit';
import { evaluateIndividual, partition, shrunkMapSynergy, splitTime, teamUnits, type PairSynergySource } from '../src/analytics/teamComposition/holdout';
import { buildObservations, type MemberObservation } from '../src/analytics/teamComposition/observations';
import { recommendTeamComposition, TeamCompositionInputError, TeamCompositionModel } from '../src/analytics/teamComposition/recommend';
import { assignResponsibilities, BehaviourModel } from '../src/analytics/teamComposition/responsibility';
import type { MatchRecord, PlayerRole } from '../src/types/valorant';
import { agentRoles } from '../src/utils/agentRoles';

/** TASK-ANALYTICS-TEAM-COMPOSITION-01 — synthetic groups only (no network, no database, no real names). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MAPS = ['Ascent', 'Bind', 'Lotus'];
interface Spec { member: number; agent: string; map: string; perf: number; won?: boolean; t: number; match?: string; fk?: number; fd?: number; trade?: number; assists?: number }
const obs = (s: Spec): MemberObservation => ({
  memberId: id(s.member), matchId: s.match ?? `m${s.t}`, playedAt: new Date(Date.UTC(2026, 0, 1) + s.t * 3_600_000).toISOString(), map: s.map, agent: s.agent,
  role: agentRoles[s.agent], agentKnown: agentRoles[s.agent] !== undefined, rounds: 22, won: s.won ?? s.perf > 55, roundDiff: s.perf > 55 ? 4 : -4, performance: s.perf, firepower: s.perf,
  behaviour: { firstKills: s.fk ?? 2, firstDeaths: s.fd ?? 2, tradeKills: s.trade ?? 2, tradeAssists: 1, kastRate: 0.7, assists: s.assists ?? 5, clutchAttempts: 1, clutchWins: 0, deaths: 15 },
});

/** Six members, each with clear best agents; member 1 is much better on Omen on Bind specifically. */
function group(): MemberObservation[] {
  const plan: [number, string[]][] = [[1, ['Omen', 'Jett', 'Sova']], [2, ['Jett', 'Raze', 'Killjoy']], [3, ['Sova', 'Fade', 'Omen']],
    [4, ['Killjoy', 'Cypher', 'Sage']], [5, ['Reyna', 'Jett', 'Viper']], [6, ['Brimstone', 'Skye', 'Sage']]];
  const out: MemberObservation[] = [];
  let t = 0;
  for (let round = 0; round < 12; round += 1) for (const [member, agents] of plan) for (const [i, agent] of agents.entries()) {
    const map = MAPS[(round + i) % 3]!;
    t += 1;
    const bonus = member === 1 && agent === 'Omen' && map === 'Bind' ? 30 : member === 1 && agent === 'Jett' && map !== 'Bind' ? 25 : 0;
    out.push(obs({ member, agent, map, perf: 50 + member + (2 - i) * 6 + bonus + ((t * 7) % 5) - 2, t,
      fk: agent === 'Jett' || agent === 'Reyna' ? 4 : 1, fd: agent === 'Jett' || agent === 'Reyna' ? 3 : 1, trade: agent === 'Raze' ? 5 : 1, assists: agent === 'Sova' ? 12 : 4 }));
  }
  return out;
}
const five = [1, 2, 3, 4, 5].map(id);

describe('input validation', () => {
  const model = new TeamCompositionModel(group());
  it('requires exactly five distinct members and a map', () => {
    expect(() => recommendTeamComposition({ memberIds: five.slice(0, 4), map: 'Ascent' }, model)).toThrow(TeamCompositionInputError);
    expect(() => recommendTeamComposition({ memberIds: [...five.slice(0, 4), five[0]!], map: 'Ascent' }, model)).toThrow(TeamCompositionInputError);
    expect(() => recommendTeamComposition({ memberIds: five, map: '' }, model)).toThrow(TeamCompositionInputError);
  });
  it('never assigns the same agent twice; unknown agents are excluded; result carries the claim boundary', () => {
    const withUnknown = [...group(), ...Array.from({ length: 30 }, (_, i) => obs({ member: 1, agent: 'Unknown', map: 'Ascent', perf: 99, t: 1000 + i }))];
    const result = recommendTeamComposition({ memberIds: five, map: 'Ascent' }, new TeamCompositionModel(withUnknown));
    for (const lineup of result.lineups) {
      expect(new Set(lineup.members.map((m) => m.agent)).size).toBe(5);
      expect(lineup.members.some((m) => m.agent === 'Unknown')).toBe(false);
    }
    expect(result.boundary).toEqual({ positionClaims: false, siteClaims: false, causalClaim: false, liveOpponentScouting: false });
  });
  it('a member without Competitive agent evidence yields insufficient_evidence (no invented agent)', () => {
    const result = recommendTeamComposition({ memberIds: [...five.slice(0, 4), id(99)], map: 'Ascent' }, model);
    expect(result.status).toBe('insufficient_evidence');
    expect(result.lineups).toEqual([]);
  });
});

describe('determinism and evidence hierarchy', () => {
  it('is deterministic and independent of member and observation order', () => {
    const a = recommendTeamComposition({ memberIds: five, map: 'Bind' }, new TeamCompositionModel(group()));
    const b = recommendTeamComposition({ memberIds: [...five].reverse(), map: 'Bind' }, new TeamCompositionModel([...group()].reverse()));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it('shrinks thin cells toward the level above (n/(n+8)); no evidence = exactly the parent level; levels are exposed', () => {
    const model = new FitModel(group());
    const thin = new FitModel([obs({ member: 1, agent: 'Omen', map: 'Ascent', perf: 90, t: 1 }), obs({ member: 1, agent: 'Jett', map: 'Ascent', perf: 50, t: 2 })]);
    const f = thin.fit(id(1), 'Omen', 'Ascent', 'performance');
    expect(f.samples.agent).toBe(1);
    expect(f.components!.agentFit).toBeGreaterThan(0);
    expect(Math.abs(f.components!.agentFit)).toBeLessThan(40 / (1 + FIT_SHRINK_K) + 1e-9);
    const unseen = model.fit(id(1), 'Viper', 'Ascent', 'performance');
    expect(unseen.samples.agent).toBe(0);
    expect(unseen.evidenceLevel).toBe('role_map'); // Controller evidence on this map (via Omen), no Viper history
    expect(unseen.components!.agentFit).toBe(0);
    expect(model.fit(id(1), 'Omen', 'Bind', 'performance').evidenceLevel).toBe('agent_map');
  });
  it('confidence grows with direct agent evidence and stays separate from the value', () => {
    const model = new TeamCompositionModel(group());
    const rich = model.memberConfidence(model.fit.fit(id(1), 'Omen', 'Bind', 'performance'));
    const none = model.memberConfidence(model.fit.fit(id(1), 'Viper', 'Bind', 'performance'));
    expect(rich).toBeGreaterThan(none);
    expect(none).toBe(0);
  });
});

describe('map specificity', () => {
  it('context mode (validated default) does not score map; research mode can return different agents by map', () => {
    const data = group();
    const scored = new TeamCompositionModel(data, undefined, { mapEvidence: 'scored' });
    const pick = (map: string, model: TeamCompositionModel) => recommendTeamComposition({ memberIds: five, map }, model).lineups[0]!.members.find((m) => m.memberId === id(1))!.agent;
    expect(pick('Bind', scored)).toBe('Omen');
    expect(pick('Ascent', scored)).toBe('Jett');
    const context = new TeamCompositionModel(data);
    const fitBind = context.fit.fit(id(1), 'Omen', 'Bind', 'performance').value; const fitAscent = context.fit.fit(id(1), 'Omen', 'Ascent', 'performance').value;
    expect(fitBind).toBe(fitAscent); // map is context only in the default mode
  });
});

describe('pair synergy, role coverage and responsibilities', () => {
  it('map-scoped pair synergy shrinks toward global and falls back cleanly', () => {
    const source: PairSynergySource = { global: () => ({ value: 50, matches: 30 }), onMap: (_a, _b, map) => (map === 'Bind' ? { value: 90, matches: 2 } : { value: null, matches: 0 }) };
    expect(shrunkMapSynergy(source, 'a', 'b', 'Bind')).toBeCloseTo((2 * 90 + 8 * 50) / 10);
    expect(shrunkMapSynergy(source, 'a', 'b', 'Ascent')).toBe(50);
    const result = recommendTeamComposition({ memberIds: five, map: 'Bind' }, new TeamCompositionModel(group(), source));
    expect(result.lineups[0]!.pairSynergy).toMatchObject({ pairs: 10, withEvidence: 10 });
  });
  it('reports the role distribution of every lineup without forcing a template', () => {
    const lineup = recommendTeamComposition({ memberIds: five, map: 'Ascent' }, new TeamCompositionModel(group())).lineups[0]!;
    const total = Object.values(lineup.roleDistribution).reduce((s, v) => s + v, 0);
    expect(total).toBe(5);
    for (const m of lineup.members) expect(lineup.roleDistribution[m.role]).toBeGreaterThan(0);
  });
  it('responsibilities come from behaviour, not agent class; insufficient evidence gives no label', () => {
    const data = group();
    // Member 6 plays a Duelist only twice: no PRIMARY_ENTRY can be claimed from agent class alone.
    data.push(obs({ member: 6, agent: 'Neon', map: 'Ascent', perf: 60, t: 5000, fk: 0, fd: 0 }), obs({ member: 6, agent: 'Neon', map: 'Bind', perf: 60, t: 5001, fk: 0, fd: 0 }));
    const behaviour = new BehaviourModel(data);
    const slots: { memberId: string; role: PlayerRole }[] = [{ memberId: id(2), role: 'Duelist' }, { memberId: id(6), role: 'Duelist' }, { memberId: id(3), role: 'Initiator' },
      { memberId: id(4), role: 'Sentinel' }, { memberId: id(1), role: 'Controller' }];
    const result = assignResponsibilities(behaviour, slots);
    expect(result.find((r) => r.memberId === id(6))!.responsibility).toBeNull();
    expect(result.filter((r) => r.responsibility === 'PRIMARY_ENTRY')).toHaveLength(1);
    expect(result.find((r) => r.responsibility === 'PRIMARY_ENTRY')!.memberId).toBe(id(2));
    expect(result.every((r) => r.evidence.length > 0)).toBe(true);
  });
});

describe('observations: mode policy, multi-account member, unknown agents', () => {
  const match = (mode: string, performances: { playerId: string; agent: string }[], n: number): MatchRecord => ({ id: `x${n}`, playedAt: new Date(Date.UTC(2026, 1, n)).toISOString(),
    map: 'Ascent', gameMode: mode, opponent: 'x', scoreFor: 13, scoreAgainst: 9, won: true, durationMinutes: 40,
    performances: performances.map((p) => ({ ...p, kills: 18, deaths: 14, assists: 5, acs: 230, adr: 150, teamWon: true, teamGroup: 'A' })) });
  it('Competitive only; one observation per member per match even with two accounts; unknown agents carry no role', () => {
    const list = buildObservations([
      match('Competitive', [{ playerId: id(1), agent: 'Jett' }, { playerId: id(1), agent: 'Omen' }, { playerId: id(2), agent: 'Unknown' }], 1),
      match('Unrated', [{ playerId: id(1), agent: 'Jett' }], 2), match('Deathmatch', [{ playerId: id(1), agent: 'Jett' }], 3),
    ]);
    expect(list.map((o) => o.memberId)).toEqual([id(1), id(2)]);
    expect(list.find((o) => o.memberId === id(2))).toMatchObject({ role: undefined, agentKnown: false });
  });
});

describe('holdout: chronological, match-level, no leakage', () => {
  it('every observation of one match falls on one side; train never sees test matches', () => {
    const data = group().map((o, i) => ({ ...o, matchId: `shared${Math.floor(i / 3)}`, playedAt: group()[Math.floor(i / 3) * 3]!.playedAt }));
    const split = splitTime(data, 0.7);
    const { train, test } = partition(data, split);
    const trainMatches = new Set(train.map((o) => o.matchId));
    expect(test.some((o) => trainMatches.has(o.matchId))).toBe(false);
    expect(train.every((o) => o.playedAt < split) && test.every((o) => o.playedAt >= split)).toBe(true);
  });
  it('future evidence cannot change an earlier estimate', () => {
    const data = group();
    const split = splitTime(data, 0.5);
    const { train } = partition(data, split);
    const future = [...train, ...data.filter((o) => o.playedAt >= split).map((o) => ({ ...o, performance: 0 }))];
    expect(new FitModel(train).fit(id(1), 'Omen', 'Bind', 'performance')).toEqual(new FitModel(future.filter((o) => o.playedAt < split)).fit(id(1), 'Omen', 'Bind', 'performance'));
  });
  it('the agent-level fit carries signal beyond the member baseline on a synthetic agent effect', () => {
    const data = group();
    const { train, test } = partition(data, splitTime(data, 0.6));
    const agent = evaluateIndividual(train, test).find((e) => e.channel === 'performance' && e.model === 'agent_no_map')!;
    expect(agent.incrementalCorrelation!).toBeGreaterThan(0.3);
    expect(teamUnits(test, 1).length).toBeGreaterThan(0);
  });
});

describe('architecture boundary', () => {
  it('no hard-coded member names, no rank multiplier, no position claims in the team composition modules', async () => {
    const dir = resolve('src/analytics/teamComposition');
    // TASK-ANALYTICS-TEAM-COMPOSITION-02 authorizes position evidence ONLY in the V2 site/side modules (own boundary below).
    const v2Modules = new Set(['siteReference.ts', 'sideEvidence.ts', 'v2.ts']);
    for (const file of await readdir(dir)) {
      const source = await readFile(join(dir, file), 'utf8');
      expect(source, file).not.toMatch(/jack|走路|魔王|滑鏟|天堂|加分|夏天|滑板車|小麻花/u);
      expect(source, file).not.toMatch(/tierOrdinal|rankMultiplier|RANK_WEIGHT/u);
      if (!v2Modules.has(file)) expect(source, file).not.toMatch(/coordinates|location_x|plant_site/u);
    }
  });
  it('V2 site/side modules: no callout vocabulary, routes or external map metadata', async () => {
    for (const file of ['siteReference.ts', 'sideEvidence.ts', 'v2.ts']) {
      const source = await readFile(join(resolve('src/analytics/teamComposition'), file), 'utf8');
      expect(source, file).not.toMatch(/heaven|garage|market|hookah|\bA long\b|\bB long\b|back site|\bCT\b|valorant-api|xMultiplier|yScalarToAdd/iu);
    }
  });
});
