import { describe,expect,it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggregateAdvancedMetrics } from '../src/analytics/advancedMetrics';
import { benchmarkRegistry } from '../src/scoring/benchmarks';
import { normalizeBenchmark } from '../src/scoring/normalize';
import { GapRadarShape } from '../src/components/GapRadarShape';
import { ScoreExplanation } from '../src/components/ScoreExplanation';
import { demoMatches } from '../src/data/demoMatches';
import { players } from '../src/data/players';
import { aggregatePlayerStats } from '../src/utils/aggregateStats';
import { calculatePlayerScores } from '../src/scoring/calculateScores';
import { selectPerformances,createPerformanceEntries,defaultAnalysisFilters } from '../src/analytics/filters';
import { rankPlayers } from '../src/analytics/rankings';
import { calculateRecentForm,computeBadges } from '../src/analytics/analysis';
import { formatScore } from '../src/utils/format';
import type { MatchRecord } from '../src/types/valorant';

describe('all benchmark registry entries',()=>{
  it.each(benchmarkRegistry)('$context $metric validates endpoints, direction and invalid input',(benchmark)=>{
    expect(normalizeBenchmark(benchmark.poor,benchmark)).toBe(0);
    expect(normalizeBenchmark(benchmark.strong,benchmark)).toBe(100);
    expect(normalizeBenchmark((benchmark.poor+benchmark.strong)/2,benchmark)).toBeCloseTo(50);
    expect(normalizeBenchmark(undefined,benchmark)).toBeUndefined();
    expect(normalizeBenchmark(Infinity,benchmark)).toBeUndefined();
    expect(normalizeBenchmark(NaN,benchmark)).toBeUndefined();
    const low=normalizeBenchmark(Math.min(benchmark.poor,benchmark.strong)+Math.abs(benchmark.strong-benchmark.poor)*.1,benchmark)!;
    const high=normalizeBenchmark(Math.max(benchmark.poor,benchmark.strong)-Math.abs(benchmark.strong-benchmark.poor)*.1,benchmark)!;
    if(benchmark.direction==='higher') expect(high).toBeGreaterThan(low);else expect(high).toBeLessThan(low);
    expect(benchmark.version).toBe('community-benchmarks-v1');
  });
});
const player=players[0]!;
const own=demoMatches.filter((m)=>m.performances.some((p)=>p.playerId===player.id));
function score(matches:MatchRecord[]){return calculatePlayerScores(player,aggregatePlayerStats(player,matches),matches);}
function mutate(fn:(p:MatchRecord['performances'][number])=>void,matches=own){
  const copy=structuredClone(matches);for(const m of copy) for(const p of m.performances) if(p.playerId===player.id) fn(p);return copy;
}
describe('selected evidence and presentation integration',()=>{
  it('80 percent component evidence produces partial without masking it',()=>{
    const result=score(mutate((p)=>{p.advancedMetrics!.evidence.trade='unavailable';}));
    expect(result.roundImpact.status).toBe('partial');expect(result.roundImpact.coverage.ratio).toBeCloseTo(.8);
    expect(formatScore(result.roundImpact)).toContain('部分證據 80%');
    expect(renderToStaticMarkup(<ScoreExplanation score={result.roundImpact}/>)).toContain('評分依據');
  });
  it('complete-domain subset coverage preserves partial status and confidence',()=>{
    const matches=mutate(()=>{});for(const m of matches.slice(0,4)) m.performances.find((p)=>p.playerId===player.id)!.advancedMetrics!.evidence.impactContext='partial';
    const result=score(matches);expect(result.roundImpact.status).toBe('partial');
    expect(result.roundImpact.coverage.observedRatio!).toBeLessThan(1);
    expect(result.roundImpact.confidence).toBeLessThan(score(own).roundImpact.confidence);
  });
  it('malformed complete-domain count is not upgraded into measured zero',()=>{
    expect(score(mutate((p)=>{p.advancedMetrics!.trade!.tradeKills=NaN;})).teamplay.value).toBeUndefined();
  });
  it('missing difficulty distribution does not fabricate weighted wins',()=>{
    const result=score(mutate((p)=>{p.advancedMetrics!.clutch={clutchAttempts:2,clutchWins:1};}));
    expect(result.clutch.status).toBe('partial');expect(result.clutch.coverage.ratio).toBeCloseTo(.8);
    expect(result.clutch.trace.components.filter((c)=>c.metric==='difficultWins').every((c)=>c.rawValue===undefined)).toBe(true);
  });
  it('unavailable economy ratio cannot be upgraded by complete enclosing status',()=>{
    const matches=mutate((p)=>{delete p.advancedMetrics!.economy!.damage;p.advancedMetrics!.economy!.damagePer1000SpentStatus='unavailable';});
    const result=aggregateAdvancedMetrics(matches.flatMap((m)=>m.performances.filter((p)=>p.playerId===player.id)));
    expect(result.economy.value?.damagePer1000SpentStatus).toBe('unavailable');
    expect(result.economy.value?.damagePer1000Spent).toBeUndefined();
  });
  it('one successful clutch is shrunk below twenty successful attempts',()=>{
    const make=(n:number)=>score(mutate((p)=>{p.agent='Jett';p.advancedMetrics!.clutch={clutchAttempts:n,clutchWins:n,winsByOpponents:{1:n}};},own.slice(0,1)));
    expect(make(1).clutch.value!).toBeLessThan(make(20).clutch.value!);
    expect(make(1).clutch.trace.prior!.shrunkConversion).toBeCloseTo(2/6);
  });
  it('mixed-role context and role filtering ignore stale profile labels',()=>{
    const matches=mutate((p)=>{p.agent='Omen';});
    const dataset={players:[player],matches,mode:'DEMO' as const,isDemo:true,sourceId:'fixture'};
    const selection=selectPerformances(createPerformanceEntries(dataset),{...defaultAnalysisFilters,role:'Controller'});
    expect(selection.entries).toHaveLength(matches.filter((m)=>m.gameMode==='Competitive').length);
    expect(rankPlayers(selection,defaultAnalysisFilters,'roleValue')[0]!.analytics.scores.roleValue.trace.selectedRole).toBe('Controller');
  });
  it('rankings preserve sub-display precision and missing rows have no number',()=>{
    const p1={...player,id:'precision-a',handle:'Z'},p2={...player,id:'precision-b',handle:'A'};
    const matches=own.map((m)=>({...m,performances:[p1,p2].map((p,index)=>({...m.performances.find((row)=>row.playerId===player.id)!,playerId:p.id,agent:'Jett' as const,acs:220+(index===0?.0001:0)}))}));
    const selection=selectPerformances(createPerformanceEntries({players:[p1,p2],matches,mode:'DEMO',isDemo:true,sourceId:'precision'}),defaultAnalysisFilters);
    const ranked=rankPlayers(selection,defaultAnalysisFilters,'firepower');
    expect(ranked[0]!.analytics.player.id).toBe('precision-a');
    expect(ranked[0]!.value!-ranked[1]!.value!).toBeLessThan(.1);
    expect(formatScore(ranked[0]!.value)).toBe(formatScore(ranked[1]!.value));
    const noEvidence=mutate((p)=>{delete p.advancedMetrics;});
    const missing=selectPerformances(createPerformanceEntries({players:[player],matches:noEvidence,mode:'DEMO',isDemo:true,sourceId:'missing'}),defaultAnalysisFilters);
    expect(rankPlayers(missing,defaultAnalysisFilters,'overall')[0]!.value).toBeUndefined();
    expect(computeBadges(missing).every((b)=>!['clutch','roundImpact','economy'].includes(b.id))).toBe(true);
    expect(calculateRecentForm(player,missing.entries).status).toBe('insufficient');
  });
  it('missing radar vertices create gaps, never a center-zero polygon',()=>{
    const output=renderToStaticMarkup(<GapRadarShape points={[{x:10,y:20,value:70},{x:50,y:50,value:null},{x:80,y:90,value:60}]} stroke="green"/>);
    expect(output).not.toContain('polygon');expect(output).not.toContain('cx="50"');
    expect((output.match(/<line/g)??[])).toHaveLength(1);expect((output.match(/<circle/g)??[])).toHaveLength(2);
  });
  it('same observables can yield distinct role value without cast scoring',()=>{
    expect(score(mutate((p)=>{p.agent='Jett';})).roleValue.value).not.toEqual(score(mutate((p)=>{p.agent='Omen';})).roleValue.value);
  });
});
