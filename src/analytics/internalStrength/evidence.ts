import { analyticsFromEntries, calculateRecentForm } from '../analysis.js';
import { isAbsoluteStrengthMode } from '../modeEligibility.js';
import { computeImprovementIndex } from '../progress/improvementIndex.js';
import { resolveProgressWindows } from '../progress/windows.js';
import type { RankEvidence } from '../rank/rankContext.js';
import { resolveAdaptiveWindow } from '../scope/adaptiveWindow.js';
import { policyFor } from '../scope/policies.js';
import { populationFromMatches } from '../scope/resolveScope.js';
import type { PairMatchEvidence } from '../sharedMatch/pairEvidence.js';
import { computeSharedMatchRatings } from '../sharedMatch/rating.js';
import type { PerformanceEntry } from '../types.js';
import type { MatchRecord, Player, PlayerRole } from '../../types/valorant.js';
import { agentRoles } from '../../utils/agentRoles.js';

/**
 * TASK-SCORING-INTERNAL-STRENGTH-01 — Phase A: the member-level EVIDENCE TABLE as of an instant `asOf`.
 *
 * Every family is computed with the existing, unchanged functions and only from evidence strictly before `asOf`
 * (no future rank, no future matches):
 *   shared   shared-match-rating-v1 over pair units of matches before asOf (calibration from those units only);
 *   absolute community-score-v2 Overall over all Competitive matches (全部已追蹤排位), Current Strength (adaptive-window-v1
 *            currentStrength window), Firepower and plain ACS / ADR / K/D / KAST — Competitive only
 *            (mode-eligibility-policy-v1);
 *   recent   recent-form delta (existing ±2 formula) and improvement-index-v1 value (trend context);
 *   rank     latest ranked point-in-time tier strictly before asOf (match snapshot / history / current) — context only.
 * Members are PEOPLE: callers pass MatchRecords whose performances are already member-merged (one row per member per
 * match; same-match collisions withheld by the canonical assembly) and rank evidence for ALL of a member's accounts.
 */
export const INTERNAL_STRENGTH_EVIDENCE_VERSION = 'internal-strength-evidence-v1' as const;

export interface GroupMember { memberId: string; accountIds: readonly string[] }

export interface MemberEvidence {
  memberId: string;
  shared: { rating: number | null; competitive: number | null; unrated: number | null; recent: number | null; outperformShare: number | null;
    matches: number; partners: number; evidencedPartners: number; confidence: number };
  absolute: { matches: number; rounds: number; communityScore: number | null; communityConfidence: number | null; currentStrength: number | null;
    currentConfidence: number | null; firepower: number | null; currentFirepower: number | null; acs: number | null; adr: number | null; kd: number | null; kast: number | null };
  recent: { formDelta: number | null; progress: number | null; progressConfidence: number | null };
  rank: { tier: number | null; observations: number };
}

