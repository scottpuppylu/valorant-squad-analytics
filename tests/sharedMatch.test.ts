import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectStagedMatch, type StagingMember } from '../server/sharedMatch/stagingMatches';
import { evaluateCandidate } from '../src/analytics/sharedMatch/candidates';
import { connectedComponents, coverageSummary, pairCoverage } from '../src/analytics/sharedMatch/coverage';
import { MIN_COMPARABLE_ROUNDS, pairMatchesFor, sharedMode, type PairMatchEvidence } from '../src/analytics/sharedMatch/pairEvidence';
import { aggregatePair, calibrate, computeSharedMatchRatings, memberRating, scoreUnits, type ScoredUnit } from '../src/analytics/sharedMatch/rating';
import type { MatchPerformance, MatchRecord } from '../src/types/valorant';

/** TASK-SCORING-SHARED-MATCH-01 — synthetic fixtures only; no network, no database. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
interface Seat { member: number; agent?: string; kills?: number; deaths?: number; assists?: number; acs?: number; adr?: number; team?: 'A' | 'B' }
let counter = 0;
function match(seats: Seat[], options: { mode?: string; rounds?: [number, number]; at?: number } = {}): { ref: string; match: MatchRecord } {
  counter += 1;
  const [won, lost] = options.rounds ?? [13, 9];
  const performances: MatchPerformance[] = seats.map((seat) => ({
    playerId: id(seat.member), agent: seat.agent ?? 'Sova', teamGroup: seat.team ?? 'A', teamWon: (seat.team ?? 'A') === 'A',
    kills: seat.kills ?? 18, deaths: seat.deaths ?? 15, assists: seat.assists ?? 6, acs: seat.acs ?? 220, adr: seat.adr ?? 140,
  }));
  return { ref: `ref-${counter}`, match: { id: `m-${counter}`, playedAt: new Date(Date.UTC(2026, 5, 1) + (options.at ?? counter) * 3_600_000).toISOString(),
    map: 'Ascent', gameMode: options.mode ?? 'Competitive', opponent: 'x', scoreFor: won, scoreAgainst: lost, won: true, durationMinutes: 40, performances } };
}
const pairsOf = (...items: { ref: string; match: MatchRecord }[]) => items.flatMap((item) => pairMatchesFor(item.ref, item.match));

describe('pair evidence (shared-match-evidence-v1)', () => {
  it('creates k·(k−1)/2 unordered units with A < B and never both directions', () => {
    const pairs = pairsOf(match([{ member: 3 }, { member: 1 }, { member: 2 }]));
    expect(pairs.map((p) => [p.a.memberId, p.b.memberId])).toEqual([[id(1), id(2)], [id(1), id(3)], [id(2), id(3)]]);
  });
  it('eligibility: Competitive and Unrated only, kept distinguishable', () => {
    expect(sharedMode('Competitive')).toBe('Competitive');
    expect(sharedMode('Unrated')).toBe('Unrated');
    for (const mode of ['Swiftplay', 'Deathmatch', 'Team Deathmatch', 'Premier', 'Custom', 'Spike Rush']) {
      expect(pairsOf(match([{ member: 1 }, { member: 2 }], { mode }))).toEqual([]);
    }
    expect(pairsOf(match([{ member: 1 }, { member: 2 }], { mode: 'Unrated' }))[0]!.mode).toBe('Unrated');
  });
  it('classifies same-team and opposing-team units', () => {
    const [same] = pairsOf(match([{ member: 1, team: 'A' }, { member: 2, team: 'A' }]));
    const [opposing] = pairsOf(match([{ member: 1, team: 'A' }, { member: 2, team: 'B' }]));
    expect(same!.sameTeam).toBe(true);
    expect(opposing!.sameTeam).toBe(false);
  });
  it('short / remade matches are not comparable; zero deaths never explodes', () => {
    const [short] = pairsOf(match([{ member: 1 }, { member: 2 }], { rounds: [3, 2] }));
    expect(short!.valid.stats).toBe(false);
    expect(MIN_COMPARABLE_ROUNDS).toBe(10);
    const [zero] = pairsOf(match([{ member: 1, deaths: 0, kills: 25 }, { member: 2 }]));
    expect(Number.isFinite(zero!.a.killDiffPerRound)).toBe(true);
    expect(zero!.a.dimensions.firepower).toBeDefined();
  });
  it('a member appearing twice in one match (two accounts) never pairs with itself', () => {
    const pairs = pairsOf(match([{ member: 1 }, { member: 1 }, { member: 2 }]));
    expect(pairs).toHaveLength(1);
  });
  it('Firepower is role-aware: the same raw line scores higher for a Controller than for a Duelist', () => {
    const [pair] = pairsOf(match([{ member: 1, agent: 'Jett' }, { member: 2, agent: 'Omen' }]));
    expect(pair!.b.dimensions.firepower!).toBeGreaterThan(pair!.a.dimensions.firepower!);
  });
});

describe('end-to-end canonical projection of a staged v4 document (no consent table)', () => {
  const key = 'test-shared-match-hmac-key-with-32-bytes-min';
  const puuids = ['fictional-a', 'fictional-b', 'fictional-x'];
  const roundStats = (n: number) => Array.from({ length: n }, (_, r) => ({ id: r, winning_team: 'Blue', result: 'Eliminated',
    stats: puuids.map((puuid, index) => ({ player: { puuid, team: index < 2 ? 'Blue' : 'Red' }, stats: { kills: 0, score: 100 } })) }));
  const document = {
    metadata: { match_id: 'fictional-match-1', started_at: '2026-06-01T12:00:00.000Z', game_length_in_ms: 2_400_000, map: { id: 'm', name: 'Ascent' }, queue: { id: 'competitive', name: 'Competitive' } },
    players: puuids.map((puuid, index) => ({ puuid, name: `P${index}`, tag: 'T', team_id: index < 2 ? 'Blue' : 'Red', agent: { id: 'a', name: index === 0 ? 'Jett' : 'Sova' },
      stats: { kills: 20 - index * 4, deaths: 12, assists: 4, score: 5000 - index * 800, headshots: 10, bodyshots: 20, legshots: 2, damage: { dealt: 3500 - index * 400, received: 2000 } } })),
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 13, lost: 0 } }, { team_id: 'Red', won: false, rounds: { won: 0, lost: 13 } }],
    rounds: roundStats(13), kills: [],
  };
  const members: StagingMember[] = [
    { accountPublicId: id(11), memberPublicId: id(1), communityName: '甲', affinity: 'ap', providerPuuid: 'fictional-a' },
    { accountPublicId: id(12), memberPublicId: id(2), communityName: '乙', affinity: 'ap', providerPuuid: 'fictional-b' },
  ];
  it('produces one public MatchRecord with exactly the tracked members, then one pair unit', () => {
    const projected = projectStagedMatch(document, 'ref-e2e', members, key)!;
    expect(projected.identityConflict).toBe(false);
    expect(projected.match.performances.map((p) => p.playerId).sort()).toEqual([id(1), id(2)]);
    expect(projected.match.performances.find((p) => p.playerId === id(1))!.acs).toBeCloseTo(5000 / 13);
    const pairs = pairMatchesFor('ref-e2e', projected.match);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.sameTeam).toBe(true);
  });
});

function scenario(): PairMatchEvidence[] {
  const out: PairMatchEvidence[] = [];
  for (let i = 0; i < 20; i += 1) {
    // member 1 clearly stronger than 2; member 3 roughly even with 2; one extreme outlier match.
    out.push(...pairsOf(match([{ member: 1, acs: 260 + (i % 3) * 5, kills: 22, adr: 160 }, { member: 2, acs: 200 + (i % 4) * 4, kills: 16, adr: 130 },
      { member: 3, acs: 202 + (i % 5) * 3, kills: 16, adr: 131 }], { at: i })));
  }
  return out;
}

describe('shared-match-rating-v1 invariants', () => {
  it('identical stats → NEUTRAL with margin 0', () => {
    const pairs = [...scenario(), ...pairsOf(match([{ member: 4 }, { member: 5 }]))];
    const units = scoreUnits(pairs, calibrate(pairs)!);
    const tie = units.find((unit) => unit.a === id(4))!;
    expect(tie.margin).toBe(0);
    expect(tie.outcome).toBe('NEUTRAL');
  });
  it('swapping A and B reverses the margin sign; pair ordering never changes the result', () => {
    const one = pairsOf(match([{ member: 1, acs: 280, kills: 24 }, { member: 2, acs: 180, kills: 12 }]));
    const two = pairsOf(match([{ member: 2, acs: 280, kills: 24 }, { member: 1, acs: 180, kills: 12 }]));
    const calibration = { sigma: 20, neutralBand: 4, clip: 40 };
    const [x] = scoreUnits(one, calibration); const [y] = scoreUnits(two, calibration);
    expect(x!.margin).toBeCloseTo(-y!.margin);
    const reversedInput = pairsOf(match([{ member: 2, acs: 180, kills: 12 }, { member: 1, acs: 280, kills: 24 }]));
    expect(scoreUnits(reversedInput, calibration)[0]!.margin).toBeCloseTo(x!.margin);
  });
  it('duplicating a match never adds evidence', () => {
    const pairs = scenario();
    const calibration = calibrate(pairs)!;
    expect(scoreUnits([...pairs, ...pairs], calibration)).toHaveLength(scoreUnits(pairs, calibration).length);
    expect(pairCoverage([id(1), id(2), id(3)], [...pairs, ...pairs])).toEqual(pairCoverage([id(1), id(2), id(3)], pairs));
  });
  it('excluded modes have no effect on any rating', () => {
    const base = scenario();
    const withExcluded = [...base, ...pairsOf(match([{ member: 2, acs: 400, kills: 40 }, { member: 1, acs: 100, kills: 3 }], { mode: 'Deathmatch' }))];
    expect(computeSharedMatchRatings([id(1), id(2), id(3)], withExcluded)).toEqual(computeSharedMatchRatings([id(1), id(2), id(3)], base));
  });
  it('rank never changes a same-match result (rank alone and future rank evidence have no effect)', () => {
    const base = scenario();
    const ranked = base.map((pair, index) => ({ ...pair, rankA: { tierOrdinal: 25, status: 'exact_match' as const }, rankB: { tierOrdinal: 1, status: 'exact_match' as const },
      rankTierDifference: index % 2 ? 24 : -24 }));
    const strip = (result: ReturnType<typeof computeSharedMatchRatings>) => ({ ...result, units: result.units.map((unit) => ({ ...unit, rankTierDifference: null })) });
    expect(strip(computeSharedMatchRatings([id(1), id(2), id(3)], ranked))).toEqual(strip(computeSharedMatchRatings([id(1), id(2), id(3)], base)));
  });
  it('is deterministic', () => {
    const pairs = scenario();
    expect(computeSharedMatchRatings([id(1), id(2), id(3)], pairs)).toEqual(computeSharedMatchRatings([id(1), id(2), id(3)], [...pairs].reverse()));
  });
});

describe('aggregation, outliers and confidence', () => {
  it('the stronger member rates above 50, the weaker below; even peers stay near 50', () => {
    const result = computeSharedMatchRatings([id(1), id(2), id(3)], scenario());
    const rating = (member: number) => result.members.find((m) => m.memberId === id(member))!.combined.rating!;
    expect(rating(1)).toBeGreaterThan(70);
    expect(rating(2)).toBeLessThan(50);
    expect(Math.abs(rating(2) - rating(3))).toBeLessThan(15);
  });
  it('one extreme match cannot dominate: margins are winsorized and outcomes are sign-based', () => {
    const calibration = { sigma: 20, neutralBand: 4, clip: 40 };
    const units: ScoredUnit[] = [...Array(9)].map((_, i) => ({ matchRef: `r${i}`, playedAt: `2026-06-0${(i % 9) + 1}T00:00:00Z`, mode: 'Competitive', a: id(1), b: id(2),
      margin: -10, clippedMargin: -10, outcome: 'B_OUTPERFORMED_A', components: {} as ScoredUnit['components'], rankTierDifference: null }));
    units.push({ ...units[0]!, matchRef: 'outlier', margin: 500, clippedMargin: Math.min(500, calibration.clip), outcome: 'A_OUTPERFORMED_B' });
    const pair = aggregatePair(units);
    expect(pair.averageRelativeMargin!).toBeLessThan(0);
    expect(pair.bOutperformed).toBe(9);
    expect(memberRating(id(2), units, units.length, 1).rating!).toBeGreaterThan(50);
  });
  it('confidence grows with evidence; fewer than 5 matches gives no number (never 50)', () => {
    const all = scenario();
    const calibration = calibrate(all)!;
    const units = scoreUnits(all, calibration);
    const few = units.filter((unit) => unit.matchRef <= 'ref-z').slice(0, 6);
    const small = memberRating(id(1), few, few.length, 2);
    const large = memberRating(id(1), units, units.length, 2);
    expect(large.confidence).toBeGreaterThan(small.confidence);
    const tiny = memberRating(id(1), units.filter((unit) => unit.a === id(1)).slice(0, 3), 3, 2);
    expect(tiny.status).toBe('unavailable');
    expect(tiny.rating).toBeUndefined();
  });
});

describe('graph coverage and candidate evaluation', () => {
  it('counts only direct shared matches and keeps disconnected members disconnected', () => {
    const pairs = pairsOf(match([{ member: 1 }, { member: 2 }]), match([{ member: 2 }, { member: 3 }]));
    const cells = pairCoverage([id(1), id(2), id(3), id(4)], pairs);
    expect(cells.find((c) => c.a === id(1) && c.b === id(3))!.shared).toBe(0); // no manufactured A↔C evidence
    expect(coverageSummary(cells)).toMatchObject({ possiblePairs: 6, pairsWithShared: 2, pairsWithZero: 4 });
    expect(connectedComponents([id(1), id(2), id(3), id(4)], cells).map((g) => g.length).sort()).toEqual([1, 3]);
  });
  it('evaluates candidates without network (availability / role bias / stability)', () => {
    const report = evaluateCandidate(scenario(), 'firepower');
    expect(report.availability).toBe(1);
    expect(report.stability).not.toBeNull();
  });
});

describe('architecture boundary', () => {
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
  }
  it('no rank multiplier / final strength / MMR estimate exists; rating code never reads rank', async () => {
    for (const file of [...await files(resolve('src/analytics/sharedMatch')), ...await files(resolve('server/sharedMatch'))]) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(/RANK_WEIGHT|RANK_MULTIPLIER|rankCoefficient|FINAL_STRENGTH|MMR_ESTIMATE|ELO_ESTIMATE|performance\.performance|\.performance\b(?!s)/u);
    }
    const rating = await readFile(resolve('src/analytics/sharedMatch/rating.ts'), 'utf8');
    expect(rating).not.toMatch(/tierOrdinal|rankA|rankB|resolveRankContextAt/u);
  });
  it('the private staging projection is not imported by public code', async () => {
    for (const root of ['api', 'src', 'shared'].map((dir) => resolve(dir))) {
      for (const file of await files(root)) if (/\.(ts|tsx)$/u.test(file)) expect(await readFile(file, 'utf8'), file).not.toMatch(/from '[^']*server\/sharedMatch/u);
    }
  });
});
