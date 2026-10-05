import { describe, expect, it } from 'vitest';
import { createPerformanceEntries } from '../src/analytics/filters';
import { computeImprovementIndex, progressDirection, type ImprovementResult } from '../src/analytics/progress/improvementIndex';
import { improvementBenchmarks } from '../src/analytics/progress/benchmarks';
import { resolveProgressWindows } from '../src/analytics/progress/windows';
import { populationFromMatches } from '../src/analytics/scope/resolveScope';
import { policyFor } from '../src/analytics/scope/policies';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import type { MatchRecord, Player } from '../src/types/valorant';

const demo = demoDataSource.snapshot();
const player: Player = demo.players[0]!;
const pool = createPerformanceEntries(demo).filter((entry) => entry.playerId === player.id);
const day = 86_400_000;
const anchor = Date.UTC(2026, 9, 5, 12);

interface Spec { daysAgo: number; factor?: number; season?: string; template?: number; partialEvidence?: boolean; mode?: string; rounds?: number; thin?: boolean }

/** Clones fictional Demo performances (all eight dimensions scoreable) and scales skill by `factor`. */
function history(specs: Spec[], prefix = 'm'): MatchRecord[] {
  return specs.map((spec, index) => {
    const base = pool[(spec.template ?? index) % pool.length]!;
    const f = spec.factor ?? 1;
    const performance = { ...base.performance, kills: Math.round(base.performance.kills * f), acs: base.performance.acs * f, adr: base.performance.adr * f,
      ...(spec.partialEvidence ? { eventEvidence: { kast: 'partial' as const, opening: 'partial' as const }, kast: undefined, firstKills: undefined, firstDeaths: undefined } : {}) };
    // `thin`: production-like evidence — only basic stats and the economy domain are scoreable.
    if (spec.thin && performance.advancedMetrics) {
      const adv = performance.advancedMetrics;
      Object.assign(performance, { eventEvidence: { kast: 'partial', opening: 'partial' }, kast: undefined, firstKills: undefined, firstDeaths: undefined,
        advancedMetrics: { ...adv, evidence: { trade: 'unavailable', clutch: 'unavailable', objectives: 'unavailable', abilityCasts: 'unavailable', economy: adv.evidence.economy, impactContext: 'unavailable', roleValueInputs: 'unavailable' } } });
    }
    const extra = spec.rounds !== undefined ? { scoreFor: Math.ceil(spec.rounds / 2), scoreAgainst: Math.floor(spec.rounds / 2) } : {};
    return { ...base.match, ...extra, id: `${prefix}-${String(index).padStart(4, '0')}`, playedAt: new Date(anchor - spec.daysAgo * day).toISOString(),
      gameMode: spec.mode ?? 'Competitive', ...(spec.season ? { seasonKey: spec.season } : { seasonKey: undefined }), performances: [performance] };
  });
}

function run(matches: MatchRecord[], rank?: Parameters<typeof computeImprovementIndex>[2]): ImprovementResult {
  const entries = createPerformanceEntries({ players: [player], matches, sourceId: 't', isDemo: false, mode: 'REAL' });
  return computeImprovementIndex(player, resolveProgressWindows(entries, populationFromMatches(matches, true)), rank);
}

const spread = (count: number, spanDays: number, extra: (i: number) => Partial<Spec> = () => ({})) =>
  Array.from({ length: count }, (_, i): Spec => ({ daysAgo: count === 1 ? 0 : (i * spanDays) / (count - 1), ...extra(i) }));

