import { describe, expect, it } from 'vitest';
import { EventMetricEngine } from '../server/metrics/eventMetricEngine';
import { projectStagedMatch, type StagingMember } from '../server/sharedMatch/stagingMatches';
import { auditCandidate, candidateMemberRatings, pairProfileSides, roleSensitivity, roleSensitivityNull, sideValues, usableUnits } from '../src/analytics/sharedMatch/candidateAudit';
import { pairMatchesFor, type MemberMatchSignals, type PairMatchEvidence } from '../src/analytics/sharedMatch/pairEvidence';
import { computeSharedMatchRatings } from '../src/analytics/sharedMatch/rating';
import type { MatchPerformance, MatchRecord, PlayerRole } from '../src/types/valorant';

/** TASK-SCORING-SHARED-MATCH-02 Phase A — candidate audit framework; synthetic fixtures only (no network, no DB). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 0;
interface Seat { member: number; agent?: string; acs?: number; kills?: number; adr?: number; kast?: number; fk?: number; fd?: number }
function match(seats: Seat[], options: { mode?: string; at?: number } = {}): { ref: string; match: MatchRecord } {
  counter += 1;
  const performances: MatchPerformance[] = seats.map((seat) => ({
    playerId: id(seat.member), agent: seat.agent ?? 'Sova', teamGroup: 'A', teamWon: true,
    kills: seat.kills ?? 18, deaths: 15, assists: 6, acs: seat.acs ?? 220, adr: seat.adr ?? 140,
    ...(seat.kast !== undefined ? { kast: seat.kast, firstKills: seat.fk ?? 2, firstDeaths: seat.fd ?? 2, eventEvidence: { kast: 'reconstructed', opening: 'reconstructed' } } : {}),
  }) as MatchPerformance);
  return { ref: `ref-${String(counter).padStart(4, '0')}`, match: { id: `m-${counter}`, playedAt: new Date(Date.UTC(2026, 5, 1) + (options.at ?? counter) * 3_600_000).toISOString(),
    map: 'Ascent', gameMode: options.mode ?? 'Competitive', opponent: 'x', scoreFor: 13, scoreAgainst: 9, won: true, durationMinutes: 40, performances } };
}
const pairsOf = (...items: { ref: string; match: MatchRecord }[]) => items.flatMap((item) => pairMatchesFor(item.ref, item.match));

type Dims = Partial<Record<'firepower' | 'entry' | 'teamplay' | 'roleValue' | 'roundImpact', number>>;
interface Side { member: number; role?: PlayerRole; dims?: Dims; kast?: number }
/** A pair-match unit with explicit one-match signals (the audit is a pure function of these). */
function unit(ref: string, at: number, a: Side, b: Side, mode: 'Competitive' | 'Unrated' = 'Competitive'): PairMatchEvidence {
  const side = (s: Side): MemberMatchSignals => ({ memberId: id(s.member), agent: 'x', role: s.role ?? 'Initiator', rounds: 22, teamGroup: 'A', teamWon: true,
    acs: 220, adr: 140, kpr: 0.8, apr: 0.3, killDiffPerRound: 0.1, kast: s.kast ?? 0.7, fkpr: 0.1, fdpr: 0.1,
    dimensions: { firepower: 50, entry: 50, teamplay: 50, roleValue: 50, ...s.dims }, engineOverall: null, matchProfile: null });
  const [x, y] = id(a.member) < id(b.member) ? [a, b] : [b, a];
  return { version: 'shared-match-evidence-v1', matchRef: ref, playedAt: new Date(Date.UTC(2026, 5, 1) + at * 3_600_000).toISOString(), mode, map: 'Ascent',
    seasonKey: null, rounds: 22, sameTeam: true, a: side(x), b: side(y), rankA: { tierOrdinal: null, status: 'unknown' }, rankB: { tierOrdinal: null, status: 'unknown' },
    rankTierDifference: null, valid: { stats: true, matchProfile: true, kast: true, remakeOrShort: false } };
}

function scenario(): PairMatchEvidence[] {
  const out: PairMatchEvidence[] = [];
  for (let i = 0; i < 24; i += 1) {
    const one: Side = { member: 1, role: i % 2 ? 'Duelist' : 'Initiator', dims: { firepower: 70 + (i % 3) * 4, entry: 60, teamplay: 62, roleValue: 58 }, kast: 0.78 };
    const two: Side = { member: 2, role: 'Controller', dims: { firepower: 45 + (i % 4) * 3, entry: 48, teamplay: 50, roleValue: 50 }, kast: 0.7 };
    const three: Side = { member: 3, role: i % 3 ? 'Sentinel' : 'Duelist', dims: { firepower: 47 + (i % 5) * 2, entry: 50, teamplay: 49, roleValue: 52 }, kast: 0.72 };
    out.push(unit(`ref-${i}`, i, one, two), unit(`ref-${i}`, i, one, three), unit(`ref-${i}`, i, two, three));
  }
  return out;
}