/** Latest RANKED point-in-time tier strictly before `asOf` across a member's accounts (peak / seasonal never used). */
export function rankTierBefore(evidence: readonly RankEvidence[], accountIds: readonly string[], asOf: string): { tier: number | null; observations: number } {
  const at = Date.parse(asOf);
  const accounts = new Set(accountIds);
  const rows = evidence.filter((row) => accounts.has(row.accountId) && (row.kind === 'match_snapshot' || row.kind === 'history' || row.kind === 'current')
    && Date.parse(row.effectiveAt) < at && typeof row.normalized?.tierOrdinal === 'number');
  rows.sort((x, y) => Date.parse(y.effectiveAt) - Date.parse(x.effectiveAt) || (x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0)
    || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
  return { tier: rows[0]?.normalized?.tierOrdinal ?? null, observations: rows.length };
}

const finiteOrNull = (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function dominantRole(entries: readonly PerformanceEntry[]): PlayerRole {
  const rounds = new Map<PlayerRole, number>();
  for (const entry of entries) {
    const role = agentRoles[entry.performance.agent];
    if (role) rounds.set(role, (rounds.get(role) ?? 0) + entry.rounds);
  }
  const ordered = [...rounds.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  return ordered[0]?.[0] ?? 'Initiator';
}

export interface EvidenceInput {
  members: readonly GroupMember[];
  /** Canonical member-merged projections of ALL tracked matches (any mode); filtering happens here. */
  matches: readonly MatchRecord[];
  pairs: readonly PairMatchEvidence[];
  rank: readonly RankEvidence[];
}

export function buildEvidenceTable(input: EvidenceInput, asOf: string): MemberEvidence[] {
  const at = Date.parse(asOf);
  const before = (playedAt: string) => Date.parse(playedAt) < at;
  const memberIds = [...new Set(input.members.map((member) => member.memberId))].sort();
  const sharedResult = computeSharedMatchRatings(memberIds, input.pairs.filter((pair) => before(pair.playedAt)));
  const competitive = input.matches.filter((match) => isAbsoluteStrengthMode(match.gameMode) && before(match.playedAt))
    .sort((x, y) => x.playedAt.localeCompare(y.playedAt) || x.id.localeCompare(y.id));
  const population = populationFromMatches(competitive, 'unverified');
  return memberIds.map((memberId) => {
    const member = input.members.find((item) => item.memberId === memberId)!;
    const rawEntries = competitive.flatMap((match) => match.performances.filter((p) => p.playerId === memberId)
      .map((performance) => ({ playerId: memberId, match, performance, rounds: match.scoreFor + match.scoreAgainst })));
    const player = { id: memberId, handle: memberId, displayName: memberId, role: dominantRole(rawEntries as PerformanceEntry[]), agents: [], accent: '', tagline: '', playstyle: '', defaultEmoji: 'spark' } as unknown as Player;
    const entries: PerformanceEntry[] = rawEntries.map((entry) => ({ ...entry, player }));
    const lifetime = analyticsFromEntries(player, entries);
    let currentStrength: number | null = null; let currentConfidence: number | null = null; let currentFirepower: number | null = null;
    if (entries.length) {
      const window = resolveAdaptiveWindow(entries, policyFor('currentStrength'), { population });
      if (window.status !== 'unavailable') {
        const current = analyticsFromEntries(player, window.currentEntries)?.scores;
        currentStrength = finiteOrNull(current?.overall.value);
        currentFirepower = finiteOrNull(current?.firepower.value);
        currentConfidence = window.confidence.overall;
      }
    }
    const form = entries.length ? calculateRecentForm(player, entries, population) : null;
    const progress = entries.length ? computeImprovementIndex(player, resolveProgressWindows(entries, population)) : null;
    const kills = entries.reduce((sum, entry) => sum + entry.performance.kills, 0);
    const deaths = entries.reduce((sum, entry) => sum + entry.performance.deaths, 0);
    const shared = sharedResult.members.find((item) => item.memberId === memberId);
    const value = (rating: { status: string; rating?: number } | undefined) => (rating?.status === 'available' ? rating.rating ?? null : null);
    const rank = rankTierBefore(input.rank, member.accountIds, asOf);
    return {
      memberId,
      shared: { rating: value(shared?.combined), competitive: value(shared?.competitive), unrated: value(shared?.unrated), recent: value(shared?.recent),
        outperformShare: shared?.combined.outperformShare ?? null, matches: shared?.combined.sharedMatches ?? 0, partners: shared?.combined.partners ?? 0,
        evidencedPartners: shared?.combined.evidencedPartners ?? 0, confidence: shared?.combined.confidence ?? 0 },
      absolute: {
        matches: entries.length, rounds: entries.reduce((sum, entry) => sum + entry.rounds, 0),
        communityScore: finiteOrNull(lifetime?.scores.overall.value), communityConfidence: finiteOrNull(lifetime?.scores.overall.confidence),
        currentStrength, currentConfidence, firepower: finiteOrNull(lifetime?.scores.firepower.value), currentFirepower,
        acs: finiteOrNull(lifetime?.stats.acs), adr: finiteOrNull(lifetime?.stats.adr), kd: deaths > 0 ? kills / deaths : null,
        kast: finiteOrNull(lifetime?.stats.kast),
      },
      recent: { formDelta: form && form.status !== 'insufficient' ? finiteOrNull(form.delta) : null,
        progress: progress?.status === 'available' || progress?.status === 'partial' ? finiteOrNull(progress.value) : null,
        progressConfidence: progress ? progress.confidence.overall : null },
      rank,
    };
  });
}
