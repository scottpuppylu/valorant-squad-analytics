import type { Dimension } from '../../scoring/versions.js';
import { defaultProfile } from '../../scoring/profiles.js';
import type { PlayerRole } from '../../types/valorant.js';
import { signalValue, type CandidateKey } from './candidates.js';
import { SINGLE_MATCH_DIMENSIONS, type MemberMatchSignals, type PairMatchEvidence } from './pairEvidence.js';
import { CLIP_SIGMA, MIN_MATCHES, NEUTRAL_SIGMA, memberRating, type ScoredUnit, type UnitOutcome } from './rating.js';

/**
 * TASK-SCORING-SHARED-MATCH-02 — Phase A: ONE evaluation framework applied identically to every candidate signal.
 * Descriptive only: no fitting, no member names, no rank. Every statistic is computed from the candidate's own usable
 * pair-match units (or from an explicitly passed common subset), in units of σ = the pooled within-member SD of the
 * candidate's per-side values (the same calibration rule as shared-match-rating-v1).
 */
export type AuditCandidateKey = CandidateKey | 'pairProfile';

/** Side values for one unit, or null when the candidate is not usable for that unit. */
export type SideValues = { a: number; b: number; components?: Partial<Record<Dimension, number>> } | null;

/**
 * Candidate H — pair-consistent single-match profile: the overall-profile-v1 weights (no new weights) over the
 * single-match dimensions that BOTH members have in that unit. Requires the four dimensions that event-metrics-v2
 * makes broadly available (Firepower, Entry, Teamplay, Role Value); Round Impact joins only when both sides have it.
 * Both sides are therefore always averaged over the SAME components, so the margin is a like-for-like comparison.
 */
export const PAIR_PROFILE_REQUIRED = ['firepower', 'entry', 'teamplay', 'roleValue'] as const satisfies readonly Dimension[];

export function pairProfileSides(a: MemberMatchSignals, b: MemberMatchSignals): SideValues {
  if (PAIR_PROFILE_REQUIRED.some((dimension) => a.dimensions[dimension] === undefined || b.dimensions[dimension] === undefined)) return null;
  const common = SINGLE_MATCH_DIMENSIONS.filter((dimension) => a.dimensions[dimension] !== undefined && b.dimensions[dimension] !== undefined);
  const weight = common.reduce((sum, dimension) => sum + defaultProfile.weights[dimension], 0);
  const side = (signals: MemberMatchSignals) => common.reduce((sum, dimension) => sum + defaultProfile.weights[dimension] * signals.dimensions[dimension]!, 0) / weight;
  const components = Object.fromEntries(common.map((dimension) => [dimension, a.dimensions[dimension]! - b.dimensions[dimension]!])) as Partial<Record<Dimension, number>>;
  return { a: side(a), b: side(b), components };
}

export function sideValues(pair: PairMatchEvidence, key: AuditCandidateKey): SideValues {
  if (!pair.valid.stats) return null;
  if (key === 'pairProfile') return pairProfileSides(pair.a, pair.b);
  const a = signalValue(pair.a, key); const b = signalValue(pair.b, key);
  return a === null || b === null ? null : { a, b };
}

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sd = (values: readonly number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
};
const round = (value: number | null, digits = 3) => (value === null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);

interface Unit { pair: PairMatchEvidence; a: number; b: number; margin: number }