describe('candidate audit framework (one framework for every candidate)', () => {
  it('is deterministic and independent of input order', () => {
    const pairs = scenario();
    for (const key of ['firepower', 'pairProfile', 'kast'] as const) expect(auditCandidate([...pairs].reverse(), key)).toEqual(auditCandidate(pairs, key));
  });
  it('duplicate pair-match units never add evidence', () => {
    const pairs = scenario();
    expect(auditCandidate([...pairs, ...pairs], 'pairProfile')).toEqual(auditCandidate(pairs, 'pairProfile'));
  });
  it('pair-swap symmetry: score(A,B) = −score(B,A); identical stats → margin 0', () => {
    const pair = unit('s', 1, { member: 1, dims: { firepower: 80, entry: 40, roundImpact: 66 } }, { member: 2, dims: { firepower: 30, teamplay: 70, roundImpact: 50 } });
    const forward = pairProfileSides(pair!.a, pair!.b);
    const backward = pairProfileSides(pair!.b, pair!.a);
    expect(forward).not.toBeNull();
    expect(forward!.a - forward!.b).toBeCloseTo(-(backward!.a - backward!.b));
    const tie = unit('t', 1, { member: 1 }, { member: 2 });
    const values = sideValues(tie, 'pairProfile')!;
    expect(values.a - values.b).toBe(0);
  });
  it('pair profile averages both sides over the SAME components and requires the four broadly available dimensions', () => {
    const oneSidedImpact = unit('c', 1, { member: 1, dims: { roundImpact: 90 } }, { member: 2 });
    expect(Object.keys(sideValues(oneSidedImpact, 'pairProfile')!.components!).sort()).toEqual(['entry', 'firepower', 'roleValue', 'teamplay']);
    const bothImpact = unit('d', 1, { member: 1, dims: { roundImpact: 90 } }, { member: 2, dims: { roundImpact: 40 } });
    expect(Object.keys(sideValues(bothImpact, 'pairProfile')!.components!)).toContain('roundImpact');
    const [withoutEvents] = pairsOf(match([{ member: 1 }, { member: 2 }])); // no reconstructed KAST / opening → no Entry / Teamplay
    expect(sideValues(withoutEvents!, 'pairProfile')).toBeNull();
    expect(sideValues(withoutEvents!, 'firepower')).not.toBeNull();
  });
  it('excluded modes produce no units; Competitive and Unrated stay separable', () => {
    const base = scenario();
    const excluded = pairsOf(match([{ member: 1, acs: 400, kast: 0.9 }, { member: 2, acs: 90, kast: 0.4 }], { mode: 'Deathmatch' }));
    expect(excluded).toEqual([]);
    const all = [...base, unit('u', 99, { member: 1, dims: { firepower: 90 } }, { member: 2 }, 'Unrated')];
    expect(auditCandidate(all.filter((p) => p.mode === 'Unrated'), 'pairProfile').units).toBe(1);
    expect(auditCandidate(all.filter((p) => p.mode === 'Competitive'), 'pairProfile')).toEqual(auditCandidate(base, 'pairProfile'));
  });
  it('rank (including future rank evidence) never changes any audit statistic or candidate rating', () => {
    const base = scenario();
    const ranked = base.map((pair, index) => ({ ...pair, rankA: { tierOrdinal: 24, status: 'exact_match' as const }, rankB: { tierOrdinal: 3, status: 'exact_match' as const },
      rankTierDifference: index % 2 ? 21 : -21 }));
    expect(auditCandidate(ranked, 'pairProfile')).toEqual(auditCandidate(base, 'pairProfile'));
    expect(candidateMemberRatings([id(1), id(2), id(3)], ranked, 'pairProfile')).toEqual(candidateMemberRatings([id(1), id(2), id(3)], base, 'pairProfile'));
  });
  it('role handling: between-member Duelist bias and the within-member control are reported separately', () => {
    const audit = auditCandidate(scenario(), 'firepower');
    expect(audit.duelistBias).not.toBeNull();
    expect(audit.duelistWithinMember).not.toBeNull(); // member 1 plays both Jett and Sova → controlled comparison exists
    expect(Object.keys(audit.roleBias).sort()).toEqual(['Controller', 'Duelist', 'Initiator', 'Sentinel']);
  });
  it('outlier sensitivity: one extreme unit is measured, and a 1-in-12 outlier cannot flip a strong pair', () => {
    const out: PairMatchEvidence[] = [];
    for (let i = 0; i < 11; i += 1) out.push(unit(`o${i}`, i, { member: 1, dims: { firepower: 70, entry: 65, teamplay: 64 } }, { member: 2, dims: { firepower: 50 + i } }));
    out.push(unit('extreme', 50, { member: 1, dims: { firepower: 0, entry: 0, teamplay: 0, roleValue: 0 } }, { member: 2, dims: { firepower: 100, entry: 100, teamplay: 100, roleValue: 100 } }));
    const audit = auditCandidate(out, 'pairProfile');
    expect(audit.outlierFlipShare).toBe(0);
    expect(audit.outlierInfluence!).toBeGreaterThan(0);
  });
  it('the sampling-noise floor of the same-role test is deterministic', () => {
    const pairs = scenario();
    expect(roleSensitivityNull([id(1), id(2), id(3)], pairs, 'firepower', 5)).toEqual(roleSensitivityNull([id(1), id(2), id(3)], [...pairs].reverse(), 'firepower', 5));
    expect(roleSensitivity([id(1), id(2), id(3)], pairs, 'firepower').allRole.size).toBe(3);
  });
});

