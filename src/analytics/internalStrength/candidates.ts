import { SHRINK_K } from '../sharedMatch/rating.js';
import type { MemberEvidence } from './evidence.js';

/**
 * TASK-SCORING-INTERNAL-STRENGTH-01 — Phase A candidate structures. Every candidate maps the evidence table to one
 * group-relative score per member (higher = stronger; null = no estimate). No coefficient is fitted to members:
 *   - families are placed on a common scale by WITHIN-GROUP standardization (z = (x − group mean) / group SD), which
 *     works for any group size ≥ 2 and never hard-codes a group;
 *   - the only blending weight is the existing shared-match shrinkage n/(n+SHRINK_K): shared-match evidence dominates
 *     in proportion to how much of it a member has, and the absolute family acts as the PRIOR (empirical-Bayes form);
 *   - rank enters only as a prior or a consensus vote, never as a multiplier of performance.
 * Canonical absolute family = the existing role-aware community-score-v2 FIREPOWER dimension (lifetime Competitive, and
 * over the Current Strength window): Overall / Current Strength / Recent Form / Progress need event dimensions that
 * event-metrics-v1 leaves unavailable for real members. CS / CURRENT remain for the private research arm.
 */
type BaseId = 'SM' | 'SM_COMPETITIVE' | 'SM_RECENT' | 'FP' | 'FP_CURRENT' | 'CS' | 'CURRENT' | 'RANK' | 'ACS' | 'KD';
export type CandidateId = BaseId
  | 'A_SM_PRIOR_FP' | 'A_SM_PRIOR_FP_CURRENT' | 'A_SM_PRIOR_CS' | 'SM_PRIOR_RANK' | 'B_SM_PRIOR_FP_RANK' | 'B_NO_SM_FP_RANK'
  | 'C_CONSENSUS_SM_FP_RANK' | 'C_CONSENSUS_SM_FP' | 'C_CONSENSUS_FP_RANK' | 'FP_PLUS_CURRENT' | 'CS_PLUS_CURRENT';

type Picker = (row: MemberEvidence) => number | null;
const pick: Record<BaseId, Picker> = {
  SM: (row) => row.shared.rating,
  SM_COMPETITIVE: (row) => row.shared.competitive,
  SM_RECENT: (row) => row.shared.recent,
  FP: (row) => row.absolute.firepower,
  FP_CURRENT: (row) => row.absolute.currentFirepower,
  CS: (row) => row.absolute.communityScore,
  CURRENT: (row) => row.absolute.currentStrength,
  RANK: (row) => row.rank.tier,
  ACS: (row) => row.absolute.acs,
  KD: (row) => row.absolute.kd,
};

/** Within-group z-scores over members that have the value (needs ≥ 2 distinct values; otherwise all 0). */
export function zScores(rows: readonly MemberEvidence[], picker: Picker): Map<string, number | null> {
  const values = rows.flatMap((row) => { const value = picker(row); return value === null ? [] : [value]; });
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const sd = values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : 0;
  return new Map(rows.map((row) => {
    const value = picker(row);
    return [row.memberId, value === null ? null : sd > 0 ? (value - mean) / sd : 0];
  }));
}

/** Within-group percentile rank in [0, 1] (ties share the mean position). */
export function percentiles(rows: readonly MemberEvidence[], picker: Picker): Map<string, number | null> {
  const values = rows.flatMap((row) => { const value = picker(row); return value === null ? [] : [value]; }).sort((x, y) => x - y);
  return new Map(rows.map((row) => {
    const value = picker(row);
    if (value === null) return [row.memberId, null];
    if (values.length < 2) return [row.memberId, 0.5];
    const below = values.filter((other) => other < value).length; const equal = values.filter((other) => other === value).length;
    return [row.memberId, (below + (equal - 1) / 2) / (values.length - 1)];
  }));
}

const meanOf = (values: (number | null | undefined)[]) => {
  const present = values.filter((value): value is number => typeof value === 'number');
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
};

