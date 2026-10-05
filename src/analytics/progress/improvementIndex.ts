import { calculatePlayerScores } from '../../scoring/calculateScores.js';
import { defaultProfile, validateProfile } from '../../scoring/profiles.js';
import { dimensions, type Dimension } from '../../scoring/versions.js';
import type { MatchRecord, Player } from '../../types/valorant.js';
import { aggregatePlayerStats } from '../../utils/aggregateStats.js';
import { toObservation } from '../scope/observations.js';
import type { ScopeReason, ScopeStatus, WindowSample } from '../scope/types.js';
import type { PerformanceEntry } from '../types.js';
import { IMPROVEMENT_BENCHMARK_VERSION, IMPROVEMENT_INDEX_VERSION, improvementBenchmarks as B } from './benchmarks.js';
import type { ActPolicy, ProgressWindows } from './windows.js';

export type ProgressDirection = 'improving' | 'stable' | 'declining';

/** Future TASK-DATA-RANK-01 input; absent today (never fabricated, never neutral, never zero). */
export interface RankWindowEvidence {
  /** Mean ordinal tier score of real observations dated inside each window's span. */
  currentTier?: number;
  baselineTier?: number;
}

export interface DimensionDelta { dimension: Dimension; weight: number; current: number; baseline: number; delta: number }

export interface ImprovementResult {
  version: typeof IMPROVEMENT_INDEX_VERSION;
  benchmarkVersion: typeof IMPROVEMENT_BENCHMARK_VERSION;
  status: ScopeStatus;
  /** Signed −100..+100; present only when the comparison is scoreable. */
  value?: number;
  direction?: ProgressDirection;
  current: WindowSample;
  baseline?: WindowSample;
  seasonCrossed: boolean;
  actPolicy: ActPolicy;
  performance: {
    /** Profile-weighted mean of dimension deltas numeric in BOTH windows (equals the Overall delta when the same dimensions are available). */
    rawDelta?: number;
    coverage: number;
    dimensions: DimensionDelta[];
    shrink: number;
    trendStability: { status: ScopeStatus; factor?: number; runs: number; scoreableRuns: number };
    demonstratedDelta?: number;
  };
  rank: { status: ScopeStatus; reason: 'not_ingested' | 'no_observations_in_windows' | 'available'; delta?: number };
  activity: { currentMatches: number; currentRounds: number; currentMinutes: number; currentDays: number; baselineMatches: number; baselineRounds: number; baselineMinutes: number; baselineDays: number };
  confidence: { sample: number; temporal: number; evidence: number; comparability: number; overall: number };
  reasons: ScopeReason[];
}

const profile = validateProfile(defaultProfile);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function dimensionValues(player: Player, entries: PerformanceEntry[]): Partial<Record<Dimension, number>> {
  if (entries.length === 0) return {};
  const matches: MatchRecord[] = entries.map(({ match, performance }) => ({ ...match, performances: [performance] }));
  const scores = calculatePlayerScores(player, aggregatePlayerStats(player, matches), matches);
  return Object.fromEntries(dimensions.flatMap((key) => (scores[key].value === undefined ? [] : [[key, scores[key].value]]))) as Partial<Record<Dimension, number>>;
}

/** Weighted delta over a FIXED dimension set; undefined if any of those dimensions is missing. */
function deltaOver(set: Dimension[], current: Partial<Record<Dimension, number>>, baseline: Partial<Record<Dimension, number>>): number | undefined {
  if (set.some((key) => current[key] === undefined || baseline[key] === undefined)) return undefined;
  const weight = set.reduce((sum, key) => sum + profile.weights[key], 0);
  return set.reduce((sum, key) => sum + profile.weights[key] * (current[key]! - baseline[key]!), 0) / weight;
}

function evidenceShare(entries: PerformanceEntry[]): number {
  const observations = entries.map(toObservation);
  const rounds = observations.reduce((sum, item) => sum + item.rounds, 0);
  return rounds > 0 ? observations.filter((item) => item.evidenceComplete).reduce((sum, item) => sum + item.rounds, 0) / rounds : 0;
}

/** Stable band boundary: |value| < stableBand is 'stable' (product calibration, boundary-tested). */
export function progressDirection(value: number): ProgressDirection {
  return Math.abs(value) < B.stableBand ? 'stable' : value > 0 ? 'improving' : 'declining';
}

const days = (sample: WindowSample) => (sample.matches === 0 ? 0 : Math.max(1, Math.ceil(sample.spanDays)));

/**
 * improvement-index-v1. Performance change is primary and shrunk toward 0 (no demonstrated change).
 * Volume decides windows and confidence only: identical play over more matches never raises the value.
 */