describe('v1 coexistence', () => {
  it('the audit harness reproduces shared-match-rating-v1 exactly for the Firepower signal (v1 is untouched)', () => {
    const pairs = scenario();
    const members = [id(1), id(2), id(3)];
    const v1 = computeSharedMatchRatings(members, pairs);
    const harness = candidateMemberRatings(members, pairs, 'firepower');
    for (const member of v1.members) expect(harness.get(member.memberId)).toBeCloseTo(member.combined.rating!, 10);
    expect(v1.version).toBe('shared-match-rating-v1');
  });
  it('usable units are one per (pair, match) in canonical order', () => {
    const pairs = scenario();
    const units = usableUnits([...pairs, ...pairs].reverse(), 'firepower');
    expect(units.map((unit) => unit.pair.matchRef)).toEqual(usableUnits(pairs, 'firepower').map((unit) => unit.pair.matchRef));
  });
});

describe('explicit event-metrics-v2 dependency (private/offline path only)', () => {
  const puuids = ['fictional-a', 'fictional-b', 'fictional-x'];
  const document = {
    metadata: { match_id: 'fictional-match-2', started_at: '2026-06-01T12:00:00.000Z', game_length_in_ms: 2_400_000, map: { id: 'm', name: 'Ascent' }, queue: { id: 'competitive', name: 'Competitive' } },
    players: puuids.map((puuid, index) => ({ puuid, name: `P${index}`, tag: 'T', team_id: index < 2 ? 'Blue' : 'Red', agent: { id: 'a', name: 'Sova' },
      stats: { kills: 20 - index * 4, deaths: 12, assists: 4, score: 5000 - index * 800, headshots: 10, bodyshots: 20, legshots: 2, damage: { dealt: 3500 - index * 400, received: 2000 } } })),
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 13, lost: 0 } }, { team_id: 'Red', won: false, rounds: { won: 0, lost: 13 } }],
    rounds: Array.from({ length: 13 }, (_, r) => ({ id: r, winning_team: 'Blue', result: 'Eliminated',
      stats: puuids.map((puuid, index) => ({ player: { puuid, team: index < 2 ? 'Blue' : 'Red' }, stats: { kills: 0, score: 100 } })) })),
    kills: [],
  };
  const members: StagingMember[] = [
    { accountPublicId: id(11), memberPublicId: id(1), communityName: '甲', affinity: 'ap', providerPuuid: 'fictional-a' },
    { accountPublicId: id(12), memberPublicId: id(2), communityName: '乙', affinity: 'ap', providerPuuid: 'fictional-b' },
  ];
  const key = 'test-shared-match-hmac-key-with-32-bytes-min';
  it('the shared-match projection default stays pinned to event-metrics-v1; v2 is used only when passed explicitly', () => {
    const versions = (engine?: EventMetricEngine) => projectStagedMatch(document, 'ref-v2', members, key, engine)!.match.performances.map((p) => p.advancedMetrics?.ruleVersion);
    expect(new Set(versions())).toEqual(new Set(['event-metrics-v1']));
    expect(new Set(versions(new EventMetricEngine({ ruleVersion: 'event-metrics-v2' })))).toEqual(new Set(['event-metrics-v2']));
    // The canonical default may change (TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01); shared-match evidence stays pinned to v1.
    expect(new EventMetricEngine({ ruleVersion: 'event-metrics-v1' }).ruleVersion).toBe('event-metrics-v1');
  });
});
