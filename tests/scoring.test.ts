import { describe, expect, it } from 'vitest';
import { demoMatches } from '../src/data/demoMatches';
import { players } from '../src/data/players';
import { calculatePlayerScores, calculateConfidence, overallResult, compareScoreResults } from '../src/scoring/calculateScores';
import { aggregatePlayerStats } from '../src/utils/aggregateStats';
import { normalizeRange } from '../src/scoring/normalize';
import { normalizeBenchmark } from '../src/scoring/normalize';
import { benchmarkFor } from '../src/scoring/benchmarks';
import { dimensions } from '../src/scoring/versions';
import { defaultProfile, validateProfile } from '../src/scoring/profiles';
import { dimensionResult } from '../src/scoring/components';
import type { MatchRecord } from '../src/types/valorant';
import type { ComponentTrace, ScoreResult } from '../src/scoring/types';

const player=players[0]!;
const own=demoMatches.filter((match) => match.performances.some((p) => p.playerId === player.id));
function score(matches: MatchRecord[]=own) { return calculatePlayerScores(player,aggregatePlayerStats(player,matches),matches); }
function transform(fn: (p: MatchRecord['performances'][number]) => void, matches=own) {
  const copy=structuredClone(matches);
  for(const match of copy) for(const p of match.performances) if(p.playerId===player.id) fn(p);
  return copy;
}
const trace=(weight:number,value?:number):ComponentTrace => ({metric:'acs',configuredWeight:weight,usedWeight:0,evidenceStatus:'complete',benchmark:benchmarkFor('acs','Duelist'),denominator:20,observedCoverage:1,...(value!==undefined ? {normalizedValue:value}: {})});
const sample={matches:20,rounds:400};
describe('versioned evidence-aware normalization',() => {
  it('clamps higher and lower ranges and rejects invalid input without fake zero',() => {
    expect(normalizeRange(-1,0,10)).toBe(0); expect(normalizeRange(5,0,10)).toBe(50);expect(normalizeRange(20,0,10)).toBe(100);
    expect(normalizeRange(3,10,0)).toBe(70);
    for(const value of [NaN,Infinity,-Infinity]) expect(normalizeRange(value,0,1)).toBeUndefined();
    expect(normalizeRange(5,5,5)).toBeUndefined();
  });
  it('retains full calculation precision',() => {
    const matches=transform((p) => {p.acs=200.123456789;p.adr=140.987654321;});
    expect(aggregatePlayerStats(player,matches).acs).toBeCloseTo(200.123456789,8);
    expect(score(matches).firepower.value).not.toBe(Number(score(matches).firepower.value!.toFixed(1)));
  });
  it.each([.69,.7,.99,1])('uses explicit 70 percent component gate %s',(weight) => {
    const result=dimensionResult('firepower',[trace(weight,80),trace(1-weight)],sample);
    expect(result.value).toBe(weight<.7 ? undefined : 80);
    expect(result.status).toBe(weight<.7?'unavailable':weight===1?'available':'partial');
    expect(result.coverage.ratio).toBe(weight);
  });
  it('validates extensible profiles',() => {
    expect(Object.values(validateProfile(defaultProfile).weights).reduce((a,b)=>a+b,0)).toBeCloseTo(1);
    for(const bad of [-1,NaN,Infinity]) expect(()=>validateProfile({...defaultProfile,weights:{...defaultProfile.weights,firepower:bad}})).toThrow();
    expect(()=>validateProfile({...defaultProfile,weights:Object.fromEntries(dimensions.map((key)=>[key,0])) as typeof defaultProfile.weights})).toThrow();
    expect(()=>validateProfile({...defaultProfile,weights:{firepower:1} as typeof defaultProfile.weights})).toThrow();
  });
});
describe('eight dimension formulas and evidence safety',() => {
  it('has deterministic fictional samples and bounded scores for all eight dimensions',() => {
    expect(demoMatches).toHaveLength(32);expect(players).toHaveLength(8);
    for(const p of players) {
      const result=calculatePlayerScores(p,aggregatePlayerStats(p,demoMatches),demoMatches);
      for(const key of [...dimensions,'overall'] as const) {
        expect(result[key].status).toBe('available');expect(result[key].value).toBeGreaterThanOrEqual(0);expect(result[key].value).toBeLessThanOrEqual(100);
        expect(result[key].trace.components.every((c)=>c.usedWeight>=0)).toBe(true);
      }
    }
  });
  it('empty and zero-round samples have no numeric score',() => {
    for(const matches of [[],own.map((m)=>({...m,scoreFor:0,scoreAgainst:0}))]) {
      const result=score(matches);for(const key of [...dimensions,'overall'] as const) expect(result[key].value).toBeUndefined();
    }
  });
  it('firepower matches documented weighted normalization',() => {
    const result=score(transform((p)=>{p.agent='Jett';}));
    const components=result.firepower.trace.components;
    expect(result.firepower.value).toBeCloseTo(components.reduce((sum,c)=>sum+c.normalizedValue!*c.configuredWeight,0),10);
    expect(components.map((c)=>c.configuredWeight)).toEqual([.35,.30,.20,.15]);
  });
  it('missing deaths denominator omits KD, not a pseudo death',() => {
    const matches=transform((p)=>{p.deaths=0;});
    expect(aggregatePlayerStats(player,matches).kd).toBeUndefined();
    expect(score(matches).firepower.status).toBe('partial');
    expect(score(matches).firepower.trace.components.every((c)=>c.metric!=='kd'||c.rawValue===undefined)).toBe(true);
  });
  it('missing advanced evidence does not manufacture scores',() => {
    const result=score(transform((p)=>{delete p.advancedMetrics;}));
    expect(result.roundImpact.value).toBeUndefined();expect(result.economy.value).toBeUndefined();expect(result.clutch.value).toBeUndefined();
    expect(result.overall.value).toBeUndefined();expect(result.teamplay.status).toBe('unavailable');
  });
  it('partial and mixed reconstruction versions do not become complete evidence',() => {
    const partial=score(transform((p)=>{p.advancedMetrics!.evidence.trade='partial';}));
    expect(partial.teamplay.value).toBeUndefined();
    const stale=score(transform((p)=>{p.advancedMetrics!.ruleVersion='unverified-v2';}));
    expect(stale.roundImpact.value).toBeUndefined();
  });
  it('entry uses inverse first deaths not FK/FD',() => {
    const low=score(transform((p)=>{p.firstDeaths=0;})), high=score(transform((p)=>{p.firstDeaths=10;}));
    expect(low.entry.value!).toBeGreaterThan(high.entry.value!);
    expect(low.entry.trace.components.map((c)=>c.metric)).not.toContain('fkFd');
  });
  it('teamplay excludes match outcome and ability cast volume',() => {
    const before=score(); const matches=transform((p)=>{p.advancedMetrics!.abilityCasts!.ability1Casts=999999;}).map((m)=>({...m,won:!m.won}));
    expect(score(matches).teamplay.value).toBe(before.teamplay.value);
    expect(score(matches).roleValue.value).toBe(before.roleValue.value);
  });
  it('round impact rewards observed disadvantage and multikills without counting opening twice',() => {
    const result=score();expect(result.roundImpact.trace.components.map((c)=>c.metric)).toEqual(['disadvantage','tradeKills','clutchState','multiKill','wonKills']);
    expect(score(transform((p)=>{p.advancedMetrics!.impactContext!.manDisadvantageKills=0;})).roundImpact.value!).toBeLessThan(result.roundImpact.value!);
  });
  it('clutch uses the explicit 20 percent / 5 attempt prior and zero attempts unavailable',() => {
    const result=score(transform((p)=>{p.agent='Jett';p.advancedMetrics!.clutch={clutchAttempts:1,clutchWins:1,attemptsByOpponents:{1:1},winsByOpponents:{1:1}};}));
    expect(result.clutch.trace.prior!.shrunkConversion).toBeCloseTo(21/25);
    expect(result.clutch.trace.components[0]!.rawValue).toBeCloseTo(21/25);
    expect(score(transform((p)=>{p.advancedMetrics!.clutch={clutchAttempts:0,clutchWins:0};})).clutch.value).toBeUndefined();
  });
  it('difficulty weighting changes clutch value',() => {
    const one=score(transform((p)=>{p.advancedMetrics!.clutch={clutchAttempts:1,clutchWins:1,winsByOpponents:{1:1}};}));
    const five=score(transform((p)=>{p.advancedMetrics!.clutch={clutchAttempts:1,clutchWins:1,winsByOpponents:{5:1}};}));
    expect(five.clutch.value!).toBeGreaterThan(one.clutch.value!);
  });
  it('economy uses summed positive-spend tuples; zero spend unavailable and loadout irrelevant',() => {
    const result=score();const spent=result.economy.trace.components[0]!.denominator;
    expect(spent).toBeGreaterThan(0);expect(result.economy.trace.components.map((c)=>c.metric)).toEqual(['damageEfficiency','killEfficiency']);
    expect(score(transform((p)=>{p.advancedMetrics!.economy!.loadoutValueTotal=999999;})).economy.value).toBe(result.economy.value);
    expect(score(transform((p)=>{p.advancedMetrics!.economy!.spentTotal=0;})).economy.value).toBeUndefined();
    expect(score(transform((p)=>{delete p.advancedMetrics!.economy!.damage;p.advancedMetrics!.economy!.damagePer1000SpentStatus='unavailable';})).economy.value).toBeUndefined();
  });
  it.each([1,4,5,9,10])('consistency requires five pairs, partial through nine (%s)',(n) => {
    const result=score(own.slice(0,n)).consistency;
    expect(result.status).toBe(n<5?'unavailable':n<10?'partial':'available');
    if(n>=5) expect(result.trace.components[1]!.metric).toBe('kastSd');
  });
  it('constant nonzero ACS and KAST yield stable maximum, zero ACS cannot fabricate CV',() => {
    expect(score(transform((p)=>{p.acs=200;p.kast=.75;})).consistency.value).toBe(100);
    expect(score(transform((p)=>{p.acs=0;})).consistency.value).toBeUndefined();
  });
  it('selected agent role overrides stale profile; mixed roles normalize separately',() => {
    const matches=transform((p)=>{p.agent='Omen';});
    expect(score(matches).firepower.trace.selectedRole).toBe('Controller');
    expect(score(matches).firepower.trace.components.every((c)=>c.benchmark.context==='Controller')).toBe(true);
    const mixed=transform((p)=>{p.agent='Omen';},own.slice(0,10)).concat(transform((p)=>{p.agent='Jett';},own.slice(10)));
    const result=score(mixed);expect(Object.keys(result.firepower.trace.roles!)).toHaveLength(2);
    expect(result.roleValue.trace.components).toHaveLength(10);
    const unknown=transform((p)=>{p.agent='Unknown' as typeof p.agent;});expect(score(unknown).overall.value).toBeUndefined();
  });
  it('trace is aggregate-only and deterministic, with versions and explicit renormalized weights',() => {
    const a=score(),b=score();expect(a).toEqual(b);
    const serialized=JSON.stringify(a);for(const blocked of ['playerId','matchId','puuid','hmac','coordinates','timeline']) expect(serialized.toLowerCase()).not.toContain(blocked.toLowerCase());
    expect(a.overall.trace.profileVersion).toBe('overall-profile-v1');
  });
  it('all derived normalization components have a registered benchmark',() => {
    for(const key of dimensions) for(const component of score()[key].trace.components) expect(normalizeBenchmark(component.rawValue,component.benchmark)).toEqual(component.normalizedValue);
  });
});
describe('overall gates, ordering and confidence',() => {
  const complete=score();
  function subset(keys:typeof dimensions[number][]) {
    return Object.fromEntries(dimensions.map((key)=>[key,keys.includes(key)?complete[key]:{...complete[key],status:'unavailable',value:undefined}])) as Record<typeof dimensions[number],ScoreResult>;
  }
  it('requires six dimensions even when five exceed 75 percent weight',() => {
    const weights={firepower:20,roundImpact:20,entry:20,teamplay:20,clutch:20,economy:1,consistency:1,roleValue:1};
    expect(overallResult(subset(dimensions.slice(0,5)),sample,{version:'custom-v1',weights}).value).toBeUndefined();
  });
  it('requires 75 percent configured weight, partial with six sufficiently weighted dimensions',() => {
    const pass=overallResult(subset(dimensions.filter((d)=>d!=='clutch'&&d!=='roleValue')),sample);
    expect(pass.status).toBe('partial');expect(pass.coverage.ratio).toBeCloseTo(.82);
    expect(overallResult(subset(dimensions.filter((d)=>d!=='firepower'&&d!=='roundImpact')),sample).value).toBeUndefined();
  });
  it('orders available before partial before unavailable irrespective of numeric value',() => {
    const rows=[{...complete.overall,status:'partial' as const,value:100},{...complete.overall,status:'unavailable' as const,value:undefined},{...complete.overall,value:1}];
    expect(rows.sort(compareScoreResults).map((r)=>r.status)).toEqual(['available','partial','unavailable']);
  });
  it('keeps confidence independent of performance and sensitive to rounds and coverage',() => {
    expect(calculateConfidence(30,600,1)).toBe(100);expect(calculateConfidence(30,600,.5)).toBe(50);expect(calculateConfidence(30,300,1)).toBeCloseTo(100*Math.sqrt(.5));
    expect(calculateConfidence(0,600,1)).toBe(0);expect(calculateConfidence(30,0,1)).toBe(0);
  });
});