export function computeImprovementIndex(player: Player, resolved: ProgressWindows, rank?: RankWindowEvidence): ImprovementResult {
  const { window, actPolicy } = resolved;
  const reasons = new Set<ScopeReason>(window.reasons);
  const baseline = window.baseline;
  const activity = {
    currentMatches: window.current.matches, currentRounds: window.current.rounds, currentMinutes: window.current.minutes, currentDays: days(window.current),
    baselineMatches: baseline?.matches ?? 0, baselineRounds: baseline?.rounds ?? 0, baselineMinutes: baseline?.minutes ?? 0, baselineDays: baseline ? days(baseline) : 0,
  };
  if (actPolicy === 'same_act') reasons.add('same_act_baseline');
  if (actPolicy === 'previous_act_fallback') reasons.add('previous_act_fallback');
  if (actPolicy === 'act_unknown') reasons.add('act_evidence_unknown');
  const rankStatus: ImprovementResult['rank'] = rank?.currentTier !== undefined && rank.baselineTier !== undefined
    ? { status: 'available', reason: 'available', delta: rank.currentTier - rank.baselineTier }
    : { status: 'unavailable', reason: rank ? 'no_observations_in_windows' : 'not_ingested' };
  const base = {
    version: IMPROVEMENT_INDEX_VERSION, benchmarkVersion: IMPROVEMENT_BENCHMARK_VERSION,
    current: window.current, ...(baseline ? { baseline } : {}),
    seasonCrossed: window.boundaries.seasonCrossed, actPolicy, rank: rankStatus, activity,
  };
  const emptyConfidence = { sample: 0, temporal: window.confidence.temporal, evidence: 0, comparability: 0, overall: 0 };
  const noTrend = { status: 'unavailable' as const, runs: 0, scoreableRuns: 0 };

  if (window.status === 'unavailable' || !baseline) {
    return { ...base, status: 'unavailable', performance: { coverage: 0, dimensions: [], shrink: 0, trendStability: noTrend }, confidence: emptyConfidence, reasons: [...reasons].sort() };
  }

  const currentValues = dimensionValues(player, window.currentEntries);
  const baselineValues = dimensionValues(player, window.baselineEntries);
  const common = dimensions.filter((key) => currentValues[key] !== undefined && baselineValues[key] !== undefined);
  const coverage = common.reduce((sum, key) => sum + profile.weights[key], 0);
  const dimensionDeltas = common.map((key) => ({ dimension: key, weight: profile.weights[key], current: currentValues[key]!, baseline: baselineValues[key]!, delta: currentValues[key]! - baselineValues[key]! }));
  const rCur = window.current.rounds;
  const rBase = baseline.rounds;
  const rEff = rCur + rBase > 0 ? (rCur * rBase) / (rCur + rBase) : 0;
  const shrink = rEff / (rEff + B.shrinkRounds);

  const confidence = {
    sample: Math.sqrt(Math.min(rCur / B.confidenceRounds, 1) * Math.min(rBase / B.confidenceRounds, 1)),
    temporal: window.confidence.temporal,
    evidence: Math.min(evidenceShare(window.currentEntries), evidenceShare(window.baselineEntries)),
    comparability: B.comparability[actPolicy] * Math.min(1, coverage / B.fullDimensionCoverage),
    overall: 0,
  };
  confidence.overall = Math.sqrt(confidence.sample * confidence.temporal) * (0.5 + 0.5 * confidence.evidence) * confidence.comparability;

  const rawDelta = coverage >= B.minDimensionCoverage ? deltaOver(common, currentValues, baselineValues) : undefined;
  if (rawDelta === undefined) {
    reasons.add('insufficient_dimension_overlap');
    return { ...base, status: 'unavailable', performance: { coverage, dimensions: dimensionDeltas, shrink, trendStability: noTrend }, confidence, reasons: [...reasons].sort() };
  }

  // Trend stability: leave-one-current-match-out (jackknife) over the SAME dimension set.
  // The worst retained share of the claimed change stops one outlier game from driving the result.
  const runs = window.currentEntries.length;
  const jackknife = window.currentEntries.map((_, index) => deltaOver(common, dimensionValues(player, window.currentEntries.filter((__, i) => i !== index)), baselineValues))
    .filter((value): value is number => value !== undefined);
  let trendStability: ImprovementResult['performance']['trendStability'];
  let stabilityFactor = 1;
  if (rawDelta === 0) trendStability = { status: 'available', factor: 1, runs, scoreableRuns: jackknife.length };
  else if (runs > 0 && jackknife.length / runs >= B.minJackknifeShare) {
    stabilityFactor = clamp(Math.min(...jackknife.map((value) => Math.sign(rawDelta) * value)) / Math.abs(rawDelta), 0, 1);
    trendStability = { status: 'available', factor: stabilityFactor, runs, scoreableRuns: jackknife.length };
    if (stabilityFactor < 0.5) reasons.add('outlier_sensitive');
  } else {
    trendStability = { status: 'unavailable', runs, scoreableRuns: jackknife.length };
    reasons.add('trend_stability_unavailable');
  }

  const demonstratedDelta = rawDelta * shrink * stabilityFactor;
  // A weak comparison must not look confident: below the floor no value or direction is shown.
  if (confidence.overall < B.minimumConfidence) {
    reasons.add('low_progress_confidence');
    return { ...base, status: 'unavailable', performance: { rawDelta, coverage, dimensions: dimensionDeltas, shrink, trendStability, demonstratedDelta }, confidence, reasons: [...reasons].sort() };
  }
  const performanceNorm = clamp(demonstratedDelta / B.performanceRange, -1, 1);
  // Rank is optional evidence: renormalize when absent (never zero, never a neutral observation).
  const value = rankStatus.status === 'available'
    ? 100 * ((1 - B.rank.weight) * performanceNorm + B.rank.weight * clamp((rankStatus.delta! * shrink) / B.rank.tierRange, -1, 1))
    : 100 * performanceNorm;
  const direction = progressDirection(value);
  const weak = confidence.overall < B.availableConfidence || coverage < B.fullDimensionCoverage
    || trendStability.status !== 'available' || actPolicy !== 'same_act' || window.status !== 'available';
  return {
    ...base, status: weak ? 'partial' : 'available', value, direction,
    performance: { rawDelta, coverage, dimensions: dimensionDeltas, shrink, trendStability, demonstratedDelta },
    confidence, reasons: [...reasons].sort(),
  };
}
