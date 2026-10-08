import type { PairMatchEvidence } from '../sharedMatch/pairEvidence.js';
import { calibrate, scoreUnits, type ScoredUnit } from '../sharedMatch/rating.js';
import { CANDIDATE_IDS, candidateScores, type CandidateId } from './candidates.js';
import { buildEvidenceTable, type EvidenceInput, type MemberEvidence } from './evidence.js';

/**
 * TASK-SCORING-INTERNAL-STRENGTH-01 — chronological MATCH-LEVEL holdout.
 *   - Split points are times taken from the ordered distinct shared matches; a match is train iff it started strictly
 *     before the split time, so all pair units of one match (A–B, A–C, …) fall on the same side. No unit split.
 *   - Training evidence = buildEvidenceTable(input, split): every family sees only evidence before the split
 *     (shared pairs, Competitive matches, rank observations).
 *   - Target = the accepted shared-match-rating-v1 unit outcome of each TEST unit, with σ / neutral band calibrated
 *     on TRAIN units only. NEUTRAL target units are reported, never counted as hits or misses.
 *   - Prediction for a test unit: the member with the higher candidate score is predicted to outperform. Equal or
 *     missing scores = no prediction (counted in coverage).
 */
export interface Fold { train: string; testFrom: string; testTo: string | null }

/** Distinct eligible shared matches in time order (ties broken by ref for determinism). */
export function orderedMatches(pairs: readonly PairMatchEvidence[]): { matchRef: string; playedAt: string }[] {
  const byRef = new Map<string, string>();
  for (const pair of pairs) byRef.set(pair.matchRef, pair.playedAt);
  return [...byRef.entries()].map(([matchRef, playedAt]) => ({ matchRef, playedAt }))
    .sort((x, y) => Date.parse(x.playedAt) - Date.parse(y.playedAt) || (x.matchRef < y.matchRef ? -1 : x.matchRef > y.matchRef ? 1 : 0));
}

/** Split time at fraction q of the ordered shared matches. */
export function splitTime(pairs: readonly PairMatchEvidence[], q: number): string {
  const matches = orderedMatches(pairs);
  if (matches.length < 2) throw new Error('holdout needs at least two shared matches');
  const index = Math.min(matches.length - 1, Math.max(1, Math.floor(matches.length * q)));
  return matches[index]!.playedAt;
}

export interface UnitPrediction { unit: ScoredUnit; predicted: 'A' | 'B' | null; sameRole: boolean; trainSharedForPair: number }

export interface CandidateEvaluation {
  candidate: CandidateId;
  testUnits: number;
  decisiveUnits: number;
  neutralUnits: number;
  predicted: number;
  correct: number;
  accuracy: number | null;
  /** Mean of per-pair accuracies (each evidenced pair counts once; frequent pairs cannot dominate). */
  pairWeightedAccuracy: number | null;
  /** Share of decisive units that received a prediction. */
  coverage: number;
  sameRoleAccuracy: number | null;
  crossRoleAccuracy: number | null;
  byTrainEvidence: Record<'lt10' | '10to25' | 'gt25', { units: number; accuracy: number | null }>;
  byRankGap: Record<'same' | 'gap1to3' | 'gap4plus' | 'unknown', { units: number; accuracy: number | null }>;
}

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export function predictUnits(test: readonly ScoredUnit[], scores: Map<string, number | null>, testPairs: readonly PairMatchEvidence[], trainPairs: readonly PairMatchEvidence[]): UnitPrediction[] {
  const roleSame = new Map(testPairs.map((pair) => [`${pair.a.memberId}|${pair.b.memberId}|${pair.matchRef}`, pair.a.role !== null && pair.a.role === pair.b.role]));
  const trainCount = new Map<string, Set<string>>();
  for (const pair of trainPairs) {
    const key = `${pair.a.memberId}|${pair.b.memberId}`;
    trainCount.set(key, (trainCount.get(key) ?? new Set()).add(pair.matchRef));
  }
  return test.map((unit) => {
    const a = scores.get(unit.a) ?? null; const b = scores.get(unit.b) ?? null;
    const predicted = a === null || b === null || a === b ? null : a > b ? 'A' as const : 'B' as const;
    return { unit, predicted, sameRole: roleSame.get(`${unit.a}|${unit.b}|${unit.matchRef}`) ?? false, trainSharedForPair: trainCount.get(`${unit.a}|${unit.b}`)?.size ?? 0 };
  });
}

