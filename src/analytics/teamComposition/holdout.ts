import { FitModel, type FitChannel } from './fit.js';
import type { MemberObservation } from './observations.js';

/**
 * TASK-ANALYTICS-TEAM-COMPOSITION-01 — chronological MATCH-level holdout. A match is train iff it started strictly
 * before the split time, so every observation of one match (all its members) is on one side. Evidence models are built
 * from train observations only.
 */
export function splitTime(observations: readonly MemberObservation[], q: number): string {
  const times = [...new Set(observations.map((o) => `${o.playedAt}|${o.matchId}`))].sort();
  const index = Math.min(times.length - 1, Math.max(1, Math.floor(times.length * q)));
  return times[index]!.split('|')[0]!;
}
export const partition = (observations: readonly MemberObservation[], split: string) => ({
  train: observations.filter((o) => o.playedAt < split), test: observations.filter((o) => o.playedAt >= split),
});

const mean = (values: readonly number[]) => values.reduce((s, v) => s + v, 0) / values.length;
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  if (x.length < 3) return null;
  const mx = mean(x); const my = mean(y);
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < x.length; i += 1) { num += (x[i]! - mx) * (y[i]! - my); dx += (x[i]! - mx) ** 2; dy += (y[i]! - my) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}
const ranks = (values: readonly number[]) => {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i; while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j += 1;
    for (let k = i; k <= j; k += 1) out[order[k]!.index] = (i + j) / 2;
    i = j + 1;
  }
  return out;
};
export const spearman = (x: readonly number[], y: readonly number[]) => pearson(ranks(x), ranks(y));
/** Area under the ROC curve of score vs a binary outcome (ties count ½); null without both classes. */
export function auc(scores: readonly number[], outcomes: readonly boolean[]): number | null {
  const pos = scores.filter((_, i) => outcomes[i]); const neg = scores.filter((_, i) => !outcomes[i]);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export type IndividualModel = 'member_only' | 'agent_no_map' | 'map_no_agent' | 'hierarchy';
export interface IndividualEvaluation {
  channel: FitChannel; model: IndividualModel; units: number;
  /** corr(prediction − member baseline, actual − member baseline): agent / map signal BEYOND the member's own level. */
  incrementalCorrelation: number | null;
  /** Spearman of prediction vs actual (includes between-member level). */
  spearman: number | null;
  mae: number | null;
  /** win channel only: AUC of the prediction for the actual result. */
  auc: number | null;
}

/** Predictions for each IndividualModel from one train FitModel (deterministic). */
export function individualPrediction(model: FitModel, o: MemberObservation, channel: FitChannel, which: IndividualModel): number | null {
  const fit = model.fit(o.memberId, o.agent, o.map, channel);
  if (fit.value === null || !fit.components) return null;
  const c = fit.components;
  if (which === 'member_only') return c.member;
  if (which === 'agent_no_map') return c.member + c.roleFit + c.agentFit;
  if (which === 'map_no_agent') return c.member + c.mapFit;
  return fit.value;
}

export function evaluateIndividual(train: readonly MemberObservation[], test: readonly MemberObservation[], options: { mapK?: number | null } = {}): IndividualEvaluation[] {
  const model = new FitModel(train, options);
  const out: IndividualEvaluation[] = [];
  for (const channel of ['performance', 'win'] as const) {
    for (const which of ['member_only', 'agent_no_map', 'map_no_agent', 'hierarchy'] as const) {
      const preds: number[] = []; const actual: number[] = []; const base: number[] = []; const wins: boolean[] = [];
      for (const o of test) {
        const value = channel === 'performance' ? o.performance : o.won === null ? null : o.won ? 1 : 0;
        const pred = individualPrediction(model, o, channel, which);
        if (value === null || pred === null) continue;
        preds.push(pred); actual.push(value); base.push(model.memberBaseline(o.memberId, channel)); wins.push(value === 1);
      }
      out.push({ channel, model: which, units: preds.length,
        incrementalCorrelation: which === 'member_only' ? null : pearson(preds.map((p, i) => p - base[i]!), actual.map((a, i) => a - base[i]!)),
        spearman: spearman(preds, actual), mae: preds.length ? mean(preds.map((p, i) => Math.abs(p - actual[i]!))) : null,
        auc: channel === 'win' ? auc(preds, wins) : null });
    }
  }
  return out;
}

/** One historical team unit: the tracked members of one Competitive match (same team), with their actual agents. */
export interface TeamUnit { matchId: string; map: string; members: MemberObservation[]; won: boolean | null; roundDiff: number | null; meanPerformance: number | null }

export function teamUnits(observations: readonly MemberObservation[], minimumMembers = 2): TeamUnit[] {
  const byMatch = new Map<string, MemberObservation[]>();
  for (const o of observations) byMatch.set(o.matchId, [...(byMatch.get(o.matchId) ?? []), o]);
  return [...byMatch.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).flatMap(([matchId, members]) => {
    if (members.length < minimumMembers) return [];
    const won = members[0]!.won; const roundDiff = members[0]!.roundDiff;
    if (members.some((m) => m.won !== won)) return []; // contradictory same-team outcome: unusable
    const perf = members.flatMap((m) => (m.performance === null ? [] : [m.performance]));
    return [{ matchId, map: members[0]!.map, members, won, roundDiff, meanPerformance: perf.length ? mean(perf) : null }];
  });
}

export interface PairSynergySource {
  /** duo-synergy-v1 index for the pair over TRAIN Competitive matches (null when unavailable), and its shared sample. */
  global(a: string, b: string): { value: number | null; matches: number };
  /** Map-scoped duo-synergy-v1 index (null when unavailable). */
  onMap(a: string, b: string, map: string): { value: number | null; matches: number };
}

/** Map-scoped pair synergy shrunk toward global: (n_map·s_map + K·s_global) / (n_map + K); falls back to global. */
export function shrunkMapSynergy(source: PairSynergySource, a: string, b: string, map: string, k = 8): number | null {
  const global = source.global(a, b); const local = source.onMap(a, b, map);
  if (global.value === null) return local.value;
  if (local.value === null) return global.value;
  return (local.matches * local.value + k * global.value) / (local.matches + k);
}
