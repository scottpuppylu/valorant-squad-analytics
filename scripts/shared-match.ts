import { envValue, openStagingDatabase } from '../server/rebuildStaging/localConfig.js';
import { RebuildStagingStore } from '../server/rebuildStaging/stagingStore.js';
import { buildStagedPairs } from '../server/sharedMatch/buildPairs.js';
import { CANDIDATES, evaluateCandidate } from '../src/analytics/sharedMatch/candidates.js';
import { auditCandidate, roleSensitivity, roleSensitivityNull, roundedAudit, sideValues, type AuditCandidateKey } from '../src/analytics/sharedMatch/candidateAudit.js';
import { connectedComponents, coverageSummary, pairCoverage } from '../src/analytics/sharedMatch/coverage.js';
import { aggregatePair, computeSharedMatchRatings, type MemberRating } from '../src/analytics/sharedMatch/rating.js';
import { EventMetricEngine } from '../server/metrics/eventMetricEngine.js';
import { sharedMode, type PairMatchEvidence } from '../src/analytics/sharedMatch/pairEvidence.js';
import type { MatchPerformance } from '../src/types/valorant.js';

/**
 * `npm run shared-match -- audit | rate` — TASK-SCORING-SHARED-MATCH-01 (local maintainer tool; reads only the
 * private staging store; 0 provider requests). Output: community names and aggregates only.
 */