export function evaluatePredictions(candidate: CandidateId, predictions: readonly UnitPrediction[]): CandidateEvaluation {
  const decisive = predictions.filter((item) => item.unit.outcome !== 'NEUTRAL');
  const made = decisive.filter((item) => item.predicted !== null);
  const hit = (item: UnitPrediction) => (item.predicted === 'A') === (item.unit.outcome === 'A_OUTPERFORMED_B');
  const acc = (items: readonly UnitPrediction[]) => {
    const scored = items.filter((item) => item.unit.outcome !== 'NEUTRAL' && item.predicted !== null);
    return { units: scored.length, accuracy: ratio(scored.filter(hit).length, scored.length) };
  };
  const byPair = new Map<string, UnitPrediction[]>();
  for (const item of made) byPair.set(`${item.unit.a}|${item.unit.b}`, [...(byPair.get(`${item.unit.a}|${item.unit.b}`) ?? []), item]);
  const pairAccuracies = [...byPair.values()].map((items) => items.filter(hit).length / items.length);
  const gap = (item: UnitPrediction) => {
    const d = item.unit.rankTierDifference;
    return d === null ? 'unknown' : d === 0 ? 'same' : Math.abs(d) <= 3 ? 'gap1to3' : 'gap4plus';
  };
  return {
    candidate, testUnits: predictions.length, decisiveUnits: decisive.length, neutralUnits: predictions.length - decisive.length,
    predicted: made.length, correct: made.filter(hit).length, accuracy: ratio(made.filter(hit).length, made.length),
    pairWeightedAccuracy: pairAccuracies.length ? pairAccuracies.reduce((s, v) => s + v, 0) / pairAccuracies.length : null,
    coverage: decisive.length ? made.length / decisive.length : 0,
    sameRoleAccuracy: acc(predictions.filter((item) => item.sameRole)).accuracy,
    crossRoleAccuracy: acc(predictions.filter((item) => !item.sameRole)).accuracy,
    byTrainEvidence: {
      lt10: acc(predictions.filter((item) => item.trainSharedForPair < 10)),
      '10to25': acc(predictions.filter((item) => item.trainSharedForPair >= 10 && item.trainSharedForPair <= 25)),
      gt25: acc(predictions.filter((item) => item.trainSharedForPair > 25)),
    },
    byRankGap: {
      same: acc(predictions.filter((item) => gap(item) === 'same')), gap1to3: acc(predictions.filter((item) => gap(item) === 'gap1to3')),
      gap4plus: acc(predictions.filter((item) => gap(item) === 'gap4plus')), unknown: acc(predictions.filter((item) => gap(item) === 'unknown')),
    },
  };
}

export interface HoldoutResult {
  fold: Fold;
  trainMatches: number;
  testMatches: number;
  evidence: MemberEvidence[];
  scores: Map<CandidateId, Map<string, number | null>>;
  evaluations: CandidateEvaluation[];
  predictions: Map<CandidateId, UnitPrediction[]>;
}

/** One fold: evidence strictly before `train`, test units in [testFrom, testTo). */
export function runFold(input: EvidenceInput, fold: Fold, candidates: readonly CandidateId[] = CANDIDATE_IDS): HoldoutResult {
  const train = Date.parse(fold.train); const from = Date.parse(fold.testFrom); const to = fold.testTo ? Date.parse(fold.testTo) : Number.POSITIVE_INFINITY;
  const canonical = [...input.pairs].sort((x, y) => Date.parse(x.playedAt) - Date.parse(y.playedAt) || (x.matchRef < y.matchRef ? -1 : x.matchRef > y.matchRef ? 1 : 0)
    || (x.a.memberId < y.a.memberId ? -1 : x.a.memberId > y.a.memberId ? 1 : 0) || (x.b.memberId < y.b.memberId ? -1 : x.b.memberId > y.b.memberId ? 1 : 0));
  const trainPairs = canonical.filter((pair) => Date.parse(pair.playedAt) < train);
  const testPairs = canonical.filter((pair) => { const t = Date.parse(pair.playedAt); return t >= from && t < to; });
  const calibration = calibrate(trainPairs);
  if (!calibration) throw new Error('no train calibration');
  const test = scoreUnits(testPairs, calibration);
  const evidence = buildEvidenceTable(input, fold.train);
  const scores = new Map(candidates.map((id) => [id, candidateScores(evidence, id)]));
  const predictions = new Map(candidates.map((id) => [id, predictUnits(test, scores.get(id)!, testPairs, trainPairs)]));
  return {
    fold, trainMatches: new Set(trainPairs.map((pair) => pair.matchRef)).size, testMatches: new Set(testPairs.map((pair) => pair.matchRef)).size,
    evidence, scores, predictions, evaluations: candidates.map((id) => evaluatePredictions(id, predictions.get(id)!)),
  };
}

/** Spearman rank correlation over members present in both maps (null if < 3). */
export function spearman(x: Map<string, number | null>, y: Map<string, number | null>): number | null {
  const ids = [...x.keys()].filter((id) => typeof x.get(id) === 'number' && typeof y.get(id) === 'number').sort();
  if (ids.length < 3) return null;
  const ranks = (values: number[]) => {
    const order = values.map((value, index) => ({ value, index })).sort((p, q) => p.value - q.value);
    const out = new Array<number>(values.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j += 1;
      for (let k = i; k <= j; k += 1) out[order[k]!.index] = (i + j) / 2;
      i = j + 1;
    }
    return out;
  };
  const rx = ranks(ids.map((id) => x.get(id) as number)); const ry = ranks(ids.map((id) => y.get(id) as number));
  const mx = rx.reduce((s, v) => s + v, 0) / rx.length; const my = ry.reduce((s, v) => s + v, 0) / ry.length;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < rx.length; i += 1) { num += (rx[i]! - mx) * (ry[i]! - my); dx += (rx[i]! - mx) ** 2; dy += (ry[i]! - my) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}