describe('improvement-index-v1 direction and magnitude', () => {
  it('detects clear improvement, clear decline and stable performance', () => {
    const improving = run(history(spread(30, 28, (i) => ({ factor: i < 12 ? 1.1 : 0.7, season: 'e11a5' }))));
    expect(improving.direction).toBe('improving');
    expect(improving.value).toBeGreaterThan(improvementBenchmarks.stableBand);
    expect(improving.performance.rawDelta).toBeGreaterThan(0);
    const declining = run(history(spread(30, 28, (i) => ({ factor: i < 12 ? 0.7 : 1.1, season: 'e11a5' }))));
    expect(declining.direction).toBe('declining');
    expect(declining.value).toBeLessThan(-improvementBenchmarks.stableBand);
    const stable = run(history(spread(30, 28, () => ({ factor: 0.9, template: 0, season: 'e11a5' }))));
    expect(stable.direction).toBe('stable');
    expect(stable.value).toBeCloseTo(0, 10);
  });

  it('never rewards volume: identical play over 10 or 40 matches is 0, never higher', () => {
    const ten = run(history(spread(10, 9, () => ({ template: 0, season: 'e11a5' }))));
    const forty = run(history(spread(40, 39, () => ({ template: 0, season: 'e11a5' }))));
    for (const result of [ten, forty]) if (result.value !== undefined) expect(result.value).toBeCloseTo(0, 10);
    expect(forty.value ?? 0).toBeCloseTo(0, 10);
    expect(forty.activity.currentMatches + forty.activity.baselineMatches).toBeGreaterThan(ten.activity.currentMatches + ten.activity.baselineMatches);
  });

  it('shrinks a one-game outlier toward 0 through leave-one-match-out trend stability', () => {
    const specs = spread(30, 28, () => ({ factor: 0.8, template: 0, season: 'e11a5' }));
    specs[1] = { ...specs[1]!, factor: 3 };
    const result = run(history(specs));
    expect(result.performance.rawDelta).toBeGreaterThan(0);
    expect(result.performance.trendStability.status).toBe('available');
    expect(result.performance.trendStability.factor!).toBeLessThan(0.5);
    expect(result.reasons).toContain('outlier_sensitive');
    expect(Math.abs(result.value!)).toBeLessThan(Math.abs(result.performance.rawDelta! * 100 / improvementBenchmarks.performanceRange));
  });

  it('applies the documented shrink and signed bounded scale', () => {
    const result = run(history(spread(30, 28, (i) => ({ factor: i < 12 ? 1.1 : 0.7, season: 'e11a5' }))));
    const rCur = result.current.rounds; const rBase = result.baseline!.rounds;
    const rEff = (rCur * rBase) / (rCur + rBase);
    expect(result.performance.shrink).toBeCloseTo(rEff / (rEff + improvementBenchmarks.shrinkRounds), 12);
    expect(result.performance.demonstratedDelta).toBeCloseTo(result.performance.rawDelta! * result.performance.shrink * result.performance.trendStability.factor!, 12);
    expect(result.value!).toBeLessThanOrEqual(100);
    expect(progressDirection(9.999)).toBe('stable');
    expect(progressDirection(-9.999)).toBe('stable');
    expect(progressDirection(10)).toBe('improving');
    expect(progressDirection(-10)).toBe('declining');
  });
});

