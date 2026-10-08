import type { MemberMatchSignals, PairMatchEvidence } from './pairEvidence.js';

/**
 * Phase A candidate evaluation (descriptive, no tuning to member order). For each per-match signal:
 *   availability   share of valid pair units where both members have the signal;
 *   withinSd       pooled within-member SD of the signal (match-to-match noise);
 *   roleBias       mean (Duelist − non-Duelist) margin over pairs with exactly one Duelist, in withinSd units
 *                  (≈ 0 means the signal does not structurally favour Duelists);
 *   stability      share of well-evidenced pairs (≥ 8 units) whose mean-margin sign agrees between the
 *                  chronologically first and second halves.
 */
export type CandidateKey = 'engineOverall' | 'matchProfile' | 'roundImpact' | 'firepower' | 'teamplay' | 'entry' | 'roleValue' | 'firepowerRoundImpact' | 'acs' | 'killDiffPerRound' | 'kast';

export function signalValue(signals: MemberMatchSignals, key: CandidateKey): number | null {
  if (key === 'engineOverall') return signals.engineOverall;
  if (key === 'matchProfile') return signals.matchProfile;
  if (key === 'roundImpact' || key === 'firepower' || key === 'teamplay' || key === 'entry' || key === 'roleValue') return signals.dimensions[key] ?? null;
  if (key === 'firepowerRoundImpact') {
    // Equal-weight mean of two existing role-aware dimensions, only when BOTH exist (no new weights, no zero fill).
    const fire = signals.dimensions.firepower; const impact = signals.dimensions.roundImpact;
    return fire !== undefined && impact !== undefined ? (fire + impact) / 2 : null;
  }
  if (key === 'kast') return signals.kast;
  return signals[key];
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function pooledWithinMemberSd(pairs: readonly PairMatchEvidence[], key: CandidateKey): number | null {
  const byMember = new Map<string, Map<string, number>>();
  for (const pair of pairs) for (const side of [pair.a, pair.b]) {
    const value = signalValue(side, key);
    if (value === null || !pair.valid.stats) continue;
    const values = byMember.get(side.memberId) ?? new Map<string, number>();
    values.set(pair.matchRef, value);
    byMember.set(side.memberId, values);
  }
  let squares = 0; let degrees = 0;
  for (const values of byMember.values()) {
    const list = [...values.values()];
    if (list.length < 2) continue;
    const average = mean(list);
    squares += list.reduce((sum, value) => sum + (value - average) ** 2, 0);
    degrees += list.length - 1;
  }
  return degrees > 0 ? Math.sqrt(squares / degrees) : null;
}

export interface CandidateReport { key: CandidateKey; availability: number; withinSd: number | null; roleBias: number | null; stability: number | null; stablePairs: number;
  /** Share of member-match values at a 0–100 scale bound (≤ 0.5 or ≥ 99.5); null for unbounded signals. */
  saturation: number | null }

export function evaluateCandidate(pairs: readonly PairMatchEvidence[], key: CandidateKey): CandidateReport {
  const valid = pairs.filter((pair) => pair.valid.stats);
  const usable = valid.filter((pair) => signalValue(pair.a, key) !== null && signalValue(pair.b, key) !== null);
  const withinSd = pooledWithinMemberSd(pairs, key);
  const duelistMargins = usable.flatMap((pair) => {
    const aD = pair.a.role === 'Duelist'; const bD = pair.b.role === 'Duelist';
    if (aD === bD) return [];
    const margin = signalValue(pair.a, key)! - signalValue(pair.b, key)!;
    return [aD ? margin : -margin];
  });
  const byPair = new Map<string, PairMatchEvidence[]>();
  for (const pair of usable) {
    const id = `${pair.a.memberId}|${pair.b.memberId}`;
    byPair.set(id, [...(byPair.get(id) ?? []), pair]);
  }
  let agree = 0; let considered = 0;
  for (const list of byPair.values()) {
    if (list.length < 8) continue;
    const sorted = [...list].sort((x, y) => Date.parse(x.playedAt) - Date.parse(y.playedAt));
    const half = Math.floor(sorted.length / 2);
    const m = (items: PairMatchEvidence[]) => mean(items.map((pair) => signalValue(pair.a, key)! - signalValue(pair.b, key)!));
    const first = m(sorted.slice(0, half)); const second = m(sorted.slice(half));
    considered += 1;
    if (Math.sign(first) === Math.sign(second)) agree += 1;
  }
  const bounded = !['acs', 'killDiffPerRound', 'kast'].includes(key);
  const values = new Map<string, number>();
  for (const pair of usable) for (const side of [pair.a, pair.b]) values.set(`${side.memberId}|${pair.matchRef}`, signalValue(side, key)!);
  const saturation = bounded && values.size ? [...values.values()].filter((value) => value <= 0.5 || value >= 99.5).length / values.size : null;
  return {
    key, saturation, availability: valid.length ? usable.length / valid.length : 0, withinSd,
    roleBias: duelistMargins.length && withinSd ? mean(duelistMargins) / withinSd : null,
    stability: considered ? agree / considered : null, stablePairs: considered,
  };
}

export const CANDIDATES: readonly CandidateKey[] = ['engineOverall', 'matchProfile', 'firepowerRoundImpact', 'roundImpact', 'teamplay', 'entry', 'roleValue', 'firepower', 'acs', 'killDiffPerRound', 'kast'];
