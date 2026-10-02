import { describe, expect, it } from 'vitest';
import { buildSynergy, canonicalPair, defaultSynergyFilters, selectSynergyMatches } from '../src/synergy/analytics';
import { calculateSynergyIndex, mutualLift } from '../src/synergy/index';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types';
import type { MatchRecord } from '../src/types/valorant';
import { validSynergyContract } from '../src/dataSources/server/synergyContract';

function fixture(shared = 20, baselineA = 20, baselineB = 20): NormalizedAnalyticsDataset {
  const demo = demoDataSource.snapshot();
  const players = demo.players.slice(0,2);
  const base = demo.matches[0]!;
  const matches: MatchRecord[] = [];
  for (const [kind,count] of [['shared',shared],['a',baselineA],['b',baselineB]] as const) {
    for (let i = 0; i < count; i += 1) {
      const selected = kind === 'shared' ? players : kind === 'a' ? [players[0]!] : [players[1]!];
      matches.push({ ...base, id:`${kind}-${i}`, map:i%2 ? 'Bind' : 'Ascent', gameMode:'Competitive',
        playedAt: new Date(Date.UTC(2026,8,i+1)).toISOString(), scoreFor:13, scoreAgainst:11, won:true,
        performances:selected.map((p) => ({ ...structuredClone(base.performances[0]!), playerId:p.id,
          teamGroup:'A',teamWon:true,teamRoundsWon:13,teamRoundsLost:11 })),
        synergyEvidence:kind === 'shared' ? {ruleVersion:'event-metrics-v1',status:'reconstructed',reconstructedRounds:24,pairs:[[0,1,0,1]]} : undefined });
    }
  }
  // Align advanced coverage with the fixture rounds without inventing REAL evidence.
  for (const m of matches) for (const p of m.performances) p.advancedMetrics!.coverage = {eligibleRounds:24,reconstructedRounds:24,omittedRounds:0};
  return {...demo,players,matches};
}
const complete = { status:'available' as const };

describe('versioned Duo index', () => {
  it('averages both +6/+2 directions to +4 before shrinkage', () => {
    expect(mutualLift(6,2)).toBe(4);
    const index = calculateSynergyIndex(20,20,20,{a:6,b:2,...complete},{a:0,b:0,...complete},{delta:0,...complete});
    expect(index.components[0]!.rawDelta).toBe(4);
    expect(index.components[0]!.shrunkDelta).toBeCloseTo(4*20/28);
  });
  it('preserves asymmetric +5/-3 and uses mean +1', () => {
    const result = calculateSynergyIndex(20,20,20,{a:5,b:-3,...complete},{a:0,b:0,...complete},{delta:0,...complete});
    expect(result.components[0]!.rawDelta).toBe(1);
    expect(mutualLift(5,undefined)).toBeUndefined();
  });
  it('measured neutral is 50, never an unavailable fallback', () => {
    const result = calculateSynergyIndex(20,20,20,{a:0,b:0,...complete},{a:0,b:0,...complete},{delta:0,...complete});
    expect(result.status).toBe('available'); expect(result.value).toBe(50);
    expect(calculateSynergyIndex(20,20,20,{a:0,...complete},{a:0,b:0,...complete},{delta:0,...complete}).value).toBeUndefined();
  });
  it('requires minimum shared and BOTH independent baselines', () => {
    for (const [n,a,b] of [[2,20,20],[20,20,4],[20,4,20]]) {
      expect(calculateSynergyIndex(n!,a!,b!,{a:5,b:5,...complete},{a:.03,b:.03,...complete},{delta:.1,...complete}).status).toBe('unavailable');
    }
  });
  it('shrinks a three-match sample more and keeps confidence separate', () => {
    const small = calculateSynergyIndex(3,20,20,{a:5,b:5,...complete},{a:0,b:0,...complete},{delta:0,...complete});
    const large = calculateSynergyIndex(20,20,20,{a:5,b:5,...complete},{a:0,b:0,...complete},{delta:0,...complete});
    expect(small.components[0]!.shrunkDelta).toBeLessThan(large.components[0]!.shrunkDelta!);
    expect(small.confidence).toBeLessThan(large.confidence); expect(small.status).toBe('partial');
  });
  it('gates 75% configured coverage and renormalizes only eligible components', () => {
    const noKast = calculateSynergyIndex(20,20,20,{a:1,b:1,...complete},{status:'unavailable'},{delta:0,...complete});
    expect(noKast.coverage).toBe(.75); expect(noKast.status).toBe('partial');
    expect(noKast.components[0]!.usedWeight).toBeCloseTo(.8);
    const onlyOverall = calculateSynergyIndex(20,20,20,{a:1,b:1,...complete},{status:'unavailable'},{status:'unavailable'});
    expect(onlyOverall.value).toBeUndefined();
  });
  it('clamps signed calibration and rejects nonfinite evidence', () => {
    for (const delta of [-1e10,1e10,NaN,Infinity]) {
      const r = calculateSynergyIndex(20,20,20,{a:delta,b:delta,...complete},{a:delta,b:delta,...complete},{delta,...complete});
      if (Number.isFinite(delta)) expect(r.value).toBe(delta < 0 ? 0 : 100); else expect(r.value).toBeUndefined();
    }
  });
  it('invalid sample counts fail closed with finite independent confidence', () => {
    for (const n of [NaN,Infinity,-8,1.5]) {
      const result = calculateSynergyIndex(n,20,20,{a:0,b:0,...complete},{a:0,b:0,...complete},{delta:0,...complete});
      expect(result.value).toBeUndefined(); expect(result.confidence).toBe(0);
    }
  });
});