describe('improvement-index-v1 windows', () => {
  it('chooses windows from rounds/days/span, not a fixed match count (9 vs 180 days; short vs long)', () => {
    const dense = run(history(spread(30, 9, (i) => ({ factor: i < 12 ? 1.1 : 0.8, season: 'e11a5' }))));
    const sparse = run(history(spread(30, 180, (i) => ({ factor: i < 12 ? 1.1 : 0.8, season: 'e11a5' }))));
    expect(dense.current.matches).not.toBe(sparse.current.matches);
    // Same match count, different calendar density: the sparse player's window covers far more days.
    expect(sparse.current.spanDays).toBeGreaterThan(dense.current.spanDays);
    expect(sparse.current.spanDays).toBeLessThanOrEqual(policyFor('improvementIndex').window!.maxSpanDays);
    const policy = policyFor('improvementIndex').window!;
    const long = resolveProgressWindows(createPerformanceEntries({ players: [player], matches: history(spread(40, 20, () => ({ rounds: 30, season: 'e11a5' }))), sourceId: 't', isDemo: false, mode: 'REAL' }), populationFromMatches([], true));
    const short = resolveProgressWindows(createPerformanceEntries({ players: [player], matches: history(spread(40, 20, () => ({ rounds: 13, season: 'e11a5' }))), sourceId: 't', isDemo: false, mode: 'REAL' }), populationFromMatches([], true));
    expect(long.window.current.matches).toBeLessThan(short.window.current.matches);
    expect(long.window.current.rounds).toBeGreaterThanOrEqual(policy.targetRounds);
  });

  it('keeps current and baseline exactly non-overlapping and strictly older', () => {
    const result = resolveProgressWindows(createPerformanceEntries({ players: [player], matches: history(spread(30, 10, () => ({ season: 'e11a5' })).map((s, i) => ({ ...s, daysAgo: Math.floor(i / 3) }))), sourceId: 't', isDemo: false, mode: 'REAL' }), populationFromMatches([], true));
    const ids = new Set(result.window.currentEntries.map((e) => e.match.id));
    expect(result.window.baselineEntries.length).toBeGreaterThan(0);
    expect(result.window.baselineEntries.some((e) => ids.has(e.match.id))).toBe(false);
    const oldestCurrent = result.window.currentEntries.at(-1)!.match.playedAt;
    expect(result.window.baselineEntries.every((e) => e.match.playedAt <= oldestCurrent)).toBe(true);
  });

  it('uses Competitive only and is deterministic regardless of input order', () => {
    const matches = history(spread(36, 30, (i) => ({ factor: i < 12 ? 1.1 : 0.8, season: 'e11a5', mode: i % 4 === 3 ? 'Unrated' : 'Competitive' })));
    const a = run(matches);
    const b = run([...matches].reverse());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.current.matches + (a.baseline?.matches ?? 0)).toBeLessThanOrEqual(27);
  });

  it('a new cron match moves the windows deterministically without overlap', () => {
    const base = history(spread(30, 28, (i) => ({ factor: i < 12 ? 1.1 : 0.8, season: 'e11a5' })));
    const before = run(base);
    const newer = history([{ daysAgo: -1, factor: 1.1, season: 'e11a5' }], 'new');
    const after = run([...newer, ...base]);
    expect(after.current.to! > before.current.to!).toBe(true);
    expect(JSON.stringify(run([...newer, ...base]))).toBe(JSON.stringify(after));
  });
});

describe('improvement-index-v1 Act policy', () => {
  it('prefers a same-Act baseline when it is sufficient', () => {
    const result = run(history(spread(40, 35, (i) => ({ factor: i < 12 ? 1.1 : 0.8, season: 'e11a5' }))));
    expect(result.actPolicy).toBe('same_act');
    expect(result.seasonCrossed).toBe(false);
    expect(result.reasons).toContain('same_act_baseline');
    expect(result.confidence.comparability).toBeCloseTo(Math.min(1, result.performance.coverage / improvementBenchmarks.fullDimensionCoverage), 12);
  });

  it('falls back to the previous observed Act only explicitly, with lower comparability', () => {
    const matches = history(spread(32, 30, (i) => ({ factor: i < 11 ? 1.1 : 0.8, season: i < 11 ? 'e11a5' : 'e11a4' })));
    const result = run(matches);
    expect(result.actPolicy).toBe('previous_act_fallback');
    expect(result.seasonCrossed).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(['previous_act_fallback', 'season_crossed_in_baseline']));
    expect(result.status).toBe('partial');
    expect(result.confidence.comparability).toBeLessThanOrEqual(improvementBenchmarks.comparability.previous_act_fallback);
    const sameAct = run(history(spread(32, 30, (i) => ({ factor: i < 11 ? 1.1 : 0.8, season: 'e11a5' }))));
    expect(result.confidence.overall).toBeLessThan(sameAct.confidence.overall);
    expect(result.current.seasons).toEqual(['e11a5']);
  });

  it('labels missing Act evidence honestly and never guesses', () => {
    const result = run(history(spread(30, 28, (i) => ({ factor: i < 12 ? 1.1 : 0.8 }))));
    expect(result.actPolicy).toBe('act_unknown');
    expect(result.reasons).toContain('act_evidence_unknown');
    expect(result.confidence.comparability).toBeLessThanOrEqual(improvementBenchmarks.comparability.act_unknown);
  });
});