const command = process.argv[2];
const database = openStagingDatabase({ applicationName: 'vsa-shared-match' });
try {
  const rebuild = new RebuildStagingStore(database, envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY'));
  await rebuild.initialize(); // refuses application databases
  const data = await buildStagedPairs(database, envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY'));
  const memberIds = [...new Set(data.members.map((member) => member.memberPublicId))];
  const name = new Map(data.members.map((member) => [member.memberPublicId, member.communityName]));
  const cells = pairCoverage(memberIds, data.pairs);
  if (command === 'audit') {
    const modes: Record<string, number> = {};
    for (const { match } of data.matches) modes[match.gameMode] = (modes[match.gameMode] ?? 0) + 1;
    process.stdout.write(`${JSON.stringify({
      projectedMatches: data.matches.length, skipped: data.skipped, identityConflicts: data.identityConflicts, modes,
      pairUnits: data.pairs.length,
      pairUnitsByMode: { Competitive: data.pairs.filter((p) => p.mode === 'Competitive').length, Unrated: data.pairs.filter((p) => p.mode === 'Unrated').length },
      invalidShort: data.pairs.filter((p) => p.valid.remakeOrShort).length,
      missingRank: data.pairs.filter((p) => p.rankA.tierOrdinal === null || p.rankB.tierOrdinal === null).length,
      rankStatus: data.pairs.reduce<Record<string, number>>((acc, p) => { for (const s of [p.rankA.status, p.rankB.status]) acc[s] = (acc[s] ?? 0) + 1; return acc; }, {}),
      coverage: coverageSummary(cells),
      components: connectedComponents(memberIds, cells).map((group) => group.map((id) => name.get(id))),
      matrix: cells.map((cell) => ({ a: name.get(cell.a), b: name.get(cell.b), shared: cell.shared, competitive: cell.competitive, unrated: cell.unrated, sameTeam: cell.sameTeam, opposing: cell.opposingTeam })),
      candidates: CANDIDATES.map((key) => evaluateCandidate(data.pairs, key)),
    }, null, 2)}\n`);
  } else if (command === 'rate') {
    const result = computeSharedMatchRatings(memberIds, data.pairs);
    const sameRole = computeSharedMatchRatings(memberIds, data.pairs.filter((pair) => pair.a.role !== null && pair.a.role === pair.b.role));
    const view = (rating: MemberRating) => ({ status: rating.status, rating: rating.rating === undefined ? null : Math.round(rating.rating * 10) / 10,
      share: rating.outperformShare === undefined ? null : Math.round(rating.outperformShare * 1000) / 1000, matches: rating.sharedMatches,
      margin: rating.averageRelativeMargin === null ? null : Math.round(rating.averageRelativeMargin * 10) / 10, partners: rating.partners,
      evidencedPartners: rating.evidencedPartners, validShare: Math.round(rating.validShare * 1000) / 1000, confidence: Math.round(rating.confidence) });
    const pairKey = (unit: { a: string; b: string }) => `${unit.a}|${unit.b}`;
    const grouped = new Map<string, typeof result.units>();
    for (const unit of result.units) grouped.set(pairKey(unit), [...(grouped.get(pairKey(unit)) ?? []), unit]);
    const pairs = [...grouped.values()].map((units) => aggregatePair(units)).map((agg) => ({ ...agg, a: name.get(agg.a), b: name.get(agg.b) }))
      .sort((x, y) => Math.abs(y.aOutperformed - y.bOutperformed) / y.sharedMatches - Math.abs(x.aOutperformed - x.bOutperformed) / x.sharedMatches);
    // Rank context, descriptive only: does the higher pre-match tier member come out ahead more often?
    const strata: Record<string, { units: number; higherTierAhead: number; lowerTierAhead: number; neutral: number }> = {};
    for (const unit of result.units) {
      const d = unit.rankTierDifference;
      const bucket = d === null ? 'unknown' : d === 0 ? 'same_tier' : Math.abs(d) <= 3 ? 'gap_1_3' : 'gap_4_plus';
      const s = strata[bucket] ??= { units: 0, higherTierAhead: 0, lowerTierAhead: 0, neutral: 0 };
      s.units += 1;
      if (unit.outcome === 'NEUTRAL' || d === null || d === 0) { if (unit.outcome === 'NEUTRAL') s.neutral += 1; continue; }
      const higherIsA = d > 0;
      if ((unit.outcome === 'A_OUTPERFORMED_B') === higherIsA) s.higherTierAhead += 1; else s.lowerTierAhead += 1;
    }
    process.stdout.write(`${JSON.stringify({
      version: result.version, calibration: result.calibration, scoredUnits: result.units.length,
      outcomes: result.units.reduce<Record<string, number>>((acc, unit) => { acc[unit.outcome] = (acc[unit.outcome] ?? 0) + 1; return acc; }, {}),
      members: result.members.map((member) => ({ name: name.get(member.memberId), combined: view(member.combined), competitive: view(member.competitive),
        unrated: view(member.unrated), recent: view(member.recent),
        sameRoleSensitivity: view(sameRole.members.find((other) => other.memberId === member.memberId)!.combined) })),
      strongestPairs: pairs.slice(0, 6), weakestEvidencePairs: [...pairs].sort((x, y) => x.sharedMatches - y.sharedMatches).slice(0, 4),
      rankStrata: strata,
    }, null, 2)}\n`);
  } else if (command === 'robustness') {
    // TASK-ANALYTICS-EVENT-RECONSTRUCTION-ROBUSTNESS-01: event-metrics-v1 vs v2 over the same staged matches (read-only).
    const key = envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY');
    const v2 = await buildStagedPairs(database, key, new EventMetricEngine({ ruleVersion: 'event-metrics-v2' }));
    const metrics = ['kast', 'opening', 'trade', 'clutch', 'impactContext'] as const;
    const usable = (p: MatchPerformance, metric: (typeof metrics)[number]) => metric === 'kast' ? p.eventEvidence?.kast === 'reconstructed'
      : metric === 'opening' ? p.eventEvidence?.opening === 'reconstructed' : p.advancedMetrics?.evidence[metric] === 'reconstructed';
    const coverage = (set: typeof data) => {
      const eligible = set.matches.filter(({ match }) => sharedMode(match.gameMode) !== null);
      const perMetric = Object.fromEntries(metrics.map((metric) => [metric, {
        memberMatches: eligible.reduce((n, { match }) => n + match.performances.filter((p) => usable(p, metric)).length, 0),
        matches: eligible.filter(({ match }) => match.performances.every((p) => usable(p, metric))).length,
      }]));
      const full = eligible.filter(({ match }) => match.performances.every((p) => metrics.every((metric) => usable(p, metric)))).length;
      const units = set.pairs.length;
      const both = (pick: (s: PairMatchEvidence['a']) => unknown) => set.pairs.filter((p) => pick(p.a) != null && pick(p.b) != null).length;
      return { eligibleMatches: eligible.length, memberMatches: eligible.reduce((n, { match }) => n + match.performances.length, 0), perMetric,
        fullMetricMatches: full, partialMatches: eligible.length - full,
        pairUnits: units, pairUnitAvailability: { firepower: both((s) => s.dimensions.firepower), kast: both((s) => s.kast),
          roundImpact: both((s) => s.dimensions.roundImpact), teamplay: both((s) => s.dimensions.teamplay), entry: both((s) => s.dimensions.entry),
          roleValue: both((s) => s.dimensions.roleValue), matchProfile: both((s) => s.matchProfile), engineOverall: both((s) => s.engineOverall) } };
    };
    // Real-data non-regression: where v1 fully reconstructed a member-match, v2 must agree (except documented team-kill semantics).
    const v1ByKey = new Map(data.matches.flatMap(({ matchRef, match }) => match.performances.map((p) => [`${matchRef}|${p.playerId}`, p] as const)));
    let compared = 0; let identical = 0; const differingFields: Record<string, number> = {};
    for (const { matchRef, match } of v2.matches) for (const p2 of match.performances) {
      const p1 = v1ByKey.get(`${matchRef}|${p2.playerId}`);
      if (!p1 || !metrics.every((metric) => usable(p1, metric))) continue;
      compared += 1;
      const strip = (p: MatchPerformance) => JSON.stringify({ ...p, advancedMetrics: p.advancedMetrics ? { ...p.advancedMetrics, ruleVersion: '' } : undefined });
      if (strip(p1) === strip(p2)) identical += 1;
      else for (const field of ['kast', 'firstKills', 'firstDeaths', 'advancedMetrics'] as const) if (JSON.stringify(p1[field]) !== JSON.stringify(p2[field])) differingFields[field] = (differingFields[field] ?? 0) + 1;
    }
    process.stdout.write(`${JSON.stringify({ before: coverage(data), after: coverage(v2),
      nonRegression: { v1FullyReconstructedMemberMatches: compared, identicalInV2: identical, differingFields },
      candidatesBefore: CANDIDATES.map((candidate) => evaluateCandidate(data.pairs, candidate)),
      candidatesAfter: CANDIDATES.map((candidate) => evaluateCandidate(v2.pairs, candidate)) }, null, 2)}\n`);
  } else if (command === 'candidates-v2') {
    // TASK-SCORING-SHARED-MATCH-02 Phase A: one framework, every candidate, v2 evidence (private/offline only).
    const v2 = await buildStagedPairs(database, envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY'), new EventMetricEngine({ ruleVersion: 'event-metrics-v2' }));
    const keys: AuditCandidateKey[] = ['firepower', 'engineOverall', 'matchProfile', 'pairProfile', 'kast', 'entry', 'teamplay', 'roundImpact', 'roleValue', 'firepowerRoundImpact', 'acs', 'killDiffPerRound'];
    const view = (pairs: typeof v2.pairs) => keys.map((key) => roundedAudit(auditCandidate(pairs, key)));
    // Common subset: units where the richer candidate is usable, so Firepower is compared on identical evidence.
    const common = v2.pairs.filter((pair) => sideValues(pair, 'pairProfile') !== null);
    const sensitivity = Object.fromEntries(keys.map((key) => {
      const result = roleSensitivity(memberIds, v2.pairs, key);
      const floor = roleSensitivityNull(memberIds, v2.pairs, key);
      const commonResult = roleSensitivity(memberIds, common, key);
      return [key, { membersCompared: result.membersCompared, meanAbsDelta: result.meanAbsDelta === null ? null : Math.round(result.meanAbsDelta * 10) / 10,
        samplingFloor: floor.meanAbsDelta === null ? null : Math.round(floor.meanAbsDelta * 10) / 10, sameRoleShare: Math.round(floor.sameRoleShare * 1000) / 1000,
        commonSubsetMeanAbsDelta: commonResult.meanAbsDelta === null ? null : Math.round(commonResult.meanAbsDelta * 10) / 10,
        maxAbsDelta: result.maxAbsDelta === null ? null : Math.round(result.maxAbsDelta * 10) / 10 }];
    }));
    process.stdout.write(`${JSON.stringify({
      engine: 'event-metrics-v2', pairUnits: v2.pairs.length,
      all: view(v2.pairs), competitive: view(v2.pairs.filter((pair) => pair.mode === 'Competitive')), unrated: view(v2.pairs.filter((pair) => pair.mode === 'Unrated')),
      commonSubset: { units: common.length, audits: (['firepower', 'pairProfile', 'matchProfile', 'kast', 'entry', 'teamplay', 'roleValue'] as const).map((key) => roundedAudit(auditCandidate(common, key))) },
      roleSensitivity: sensitivity,
    }, null, 2)}
`);
  } else {
    throw new Error('usage: shared-match -- audit | rate | robustness | candidates-v2');
  }
} finally {
  await database.close();
}
