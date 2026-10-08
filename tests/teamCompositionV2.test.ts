import { describe, expect, it } from 'vitest';
import type { TeamCompositionResult } from '../src/analytics/teamComposition/recommend';
import { memberRounds, type KillInput, type MatchInput, type RoundInput } from '../src/analytics/teamComposition/sideEvidence';
import { SiteReference, type PlantPoint } from '../src/analytics/teamComposition/siteReference';
import { binomialTail, refineTeamComposition, SideModel, V2_VALIDATION, type V2Validation } from '../src/analytics/teamComposition/v2';
import { agentRoles } from '../src/utils/agentRoles';

/** TASK-ANALYTICS-TEAM-COMPOSITION-02 — synthetic matches only (no network, no database, no real names or coordinates). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = { x: 1234.5, y: -6789.25 }; const B = { x: 9234.5, y: -6789.25 }; const FAR = { x: 5234.5, y: 3000 };
const ring = (c: { x: number; y: number }, n: number, r = 300) => Array.from({ length: n }, (_, i) => ({ x: c.x + (r * ((i % 10) + 1) / 10) * Math.cos(i), y: c.y + (r * ((i % 10) + 1) / 10) * Math.sin(i) }));
const plants = (map: string): PlantPoint[] => [...ring(A, 30).map((p) => ({ map, site: 'A', ...p })), ...ring(B, 30).map((p) => ({ map, site: 'B', ...p }))];
const REF = new SiteReference([...plants('Ascent'), ...plants('Bind')]);
const FULL: V2Validation = { ATTACK: ['firstContact', 'trade', 'assists', 'survival', 'plant', 'postPlant'], DEFENSE: ['firstContact', 'assists', 'clutch', 'sitePresence'], siteTendency: true };

const RED = ['p1', 'p2', 'p3', 'p4', 'p5'] as const; const BLUE = ['o1', 'o2', 'o3', 'o4', 'o5'] as const;
const AGENTS: Record<string, string> = { p1: 'Jett', p2: 'Raze', p3: 'Sova', p4: 'Killjoy', p5: 'Omen' };
const snap = (participant: string, at: { x: number; y: number }) => ({ participant, x: at.x, y: at.y });
const kill = (t: number, killer: string, victim: string, assistants: string[] = [], snapshots: KillInput['snapshots'] = []): KillInput => ({ t, killer, victim, assistants, snapshots });
interface Opts { planter?: string; assistant?: string; attackDeaths?: string[]; clutch?: boolean; side?: boolean; defenseRounds?: number }

/** One synthetic match: 4 attack rounds, `defenseRounds` defense rounds and 1 unknown-side round for the tracked Red team. */
function match(i: number, map = 'Ascent', o: Opts = {}): MatchInput {
  const teams = new Map<string, string>([...RED.map((p) => [p, 'Red'] as [string, string]), ...BLUE.map((p) => [p, 'Blue'] as [string, string])]);
  const members = new Map(RED.map((p, k) => [p, { memberId: id(k + 1), agent: AGENTS[p]! }]));
  const rounds: RoundInput[] = []; let n = 0;
  const planter = o.planter ?? 'p5';
  for (let r = 0; r < 4; r += 1) rounds.push({ number: ++n, attackingTeamKey: o.side === false ? undefined : 'Red', winningTeam: 'Red', plantSite: 'A', plantTimeMs: 10_000, planter, kills: [
    kill(1000, 'p1', 'o1', [o.assistant ?? 'p3'], [snap('p2', FAR), snap('p3', FAR), snap('p4', FAR), snap('p5', FAR)]),
    kill(2000, 'o2', 'p4'), kill(3000, 'p2', 'o2'),
    ...(o.attackDeaths ?? []).map((v, j) => kill(4000 + 100 * j, 'o3', v)),
    kill(15_000, 'p3', 'o4', [], [snap('p5', A)]),
  ] });
  for (let r = 0; r < (o.defenseRounds ?? 4); r += 1) rounds.push({ number: ++n, attackingTeamKey: o.side === false ? undefined : 'Blue', winningTeam: 'Red', kills: [
    kill(1000, 'p1', 'o1', ['p3'], [snap('p1', FAR), snap('p2', r === 0 ? (i % 2 ? A : B) : FAR), snap('p3', FAR), snap('p4', B), snap('p5', A)]),
    ...(o.clutch ? ['p1', 'p3', 'p4', 'p5'].map((v, j) => kill(2000 + 100 * j, 'o2', v)) : []),
  ] });
  rounds.push({ number: ++n, winningTeam: 'Red', kills: [kill(1000, 'p1', 'o1')] }); // side unknown
  return { matchId: `${map}-m${i}`, playedAt: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(), map, mode: 'Competitive', teams, members, rounds };
}
const roundsOf = (count: number, o: Opts = {}, map = 'Ascent') => Array.from({ length: count }, (_, i) => memberRounds(match(i, map, o), REF)).flat();
const v1 = (map = 'Ascent') => ({ version: 'team-composition-v1', map, status: 'ok', lineups: [{ members: RED.map((p, k) => ({ memberId: id(k + 1), agent: AGENTS[p]!, role: agentRoles[AGENTS[p]!]! })) }] }) as unknown as TeamCompositionResult;
const labels = (o: Opts = {}, validation: V2Validation = V2_VALIDATION, count = 10) => {
  const result = refineTeamComposition(v1(), new SideModel(roundsOf(count, o)), validation)!;
  return Object.fromEntries(result.members.map((m) => [AGENTS[RED[Number(m.memberId.slice(-2)) - 1]!]!, [m.attack.responsibility, m.defense.responsibility]]));
};