describe('improvement-index-v1 evidence and rank', () => {
  it('partial event evidence lowers confidence; missing dimensions never become zero', () => {
    const complete = run(history(spread(30, 28, (i) => ({ factor: i < 12 ? 1.1 : 0.8, season: 'e11a5' }))));
    const partial = run(history(spread(30, 28, (i) => ({ factor: i < 12 ? 1.1 : 0.8, season: 'e11a5', partialEvidence: i % 2 === 0 }))));
    expect(partial.confidence.evidence).toBeLessThan(complete.confidence.evidence);
    expect(partial.performance.dimensions.every((d) => Number.isFinite(d.current) && Number.isFinite(d.baseline))).toBe(true);
    const basicOnly = run(history(spread(30, 28, (i) => ({ factor: i < 12 ? 1.1 : 0.8, season: 'e11a5' }))).map((m) => ({ ...m, performances: m.performances.map((p) => ({ ...p, advancedMetrics: undefined })) })));
    if (basicOnly.status === 'unavailable') expect(basicOnly.value).toBeUndefined();
  });

  it('missing rank is unavailable, not zero, not a penalty; a future rank fixture contributes with its weight', () => {
    const matches = history(spread(30, 28, (i) => ({ factor: i < 12 ? 1.1 : 0.8, season: 'e11a5' })));
    const none = run(matches);
    expect(none.rank).toEqual({ status: 'unavailable', reason: 'not_ingested' });
    const empty = run(matches, {});
    expect(empty.rank).toEqual({ status: 'unavailable', reason: 'no_observations_in_windows' });
    expect(empty.value).toBe(none.value);
    const withRank = run(matches, { currentTier: 15, baselineTier: 12 });
    expect(withRank.rank).toEqual({ status: 'available', reason: 'available', delta: 3 });
    const p = Math.max(-1, Math.min(1, none.performance.demonstratedDelta! / improvementBenchmarks.performanceRange));
    const q = Math.max(-1, Math.min(1, (3 * none.performance.shrink) / improvementBenchmarks.rank.tierRange));
    expect(withRank.value).toBeCloseTo(100 * (0.75 * p + 0.25 * q), 10);
  });

  it('never shows a numeric direction below the confidence floor (production acceptance regression)', () => {
    const fixtures = [
      history(spread(30, 28, (i) => ({ factor: i < 12 ? 1.1 : 0.7, season: 'e11a5' }))),
      history(spread(30, 28, (i) => ({ factor: i < 12 ? 0.6 : 1.1, partialEvidence: true }))),
      history(spread(16, 225, (i) => ({ factor: i < 5 ? 0.6 : 1.1, partialEvidence: true }))),
      history(spread(16, 225, (i) => ({ factor: i < 5 ? 0.6 : 1.1, partialEvidence: true, template: 0 }))),
      history(spread(14, 200, (i) => ({ factor: i < 5 ? 1.3 : 0.7, partialEvidence: i % 3 !== 0 }))),
      history(spread(30, 28, (i) => ({ factor: i < 12 ? 0.6 : 1.1, thin: true }))),
    ];
    const results = fixtures.map((matches) => run(matches));
    for (const result of results) {
      if (result.value !== undefined) expect(result.confidence.overall).toBeGreaterThanOrEqual(improvementBenchmarks.minimumConfidence);
      if (result.performance.rawDelta !== undefined && result.confidence.overall < improvementBenchmarks.minimumConfidence) {
        expect(result).toMatchObject({ status: 'unavailable' });
        expect(result.value).toBeUndefined();
        expect(result.direction).toBeUndefined();
        expect(result.reasons).toContain('low_progress_confidence');
      }
    }
    expect(results.some((result) => result.reasons.includes('low_progress_confidence'))).toBe(true);
  });

  it('insufficient samples are unavailable with no numeric value', () => {
    const result = run(history(spread(6, 3, () => ({ season: 'e11a5' }))));
    expect(result.status).toBe('unavailable');
    expect(result.value).toBeUndefined();
    expect(result.direction).toBeUndefined();
  });
});
