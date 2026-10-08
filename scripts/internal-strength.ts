import { envValue, openStagingDatabase } from '../server/rebuildStaging/localConfig.js';
import { RebuildStagingStore } from '../server/rebuildStaging/stagingStore.js';
import { RankStagingStore } from '../server/rankEvidence/rankStagingStore.js';
import { buildStagedPairs } from '../server/sharedMatch/buildPairs.js';
import { EventMetricEngine } from '../server/metrics/eventMetricEngine.js';
import { calibrate, scoreUnits } from '../src/analytics/sharedMatch/rating.js';
import { CANDIDATE_IDS, type CandidateId } from '../src/analytics/internalStrength/candidates.js';
import { buildEvidenceTable, type GroupMember, type MemberEvidence } from '../src/analytics/internalStrength/evidence.js';
import { runFold, spearman, splitTime, type HoldoutResult } from '../src/analytics/internalStrength/holdout.js';

/**
 * `npm run internal-strength -- audit` — TASK-SCORING-INTERNAL-STRENGTH-01 Phase A (local maintainer tool).
 * Reads only the private staging store with the CANONICAL event-metrics-v1 engine; 0 provider requests.
 * Output: community names and aggregates only (no ids, no match references).
 */
const round = (value: number | null | undefined, digits = 3) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
const database = openStagingDatabase({ applicationName: 'vsa-internal-strength' });
try {
  const key = envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY');
  await new RebuildStagingStore(database, key).initialize(); // refuses application databases
  // --research-event-metrics-v2: PRIVATE research arm only (event-metrics-v2 stays opt-in; never the canonical result).
  const research = process.argv.includes('--research-event-metrics-v2');
  // Default = the engine of the ACCEPTED Phase A evidence (event-metrics-v1), pinned so the recorded results stay reproducible.
  const data = await buildStagedPairs(database, key, new EventMetricEngine({ ruleVersion: research ? 'event-metrics-v2' : 'event-metrics-v1' }));
  const rank = await new RankStagingStore(database).evidence();
  const accounts = new Map<string, string[]>();
  for (const member of data.members) accounts.set(member.memberPublicId, [...(accounts.get(member.memberPublicId) ?? []), member.accountPublicId]);
  const members: GroupMember[] = [...accounts.entries()].map(([memberId, accountIds]) => ({ memberId, accountIds }));
  const name = new Map(data.members.map((member) => [member.memberPublicId, member.communityName]));
  const input = { members, matches: data.matches.map((item) => item.match), pairs: data.pairs, rank };

  // Primary: chronological 70 / 30 by MATCH time. Forward chaining: 4 consecutive test blocks.
  const main = runFold(input, { train: splitTime(data.pairs, 0.7), testFrom: splitTime(data.pairs, 0.7), testTo: null });
  const qs = [0.5, 0.625, 0.75, 0.875];
  const folds: HoldoutResult[] = qs.map((q, index) => runFold(input, { train: splitTime(data.pairs, q), testFrom: splitTime(data.pairs, q),
    testTo: index + 1 < qs.length ? splitTime(data.pairs, qs[index + 1]!) : null }));

  const evaluation = (result: HoldoutResult, id: CandidateId) => result.evaluations.find((item) => item.candidate === id)!;
  const candidates = Object.fromEntries(CANDIDATE_IDS.map((id) => {
    const e = evaluation(main, id);
    const pooledCorrect = folds.reduce((s, f) => s + evaluation(f, id).correct, 0); const pooledMade = folds.reduce((s, f) => s + evaluation(f, id).predicted, 0);
    const pooledDecisive = folds.reduce((s, f) => s + evaluation(f, id).decisiveUnits, 0);
    const stability = folds.slice(1).map((f, i) => spearman(folds[i]!.scores.get(id)!, f.scores.get(id)!));
    return [id, {
      main: { accuracy: round(e.accuracy), pairWeighted: round(e.pairWeightedAccuracy), correct: e.correct, predicted: e.predicted, decisive: e.decisiveUnits,
        neutral: e.neutralUnits, coverage: round(e.coverage), sameRole: round(e.sameRoleAccuracy), crossRole: round(e.crossRoleAccuracy),
        byTrainEvidence: Object.fromEntries(Object.entries(e.byTrainEvidence).map(([k, v]) => [k, { units: v.units, accuracy: round(v.accuracy) }])),
        byRankGap: Object.fromEntries(Object.entries(e.byRankGap).map(([k, v]) => [k, { units: v.units, accuracy: round(v.accuracy) }])) },
      folds: folds.map((f) => round(evaluation(f, id).accuracy)),
      pooled: { accuracy: round(pooledMade ? pooledCorrect / pooledMade : null), coverage: round(pooledDecisive ? pooledMade / pooledDecisive : null), correct: pooledCorrect, predicted: pooledMade },
      memberRankStability: stability.map((value) => round(value)),
      rankDependence: round(spearman(main.scores.get(id)!, main.scores.get('RANK')!)),
    }];
  }));

  // Paired comparison on units where two candidates predict differently (pooled over the forward-chaining folds).
  const paired = (x: CandidateId, y: CandidateId) => {
    let xWins = 0; let yWins = 0; let differing = 0;
    for (const fold of folds) {
      const px = fold.predictions.get(x)!; const py = fold.predictions.get(y)!;
      px.forEach((item, index) => {
        const other = py[index]!;
        if (item.unit.outcome === 'NEUTRAL' || item.predicted === other.predicted) return;
        differing += 1;
        const truth = item.unit.outcome === 'A_OUTPERFORMED_B' ? 'A' : 'B';
        if (item.predicted === truth) xWins += 1; if (other.predicted === truth) yWins += 1;
      });
    }
    return { [x]: xWins, [y]: yWins, differingUnits: differing };
  };
  const ablations = {
    rank: [paired('B_SM_PRIOR_FP_RANK', 'A_SM_PRIOR_FP'), paired('SM_PRIOR_RANK', 'SM'), paired('B_NO_SM_FP_RANK', 'FP'), paired('C_CONSENSUS_SM_FP_RANK', 'C_CONSENSUS_SM_FP')],
    sharedMatch: [paired('A_SM_PRIOR_FP', 'FP'), paired('C_CONSENSUS_SM_FP_RANK', 'C_CONSENSUS_FP_RANK'), paired('B_SM_PRIOR_FP_RANK', 'B_NO_SM_FP_RANK'), paired('SM', 'FP'), paired('SM', 'RANK')],
    recency: [paired('FP_PLUS_CURRENT', 'FP'), paired('FP_CURRENT', 'FP'), paired('SM_RECENT', 'SM'), paired('A_SM_PRIOR_FP_CURRENT', 'A_SM_PRIOR_FP')],
    absoluteOnTopOfShared: [paired('A_SM_PRIOR_FP', 'SM'), paired('C_CONSENSUS_SM_FP', 'SM'), paired('SM_COMPETITIVE', 'SM')],
    researchCommunityScore: [paired('A_SM_PRIOR_CS', 'SM'), paired('CS', 'FP'), paired('CS_PLUS_CURRENT', 'CS')],
  };

  // Rank calibration experiment (pooled folds): test units where Shared-Match and absolute Firepower disagree.
  const disagreement = { units: 0, smRight: 0, fpRight: 0, rankPredicted: 0, rankRight: 0, rankSidedWithSm: 0, rankSidedWithFp: 0 };
  for (const fold of folds) fold.predictions.get('SM')!.forEach((item, index) => {
    const other = fold.predictions.get('FP')![index]!; const r = fold.predictions.get('RANK')![index]!;
    if (item.unit.outcome === 'NEUTRAL' || item.predicted === null || other.predicted === null || item.predicted === other.predicted) return;
    const truth = item.unit.outcome === 'A_OUTPERFORMED_B' ? 'A' : 'B';
    disagreement.units += 1; if (item.predicted === truth) disagreement.smRight += 1; if (other.predicted === truth) disagreement.fpRight += 1;
    if (r.predicted !== null) { disagreement.rankPredicted += 1; if (r.predicted === truth) disagreement.rankRight += 1; if (r.predicted === item.predicted) disagreement.rankSidedWithSm += 1; else disagreement.rankSidedWithFp += 1; }
  });

  // Reference (not a member-level model): each PAIR's own earlier direct record predicts its later units.
  let h2hMade = 0; let h2hHit = 0;
  for (const fold of folds) {
    const train = Date.parse(fold.fold.train);
    const trainPairs = data.pairs.filter((pair) => Date.parse(pair.playedAt) < train);
    const record = new Map<string, number>();
    for (const unit of scoreUnits(trainPairs, calibrate(trainPairs)!)) {
      const id = `${unit.a}|${unit.b}`;
      record.set(id, (record.get(id) ?? 0) + (unit.outcome === 'A_OUTPERFORMED_B' ? 1 : unit.outcome === 'B_OUTPERFORMED_A' ? -1 : 0));
    }
    for (const item of fold.predictions.get('SM')!) {
      if (item.unit.outcome === 'NEUTRAL') continue;
      const value = record.get(`${item.unit.a}|${item.unit.b}`) ?? 0;
      if (value === 0) continue;
      h2hMade += 1; if ((value > 0) === (item.unit.outcome === 'A_OUTPERFORMED_B')) h2hHit += 1;
    }
  }

  // Redundancy audit on the full evidence (as of just after the newest stored evidence).
  const newest = [...data.matches.map((item) => item.match.playedAt), ...rank.map((row) => row.effectiveAt)].sort().at(-1)!;
  const asOf = new Date(Date.parse(newest) + 1000).toISOString();
  const full = buildEvidenceTable(input, asOf);
  const peak = new Map(members.map((member) => [member.memberId, rank.filter((row) => member.accountIds.includes(row.accountId) && row.kind === 'peak')
    .reduce<number | null>((max, row) => (typeof row.normalized?.tierOrdinal === 'number' && (max === null || row.normalized.tierOrdinal > max) ? row.normalized.tierOrdinal : max), null)]));
  const signals: Record<string, (row: MemberEvidence) => number | null> = {
    sharedMatch: (r) => r.shared.rating, sharedCompetitive: (r) => r.shared.competitive, sharedRecent30: (r) => r.shared.recent,
    communityScore: (r) => r.absolute.communityScore, currentStrength: (r) => r.absolute.currentStrength, firepower: (r) => r.absolute.firepower, currentFirepower: (r) => r.absolute.currentFirepower,
    acs: (r) => r.absolute.acs, adr: (r) => r.absolute.adr, kd: (r) => r.absolute.kd, kast: (r) => r.absolute.kast,
    recentForm: (r) => r.recent.formDelta, progress: (r) => r.recent.progress, rankLatest: (r) => r.rank.tier, rankPeak: (r) => peak.get(r.memberId) ?? null,
  };
  const asMap = (f: (row: MemberEvidence) => number | null) => new Map(full.map((row) => [row.memberId, f(row)]));
  const memberMatrix = Object.fromEntries(Object.keys(signals).map((x) => [x, Object.fromEntries(Object.keys(signals).map((y) => [y, round(spearman(asMap(signals[x]!), asMap(signals[y]!)), 2)]))]));
  // Match-level Pearson (Competitive member-matches, canonical v1): which raw stats are the same signal.
  const perMatch = new Map<string, Record<string, number | null>>();
  for (const pair of data.pairs) if (pair.mode === 'Competitive' && pair.valid.stats) for (const side of [pair.a, pair.b]) {
    perMatch.set(`${side.memberId}|${pair.matchRef}`, { acs: side.acs, adr: side.adr, kpr: side.kpr, killDiffPerRound: side.killDiffPerRound, apr: side.apr,
      firepower: side.dimensions.firepower ?? null, kast: side.kast });
  }
  const rows = [...perMatch.values()];
  const pearson = (x: string, y: string) => {
    const xs: number[] = []; const ys: number[] = [];
    for (const row of rows) if (typeof row[x] === 'number' && typeof row[y] === 'number') { xs.push(row[x] as number); ys.push(row[y] as number); }
    if (xs.length < 10) return null;
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length; const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let num = 0; let dx = 0; let dy = 0;
    xs.forEach((v, i) => { num += (v - mx) * (ys[i]! - my); dx += (v - mx) ** 2; dy += (ys[i]! - my) ** 2; });
    return dx && dy ? round(num / Math.sqrt(dx * dy), 2) : null;
  };
  const statKeys = ['acs', 'adr', 'kpr', 'killDiffPerRound', 'apr', 'firepower', 'kast'];
  const matchMatrix = Object.fromEntries(statKeys.map((x) => [x, Object.fromEntries(statKeys.map((y) => [y, pearson(x, y)]))]));

  process.stdout.write(`${JSON.stringify({
    engine: research ? 'event-metrics-v2 (PRIVATE RESEARCH ARM)' : 'event-metrics-v1 (accepted Phase A evidence)', sharedModel: 'shared-match-rating-v1',
    split: { mainTrainMatches: main.trainMatches, mainTestMatches: main.testMatches, folds: folds.map((f) => ({ train: f.trainMatches, test: f.testMatches })) },
    candidates, ablations, rankCalibration: disagreement, pairHeadToHeadReference: { predicted: h2hMade, accuracy: round(h2hMade ? h2hHit / h2hMade : null) },
    redundancy: { memberSpearman: memberMatrix, matchPearson: { rows: rows.length, kastRows: rows.filter((row) => typeof row.kast === 'number').length, matrix: matchMatrix } },
    evidenceTable: full.map((row) => ({ name: name.get(row.memberId), shared: { rating: round(row.shared.rating, 1), competitive: round(row.shared.competitive, 1), unrated: round(row.shared.unrated, 1),
      recent: round(row.shared.recent, 1), matches: row.shared.matches, partners: row.shared.partners, evidencedPartners: row.shared.evidencedPartners, confidence: round(row.shared.confidence, 0) },
      absolute: { matches: row.absolute.matches, rounds: row.absolute.rounds, communityScore: round(row.absolute.communityScore, 1), communityConfidence: round(row.absolute.communityConfidence, 2),
        currentStrength: round(row.absolute.currentStrength, 1), currentFirepower: round(row.absolute.currentFirepower, 1), currentConfidence: round(row.absolute.currentConfidence, 2), firepower: round(row.absolute.firepower, 1),
        acs: round(row.absolute.acs, 1), adr: round(row.absolute.adr, 1), kd: round(row.absolute.kd, 2), kast: round(row.absolute.kast, 3) },
      recent: { formDelta: round(row.recent.formDelta, 1), progress: round(row.recent.progress, 1), progressConfidence: round(row.recent.progressConfidence, 2) },
      rank: { latestTier: row.rank.tier, peakTier: peak.get(row.memberId) ?? null, observations: row.rank.observations } })),
  }, null, 2)}\n`);
} finally {
  await database.close();
}