describe('site-reference-v1', () => {
  it('classifies by provider site label and empirical centroid; nearest proximal site only', () => {
    expect(REF.sites('Ascent')).toEqual(['A', 'B']);
    expect(REF.classify('Ascent', A.x + 10, A.y - 10)).toEqual({ status: 'proximal', site: 'A' });
    expect(REF.classify('Ascent', B.x, B.y)).toEqual({ status: 'proximal', site: 'B' });
  });
  it('abstains outside every envelope; P99 admits points P95 rejects', () => {
    expect(REF.classify('Ascent', FAR.x, FAR.y)).toEqual({ status: 'outside' });
    const line = Array.from({ length: 100 }, (_, i) => ({ map: 'X', site: i % 2 ? 'A' : 'B', x: (i % 2 ? 0 : 50_000) + (i % 2 ? 1 : -1) * Math.floor(i / 2), y: 0 }));
    // A: offsets 0..49 to the right of x=0 → centroid 24.5; B mirrored. A point 47 units right of A's centroid.
    const p95 = new SiteReference(line, 'p95', 20); const p99 = new SiteReference(line, 'p99', 20);
    expect(p95.classify('X', 24.5 + 24.4, 0).status).toBe('outside');
    expect(p99.classify('X', 24.5 + 24.4, 0)).toEqual({ status: 'proximal', site: 'A' });
  });
  it('overlapping envelopes are ambiguous (abstain, never the nearer guess)', () => {
    const overlap = new SiteReference([...ring({ x: 0, y: 0 }, 30, 500).map((p) => ({ map: 'Y', site: 'A', ...p })), ...ring({ x: 400, y: 0 }, 30, 500).map((p) => ({ map: 'Y', site: 'B', ...p }))]);
    expect(overlap.classify('Y', 200, 0)).toEqual({ status: 'ambiguous' });
  });
  it('isolates maps and requires a minimum labelled sample per site', () => {
    const single = new SiteReference(plants('Ascent'));
    expect(single.classify('Bind', A.x, A.y)).toEqual({ status: 'unknown_map' });
    const thin = new SiteReference([...plants('Ascent').slice(0, 30), ...plants('Ascent').slice(30, 40)]);
    expect(thin.sites('Ascent')).toEqual(['A']);
    expect(thin.hasMap('Ascent')).toBe(false);
  });
  it('uses only the plants it is given (chronological train reference) and is input-order independent', () => {
    const early = plants('Ascent'); const shifted = ring({ x: A.x + 5000, y: A.y }, 60).map((p) => ({ map: 'Ascent', site: 'A', ...p }));
    const trainOnly = new SiteReference(early); const withLater = new SiteReference([...early, ...shifted]);
    expect(trainOnly.classify('Ascent', A.x + 5000, A.y)).toEqual({ status: 'outside' });
    expect(withLater.classify('Ascent', A.x + 5000, A.y)).toEqual({ status: 'proximal', site: 'A' });
    const reversed = new SiteReference([...early].reverse());
    for (let x = -2000; x <= 12_000; x += 250) for (let y = -9000; y <= -4000; y += 250) expect(reversed.classify('Ascent', x, y)).toEqual(trainOnly.classify('Ascent', x, y));
  });
});