/** Canonical order + one unit per (pair, match): the audit never depends on input order or duplicates. */
export function usableUnits(pairs: readonly PairMatchEvidence[], key: AuditCandidateKey): Unit[] {
  const sorted = [...pairs].sort((x, y) => Date.parse(x.playedAt) - Date.parse(y.playedAt) || (x.matchRef < y.matchRef ? -1 : x.matchRef > y.matchRef ? 1 : 0)
    || (x.a.memberId < y.a.memberId ? -1 : x.a.memberId > y.a.memberId ? 1 : 0) || (x.b.memberId < y.b.memberId ? -1 : x.b.memberId > y.b.memberId ? 1 : 0));
  const seen = new Set<string>();
  const out: Unit[] = [];
  for (const pair of sorted) {
    const id = `${pair.a.memberId}|${pair.b.memberId}|${pair.matchRef}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const values = sideValues(pair, key);
    if (values) out.push({ pair, a: values.a, b: values.b, margin: values.a - values.b });
  }
  return out;
}

function withinMemberSd(units: readonly Unit[]): number | null {
  const byMember = new Map<string, Map<string, number>>();
  for (const unit of units) for (const [side, value] of [[unit.pair.a, unit.a], [unit.pair.b, unit.b]] as const) {
    const values = byMember.get(side.memberId) ?? new Map<string, number>();
    values.set(unit.pair.matchRef, value);
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

const ROLES: readonly PlayerRole[] = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

/** Pair-level (≥ 8 units) direction agreement between two disjoint halves chosen by `split`. */
function splitAgreement(byPair: Map<string, Unit[]>, split: (index: number, length: number) => boolean) {
  let agree = 0; let considered = 0;
  for (const list of byPair.values()) {
    if (list.length < 8) continue;
    const first = list.filter((_, index) => split(index, list.length)).map((unit) => unit.margin);
    const second = list.filter((_, index) => !split(index, list.length)).map((unit) => unit.margin);
    considered += 1;
    if (Math.sign(mean(first)) === Math.sign(mean(second))) agree += 1;
  }
  return considered ? agree / considered : null;
}

export interface CandidateAudit {
  key: AuditCandidateKey;
  units: number;
  /** Share of valid (≥ 10-round) units where both members have the signal. */
  availability: number;
  /** Share of per-side values at a 0–100 bound (≤ 0.5 or ≥ 99.5); null for unbounded signals. */
  saturation: number | null;
  /** Pooled within-member SD (native units) — the σ every other statistic is expressed in. */
  sigma: number | null;
  /** Within-member variance / total variance of per-side values (scale-free match-to-match noise share). */
  noiseShare: number | null;
  /** Mean (Duelist − non-Duelist) margin over units with exactly one Duelist, in σ (between-member; confounded by who plays Duelist). */
  duelistBias: number | null;
  /** The same member's signed margin when on a Duelist minus when not, pooled over members with ≥ 5 units each, in σ (controls for the member). */
  duelistWithinMember: number | null;
  /** Per role R: mean (R − other) margin over units where exactly one side is R, in σ. */
  roleBias: Partial<Record<PlayerRole, number | null>>;
  /** Mean |pair mean margin| in σ (how clearly pairs separate). */
  pairSeparation: number | null;
  /** First-half vs second-half (chronological) sign agreement over pairs with ≥ 8 units. */
  temporalStability: number | null;
  /** Odd vs even (interleaved) sign agreement over pairs with ≥ 8 units (stability without temporal drift). */
  pairwiseDirectionStability: number | null;
  stablePairs: number;
  /** Share of pairs (≥ 8 units) whose mean-margin sign flips when their single most extreme unit is removed. */
  outlierFlipShare: number | null;
  /** Mean |Δ pair mean margin| from removing that unit, in σ. */
  outlierInfluence: number | null;
}

export function auditCandidate(pairs: readonly PairMatchEvidence[], key: AuditCandidateKey): CandidateAudit {
  const valid = new Set(pairs.filter((pair) => pair.valid.stats).map((pair) => `${pair.a.memberId}|${pair.b.memberId}|${pair.matchRef}`));
  const units = usableUnits(pairs, key);
  const sigma = withinMemberSd(units);
  const bounded = !['acs', 'killDiffPerRound', 'kast'].includes(key);
  const sides = new Map<string, number>();
  for (const unit of units) { sides.set(`${unit.pair.a.memberId}|${unit.pair.matchRef}`, unit.a); sides.set(`${unit.pair.b.memberId}|${unit.pair.matchRef}`, unit.b); }
  const sideList = [...sides.values()];
  const totalSd = sd(sideList);
  const inSigma = (value: number | null) => (value === null || !sigma ? null : value / sigma);
  const roleBias: Partial<Record<PlayerRole, number | null>> = {};
  for (const role of ROLES) {
    const margins = units.flatMap((unit) => {
      const aR = unit.pair.a.role === role; const bR = unit.pair.b.role === role;
      return aR === bR ? [] : [aR ? unit.margin : -unit.margin];
    });
    roleBias[role] = margins.length >= 10 ? inSigma(mean(margins)) : null;
  }
  // Within-member Duelist effect: signed margins of the member, split by the member's own role in that match.
  const signed = new Map<string, { duelist: number[]; other: number[] }>();
  for (const unit of units) for (const [self, margin] of [[unit.pair.a, unit.margin], [unit.pair.b, -unit.margin]] as const) {
    const entry = signed.get(self.memberId) ?? { duelist: [], other: [] };
    (self.role === 'Duelist' ? entry.duelist : entry.other).push(margin);
    signed.set(self.memberId, entry);
  }
  let effect = 0; let effectWeight = 0;
  for (const entry of signed.values()) {
    if (entry.duelist.length < 5 || entry.other.length < 5) continue;
    const weight = 2 / (1 / entry.duelist.length + 1 / entry.other.length);
    effect += weight * (mean(entry.duelist) - mean(entry.other)); effectWeight += weight;
  }
  const byPair = new Map<string, Unit[]>();
  for (const unit of units) {
    const id = `${unit.pair.a.memberId}|${unit.pair.b.memberId}`;
    byPair.set(id, [...(byPair.get(id) ?? []), unit]);
  }
  const pairMeans = [...byPair.values()].map((list) => Math.abs(mean(list.map((unit) => unit.margin))));
  let flips = 0; let influence = 0; let considered = 0;
  for (const list of byPair.values()) {
    if (list.length < 8) continue;
    const margins = list.map((unit) => unit.margin);
    const extreme = margins.reduce((best, value, index) => (Math.abs(value) > Math.abs(margins[best]!) ? index : best), 0);
    const without = margins.filter((_, index) => index !== extreme);
    considered += 1;
    if (Math.sign(mean(margins)) !== Math.sign(mean(without))) flips += 1;
    influence += Math.abs(mean(margins) - mean(without));
  }
  return {
    key, units: units.length, availability: valid.size ? units.length / valid.size : 0,
    saturation: bounded && sideList.length ? sideList.filter((value) => value <= 0.5 || value >= 99.5).length / sideList.length : null,
    sigma, noiseShare: sigma && totalSd ? (sigma / totalSd) ** 2 : null,
    duelistBias: (() => {
      const margins = units.flatMap((unit) => {
        const aD = unit.pair.a.role === 'Duelist'; const bD = unit.pair.b.role === 'Duelist';
        return aD === bD ? [] : [aD ? unit.margin : -unit.margin];
      });
      return margins.length ? inSigma(mean(margins)) : null;
    })(),
    duelistWithinMember: effectWeight ? inSigma(effect / effectWeight) : null,
    roleBias, pairSeparation: pairMeans.length ? inSigma(mean(pairMeans)) : null,
    temporalStability: splitAgreement(byPair, (index, length) => index < Math.floor(length / 2)),
    pairwiseDirectionStability: splitAgreement(byPair, (index) => index % 2 === 0),
    stablePairs: [...byPair.values()].filter((list) => list.length >= 8).length,
    outlierFlipShare: considered ? flips / considered : null, outlierInfluence: considered ? inSigma(influence / considered) : null,
  };
}

/** Rounded copy for reports (calculation precision is never reduced). */
export function roundedAudit(audit: CandidateAudit) {
  return {
    ...audit, availability: round(audit.availability), saturation: round(audit.saturation), sigma: round(audit.sigma, 2), noiseShare: round(audit.noiseShare),
    duelistBias: round(audit.duelistBias), duelistWithinMember: round(audit.duelistWithinMember),
    roleBias: Object.fromEntries(Object.entries(audit.roleBias).map(([role, value]) => [role, round(value ?? null)])),
    pairSeparation: round(audit.pairSeparation), temporalStability: round(audit.temporalStability), pairwiseDirectionStability: round(audit.pairwiseDirectionStability),
    outlierFlipShare: round(audit.outlierFlipShare), outlierInfluence: round(audit.outlierInfluence),
  };
}

/**
 * Member ratings for ANY candidate under the unchanged shared-match-rating-v1 aggregation rules (neutral 0.2σ, ±2σ
 * winsorization, one match once per member, n/(n+8) shrinkage, ≥ 5 matches). Used only to compare candidates and to
 * run the same-role sensitivity test identically for each. Rank is never read.
 */
export function candidateMemberRatings(memberIds: readonly string[], pairs: readonly PairMatchEvidence[], key: AuditCandidateKey, filter: (pair: PairMatchEvidence) => boolean = () => true) {
  const all = usableUnits(pairs, key);
  const sigma = withinMemberSd(all);
  if (!sigma) return new Map<string, number | null>();
  const units: ScoredUnit[] = all.filter((unit) => filter(unit.pair)).map((unit) => {
    const outcome: UnitOutcome = Math.abs(unit.margin) < NEUTRAL_SIGMA * sigma ? 'NEUTRAL' : unit.margin > 0 ? 'A_OUTPERFORMED_B' : 'B_OUTPERFORMED_A';
    return { matchRef: unit.pair.matchRef, playedAt: unit.pair.playedAt, mode: unit.pair.mode, a: unit.pair.a.memberId, b: unit.pair.b.memberId, margin: unit.margin,
      clippedMargin: Math.max(-CLIP_SIGMA * sigma, Math.min(CLIP_SIGMA * sigma, unit.margin)), outcome, components: {} as ScoredUnit['components'], rankTierDifference: null };
  });
  const universe = new Set(memberIds).size - 1;
  return new Map([...new Set(memberIds)].sort().map((memberId) => {
    const rating = memberRating(memberId, units, units.filter((unit) => unit.a === memberId || unit.b === memberId).length, universe);
    return [memberId, rating.status === 'available' && rating.sharedMatches >= MIN_MATCHES ? rating.rating! : null];
  }));
}

/** Same-role sensitivity: |all-role rating − same-role-only rating| per member (same rules for every candidate). */
export function roleSensitivity(memberIds: readonly string[], pairs: readonly PairMatchEvidence[], key: AuditCandidateKey) {
  const allRole = candidateMemberRatings(memberIds, pairs, key);
  const sameRole = candidateMemberRatings(memberIds, pairs, key, (pair) => pair.a.role !== null && pair.a.role === pair.b.role);
  const deltas = [...allRole.keys()].flatMap((id) => {
    const all = allRole.get(id); const same = sameRole.get(id);
    return all !== null && all !== undefined && same !== null && same !== undefined ? [Math.abs(all - same)] : [];
  });
  return { allRole, sameRole, membersCompared: deltas.length, meanAbsDelta: deltas.length ? mean(deltas) : null, maxAbsDelta: deltas.length ? Math.max(...deltas) : null };
}

/** Deterministic FNV-1a hash in [0, 1) (no randomness source; same input → same subset). */
function unitHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash / 2 ** 32;
}

/**
 * Sampling-noise floor of the same-role test: the mean |all-role − subset| member delta when the subset is a
 * deterministic pseudo-random draw of the SAME share of units as the same-role subset (averaged over `draws`).
 * A same-role delta near this floor is indistinguishable from merely using fewer matches.
 */
export function roleSensitivityNull(memberIds: readonly string[], pairs: readonly PairMatchEvidence[], key: AuditCandidateKey, draws = 40) {
  const units = usableUnits(pairs, key);
  const share = units.length ? units.filter((unit) => unit.pair.a.role !== null && unit.pair.a.role === unit.pair.b.role).length / units.length : 0;
  const allRole = candidateMemberRatings(memberIds, pairs, key);
  const deltas: number[] = [];
  for (let draw = 0; draw < draws; draw += 1) {
    const subset = candidateMemberRatings(memberIds, pairs, key, (pair) => unitHash(`${draw}|${pair.matchRef}|${pair.a.memberId}|${pair.b.memberId}`) < share);
    for (const [id, all] of allRole) {
      const value = subset.get(id);
      if (all !== null && value !== null && value !== undefined) deltas.push(Math.abs(all - value));
    }
  }
  return { sameRoleShare: share, meanAbsDelta: deltas.length ? mean(deltas) : null };
}