describe('same-team selection and independent context', () => {
  it('counts a same-team match once and canonicalizes identities', () => {
    const dataset = fixture(1,0,0);
    dataset.matches.push(structuredClone(dataset.matches[0]!));
    const [r] = buildSynergy(dataset);
    expect(r!.sharedSample.matches).toBe(1); expect(r!.sharedSample.rounds).toBe(24);
    expect(canonicalPair('b','a')).toEqual(canonicalPair('a','b'));
  });
  it('excludes opponents from shared samples and BOTH baselines', () => {
    const dataset = fixture();
    const opponent = structuredClone(dataset.matches[0]!); opponent.id = 'opponent';
    Object.assign(opponent.performances[1]!,{teamGroup:'B',teamWon:false,teamRoundsWon:11,teamRoundsLost:13});
    opponent.synergyEvidence = undefined; dataset.matches.push(opponent);
    const r = buildSynergy(dataset)[0]!;
    expect(r.sharedSample.matches).toBe(20); expect(r.sharedSample.opponentMatches).toBe(1);
    expect(r.playerA.baseline.matches).toBe(20); expect(r.playerB.baseline.matches).toBe(20);
    expect(buildSynergy({...dataset,matches:[opponent]})).toEqual([]);
  });
  it('measures actual neutral with reusable community-score-v2 windows', () => {
    const r = buildSynergy(fixture())[0]!;
    expect(r.playerA.overallLift).toBe(0); expect(r.playerB.overallLift).toBe(0);
    expect(r.value).toBeCloseTo(50); expect(r.status).toBe('available');
    expect(r.playerA.paired.overall.ruleVersion).toBe('community-score-v2');
  });
  it('leaves shared descriptive data when one baseline is insufficient', () => {
    const r = buildSynergy(fixture(20,20,4))[0]!;
    expect(r.value).toBeUndefined(); expect(r.sharedSample.matches).toBe(20);
  });
  it('changing outcome changes ONLY win-rate component, not individual scoring', () => {
    const dataset = fixture(); const before = buildSynergy(dataset)[0]!;
    for (const m of dataset.matches.filter((m) => m.id.startsWith('shared'))) for (const p of m.performances) p.teamWon = false;
    const after = buildSynergy(dataset)[0]!;
    expect(after.playerA.paired.overall).toEqual(before.playerA.paired.overall);
    expect(after.playerB.paired.overall).toEqual(before.playerB.paired.overall);
    expect(after.components.slice(0,2)).toEqual(before.components.slice(0,2));
    expect(after.components[2]!.rawDelta).toBe(-1);
  });
  it('filters shared AND baseline before scoring, no all-map leakage', () => {
    const dataset = fixture();
    for (const m of dataset.matches.filter((m) => m.id.startsWith('shared'))) for (const p of m.performances) {
      p.acs *= m.map === 'Ascent' ? 1.2 : .8; p.kast += m.map === 'Ascent' ? .04 : -.04;
    }
    const ascent = buildSynergy(dataset,{...defaultSynergyFilters,map:'Ascent'})[0]!;
    const bind = buildSynergy(dataset,{...defaultSynergyFilters,map:'Bind'})[0]!;
    expect(ascent.sharedSample.matches).toBe(10); expect(ascent.playerA.baseline.matches).toBe(10);
    expect(ascent.value!).toBeGreaterThan(bind.value!);
    expect(buildSynergy(dataset)[0]!.sharedSample.matches).toBe(20);
    expect(selectSynergyMatches(dataset,{...defaultSynergyFilters,from:'2026-09-05',to:'2026-09-05'})).toHaveLength(3);
    expect(buildSynergy(dataset,{...defaultSynergyFilters,gameMode:'Unrated'})).toEqual([]);
  });
  it('missing or partial trade evidence never turns into measured zero', () => {
    const dataset = fixture(); dataset.matches[0]!.synergyEvidence = undefined;
    const partial = buildSynergy(dataset)[0]!;
    expect(partial.tradeEvidence.status).toBe('partial'); expect(partial.tradeEvidence.reconstructedRounds).toBe(19*24);
    for (const m of dataset.matches) m.synergyEvidence = undefined;
    expect(buildSynergy(dataset)[0]!.tradeEvidence).toEqual({status:'unavailable',reconstructedRounds:0});
  });
  it('missing KAST coverage is unavailable, not zero lift', () => {
    const dataset = fixture();
    for (const m of dataset.matches) for (const p of m.performances) p.advancedMetrics!.coverage.reconstructedRounds = 0;
    const r = buildSynergy(dataset)[0]!;
    expect(r.playerA.kastLift).toBeUndefined(); expect(r.components[1]!.normalized).toBeUndefined();
  });
  it('never enumerates a non-public participant or ambiguous team', () => {
    const dataset = fixture(1,0,0); dataset.players = dataset.players.slice(0,1);
    expect(buildSynergy(dataset)).toEqual([]);
    const ambiguous = fixture(1,0,0); delete ambiguous.matches[0]!.performances[1]!.teamGroup;
    expect(buildSynergy(ambiguous)).toEqual([]);
  });
  it('Demo covers positive, near-neutral, negative, insufficient and opponent cases', () => {
    const demo = demoDataSource.snapshot(); const results = buildSynergy(demo);
    expect(results.some((r) => r.value !== undefined && r.value > 55)).toBe(true);
    expect(results.some((r) => r.value !== undefined && Math.abs(r.value - 50) < 2)).toBe(true);
    expect(results.some((r) => r.value !== undefined && r.value < 45)).toBe(true);
    expect(results.some((r) => r.value === undefined)).toBe(true);
    expect(results.some((r) => [r.pair.playerAId,r.pair.playerBId].includes('quartz'))).toBe(false);
  });
});

describe('public pair trust boundary', () => {
  it('accepts only safe same-team public canonical edges and finite outcomes', () => {
    const dataset = fixture(1,0,0); const match = dataset.matches[0]!;
    const ids = new Set(dataset.players.map((p) => p.id));
    expect(validSynergyContract(match,ids)).toBe(true);
    for (const mutate of [
      (m: MatchRecord) => { m.synergyEvidence!.pairs[0]![0]=999; },
      (m: MatchRecord) => { m.performances[1]!.teamGroup='B'; },
      (m: MatchRecord) => { m.performances[0]!.teamGroup='Blue' as never; },
      (m: MatchRecord) => { m.performances[0]!.teamRoundsWon=NaN; },
      (m: MatchRecord) => { m.synergyEvidence!.pairs[0]![2]=-1; },
      (m: MatchRecord) => { Object.assign(m.synergyEvidence!,{participantHmac:'private'}); },
      (m: MatchRecord) => { m.synergyEvidence!.pairs.push(m.synergyEvidence!.pairs[0]!); },
    ]) { const bad = structuredClone(match); mutate(bad); expect(validSynergyContract(bad,ids)).toBe(false); }
  });
});