describe('side-evidence-v1', () => {
  const rounds = memberRounds(match(0), REF);
  const of = (p: string, side: 'ATTACK' | 'DEFENSE' | null) => rounds.filter((r) => r.memberId === id(RED.indexOf(p as never) + 1) && r.side === side);
  it('derives side only from the explicit attacking team; unknown side stays null', () => {
    expect(of('p1', 'ATTACK')).toHaveLength(4); expect(of('p1', 'DEFENSE')).toHaveLength(4); expect(of('p1', null)).toHaveLength(1);
  });
  it('first duel, 5 s opponent trade, plant and post-plant site evidence', () => {
    expect(of('p1', 'ATTACK').every((r) => r.firstKill)).toBe(true);
    expect(of('p2', 'ATTACK').every((r) => r.tradeKill)).toBe(true);
    expect(of('p3', 'ATTACK').some((r) => r.tradeKill)).toBe(false);
    expect(of('p5', 'ATTACK').every((r) => r.planted && r.plantedSite === 'A' && r.postPlantAtSite)).toBe(true);
    const late = memberRounds({ ...match(0), rounds: [{ number: 1, attackingTeamKey: 'Red', kills: [kill(1000, 'o2', 'p4'), kill(6500, 'p2', 'o2')] }] }, REF);
    expect(late.find((r) => r.memberId === id(2))!.tradeKill).toBe(false);
  });
  it('first-contact context is a site letter, OTHER or UNKNOWN — never the victim position', () => {
    expect(of('p1', 'ATTACK')[0]!.firstDuelContext).toBe('UNKNOWN'); // killer not in that kill's snapshot
    expect(of('p1', 'DEFENSE')[0]!.firstDuelContext).toBe('OTHER');
    const atA = memberRounds({ ...match(0), rounds: [{ number: 1, attackingTeamKey: 'Red', kills: [kill(1000, 'o1', 'p3', [], [snap('p1', A)]), kill(1200, 'p1', 'o1', [], [snap('p1', A)])] }] }, REF);
    expect(atA.find((r) => r.memberId === id(3))!.firstDuelContext).toBe('UNKNOWN'); // victim: no own snapshot
    expect(atA.find((r) => r.memberId === id(1))!.firstDuelContext).toBeNull(); // did not take the first duel
    const p1First = memberRounds({ ...match(0), rounds: [{ number: 1, attackingTeamKey: 'Red', kills: [kill(1000, 'p1', 'o1', [], [snap('p1', A)])] }] }, REF);
    expect(p1First.find((r) => r.memberId === id(1))!.firstDuelContext).toBe('A');
  });
  it('clutch evidence: last certain survivor; revive / recorded-dead topology excluded', () => {
    const clutch = memberRounds(match(0, 'Ascent', { clutch: true }), REF).filter((r) => r.side === 'DEFENSE');
    expect(clutch.filter((r) => r.memberId === id(2)).every((r) => r.clutchAttempt && r.clutchWin)).toBe(true);
    const revived = memberRounds({ ...match(0), rounds: [{ number: 1, attackingTeamKey: 'Red', kills: [kill(1000, 'o1', 'p1'), kill(2000, 'p1', 'o2')] }] }, REF);
    expect(revived.every((r) => r.clutchAttempt === null)).toBe(true);
  });
});