/**
 * Empirical-Bayes blend on the SHARED-MATCH share scale: score = w·p + (1 − w)·prior, w = n/(n+SHRINK_K).
 * p = the member's unshrunk shared outperform share; prior = group mean(p) + group SD(p)·z(prior family).
 * With no shared evidence, the prior alone decides (a new member is placed by absolute evidence, at low confidence).
 */
function sharedWithPrior(rows: readonly MemberEvidence[], priorZ: Map<string, number | null>): Map<string, number | null> {
  const shares = rows.flatMap((row) => (row.shared.outperformShare === null ? [] : [row.shared.outperformShare]));
  const mean = shares.length ? shares.reduce((sum, value) => sum + value, 0) / shares.length : 0.5;
  const sd = shares.length > 1 ? Math.sqrt(shares.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (shares.length - 1)) : 0;
  return new Map(rows.map((row) => {
    const z = priorZ.get(row.memberId) ?? null;
    const prior = z === null ? null : mean + sd * z;
    const p = row.shared.outperformShare;
    if (p === null || row.shared.rating === null) return [row.memberId, prior];
    if (prior === null) return [row.memberId, 0.5 + (p - 0.5) * (row.shared.matches / (row.shared.matches + SHRINK_K))];
    const w = row.shared.matches / (row.shared.matches + SHRINK_K);
    return [row.memberId, w * p + (1 - w) * prior];
  }));
}

export function candidateScores(input: readonly MemberEvidence[], id: CandidateId): Map<string, number | null> {
  // Canonical member order: floating-point sums and the returned map never depend on input order.
  const rows = [...input].sort((x, y) => (x.memberId < y.memberId ? -1 : x.memberId > y.memberId ? 1 : 0));
  if (id in pick) return new Map(rows.map((row) => [row.memberId, pick[id as keyof typeof pick](row)]));
  const z = (key: keyof typeof pick) => zScores(rows, pick[key]);
  const pct = (key: keyof typeof pick) => percentiles(rows, pick[key]);
  const combine = (maps: Map<string, number | null>[]) => new Map(rows.map((row) => [row.memberId, meanOf(maps.map((map) => map.get(row.memberId)))]));
  switch (id) {
    case 'A_SM_PRIOR_FP': return sharedWithPrior(rows, z('FP'));
    case 'A_SM_PRIOR_FP_CURRENT': return sharedWithPrior(rows, combine([z('FP'), z('FP_CURRENT')]));
    case 'A_SM_PRIOR_CS': return sharedWithPrior(rows, z('CS'));
    case 'SM_PRIOR_RANK': return sharedWithPrior(rows, z('RANK'));
    case 'B_SM_PRIOR_FP_RANK': return sharedWithPrior(rows, combine([z('FP'), z('RANK')]));
    case 'B_NO_SM_FP_RANK': return combine([z('FP'), z('RANK')]);
    case 'C_CONSENSUS_SM_FP_RANK': return combine([pct('SM'), pct('FP'), pct('RANK')]);
    case 'C_CONSENSUS_SM_FP': return combine([pct('SM'), pct('FP')]);
    case 'C_CONSENSUS_FP_RANK': return combine([pct('FP'), pct('RANK')]);
    case 'FP_PLUS_CURRENT': return combine([z('FP'), z('FP_CURRENT')]);
    case 'CS_PLUS_CURRENT': return combine([z('CS'), z('CURRENT')]);
    default: throw new Error(`unknown candidate ${id}`);
  }
}

export const CANDIDATE_IDS: readonly CandidateId[] = ['SM', 'SM_COMPETITIVE', 'SM_RECENT', 'FP', 'FP_CURRENT', 'CS', 'CURRENT', 'RANK', 'ACS', 'KD',
  'A_SM_PRIOR_FP', 'A_SM_PRIOR_FP_CURRENT', 'A_SM_PRIOR_CS', 'SM_PRIOR_RANK', 'B_SM_PRIOR_FP_RANK', 'B_NO_SM_FP_RANK',
  'C_CONSENSUS_SM_FP_RANK', 'C_CONSENSUS_SM_FP', 'C_CONSENSUS_FP_RANK', 'FP_PLUS_CURRENT', 'CS_PLUS_CURRENT'];