describe('team-composition-v2 responsibilities', () => {
  it('never changes the V1 assignment and carries the claim boundary', () => {
    const result = refineTeamComposition(v1(), new SideModel(roundsOf(10)))!;
    expect(result.assignment).toEqual(v1().lineups[0]!.members.map((m) => ({ memberId: m.memberId, agent: m.agent, role: m.role })));
    expect(result.boundary).toEqual({ namedCallouts: false, exactPositions: false, paths: false, realTime: false });
  });
  it('emits each label when its evidence is validated (full validation)', () => {
    expect(labels({}, FULL)).toEqual({ Jett: ['ATTACK_PRIMARY_ENTRY', 'DEFENSE_FIRST_CONTACT'], Raze: ['ATTACK_SECOND_ENTRY_TRADE', 'DEFENSE_FLEX'],
      Sova: ['ATTACK_INFO_SETUP', 'DEFENSE_INFO_SUPPORT'], Killjoy: [null, 'DEFENSE_SITE_HOLD'], Omen: ['ATTACK_PLANT_SUPPORT', 'DEFENSE_SITE_HOLD'] });
    expect(labels({ planter: 'p2' }, FULL).Omen![0]).toBe('ATTACK_POST_PLANT');
    expect(labels({ attackDeaths: ['p1', 'p2'] }, FULL).Omen![0]).toBe('ATTACK_SPACE_CONTROL');
    expect(labels({ assistant: 'p4' }, FULL).Killjoy![0]).toBe('ATTACK_UTILITY_SUPPORT');
    expect(labels({ clutch: true }, FULL).Raze![1]).toBe('DEFENSE_CLUTCH');
  });
  it('the default (holdout) gate withholds non-reproducing labels and every site claim', () => {
    expect(labels()).toEqual({ Jett: ['ATTACK_PRIMARY_ENTRY', 'DEFENSE_FIRST_CONTACT'], Raze: ['ATTACK_SECOND_ENTRY_TRADE', null],
      Sova: [null, 'DEFENSE_INFO_SUPPORT'], Killjoy: [null, null], Omen: ['ATTACK_PLANT_SUPPORT', null] });
    const result = refineTeamComposition(v1(), new SideModel(roundsOf(10)))!;
    expect(result.members.every((m) => m.attack.siteTendency.site === null && m.defense.siteTendency.site === null)).toBe(true);
    expect(result.emittable).toEqual({ attack: ['ATTACK_PLANT_SUPPORT', 'ATTACK_POST_PLANT', 'ATTACK_PRIMARY_ENTRY', 'ATTACK_SECOND_ENTRY_TRADE'],
      defense: ['DEFENSE_FIRST_CONTACT', 'DEFENSE_INFO_SUPPORT'], siteTendency: false });
  });
  it('keeps attack and defense evidence separate and excludes unknown-side rounds', () => {
    const model = new SideModel(roundsOf(10));
    expect(model.profile(id(5), 'ATTACK')!.rounds).toBe(40);
    expect(model.profile(id(5), 'ATTACK')!.rates.plant).toBeGreaterThan(model.profile(id(5), 'DEFENSE')!.rates.plant!);
    expect(model.profile(id(3), 'DEFENSE')!.rates.sitePresence).toBeLessThan(model.profile(id(4), 'DEFENSE')!.rates.sitePresence!);
    const unknown = new SideModel(roundsOf(10, { side: false }));
    expect(unknown.profile(id(1), 'ATTACK')).toBeUndefined();
    const result = refineTeamComposition(v1(), unknown)!;
    expect(result.members.every((m) => m.attack.responsibility === null && m.defense.responsibility === null && m.attack.confidence === 0)).toBe(true);
  });
  it('site affinity is never forced: an even group-level split gives no tendency', () => {
    const model = new SideModel(roundsOf(10));
    expect(model.siteAffinity(id(2), 'Ascent', 'DEFENSE').site).toBeNull(); // alternating A / B
    expect(model.siteAffinity(id(4), 'Ascent', 'DEFENSE')).toMatchObject({ site: 'B', votingMatches: 10, matchesForSite: 10 });
    expect(model.siteAffinity(id(5), 'Ascent', 'ATTACK').site).toBeNull(); // only voter: no base rate to beat
  });
  it('repeating one match cannot inflate evidence (one vote per match)', () => {
    const one = new SideModel(memberRounds(match(0, 'Ascent', { defenseRounds: 40 }), REF));
    expect(one.siteAffinity(id(4), 'Ascent', 'DEFENSE')).toMatchObject({ site: null, votingMatches: 1 });
    const result = refineTeamComposition(v1(), one, FULL)!;
    expect(result.members.every((m) => m.defense.responsibility === null)).toBe(true);
  });
  it('confidence grows with distinct matches and is capped', () => {
    const conf = (n: number) => refineTeamComposition(v1(), new SideModel(roundsOf(n)))!.members[0]!.attack.confidence;
    expect(conf(3)).toBe(0); expect(conf(10)).toBeCloseTo(100 * Math.sqrt(0.5), 6); expect(conf(25)).toBe(100);
    expect(labels({}, FULL, 3)).toEqual({ Jett: [null, null], Raze: [null, null], Sova: [null, null], Killjoy: [null, null], Omen: [null, null] });
  });
  it('isolates maps for site affinity', () => {
    const model = new SideModel([...roundsOf(10, {}, 'Bind')]);
    expect(model.siteAffinity(id(4), 'Bind', 'DEFENSE').site).toBe('B');
    expect(model.siteAffinity(id(4), 'Ascent', 'DEFENSE')).toMatchObject({ site: null, votingMatches: 0 });
  });
  it('is deterministic under input order and never outputs raw coordinates', () => {
    const rounds = roundsOf(10);
    const a = refineTeamComposition(v1(), new SideModel(rounds), FULL); const b = refineTeamComposition(v1(), new SideModel([...rounds].reverse()), FULL);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const text = JSON.stringify(a);
    for (const raw of ['1234.5', '6789', '9234', '5234']) expect(text).not.toContain(raw);
    expect(Object.keys(REF.classify('Ascent', A.x, A.y)).sort()).toEqual(['site', 'status']);
  });
  it('exact binomial tail', () => {
    expect(binomialTail(10, 10, 0.5)).toBeCloseTo(1 / 1024, 12);
    expect(binomialTail(0, 10, 0.3)).toBe(1);
  });
});
