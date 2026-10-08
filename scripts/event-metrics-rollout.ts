import { createHash } from 'node:crypto';
import { envValue, openStagingDatabase } from '../server/rebuildStaging/localConfig.js';
import { RebuildStagingStore } from '../server/rebuildStaging/stagingStore.js';
import { RankStagingStore } from '../server/rankEvidence/rankStagingStore.js';
import { CANONICAL_EVENT_METRIC_RULE_VERSION, EventMetricEngine, type EventMetricRuleVersion } from '../server/metrics/eventMetricEngine.js';
import { analysisFactsEngineKey } from '../server/dataset/analysisFacts.js';
import { projectStagedMatch, type StagingMember } from '../server/sharedMatch/stagingMatches.js';
import { analyticsFromEntries, calculateRecentForm } from '../src/analytics/analysis.js';
import { isAbsoluteStrengthMode } from '../src/analytics/modeEligibility.js';
import { computeImprovementIndex } from '../src/analytics/progress/improvementIndex.js';
import { resolveProgressWindows } from '../src/analytics/progress/windows.js';
import { resolveAdaptiveWindow } from '../src/analytics/scope/adaptiveWindow.js';
import { policyFor } from '../src/analytics/scope/policies.js';
import { populationFromMatches } from '../src/analytics/scope/resolveScope.js';
import { memberMatchSignals, pairMatchesFor, sharedMode, type PairMatchEvidence } from '../src/analytics/sharedMatch/pairEvidence.js';
import { computeSharedMatchRatings } from '../src/analytics/sharedMatch/rating.js';
import { resolveRankContextAt } from '../src/analytics/rank/rankContext.js';
import type { PerformanceEntry } from '../src/analytics/types.js';
import type { MatchPerformance, MatchRecord, Player, PlayerRole } from '../src/types/valorant.js';
import { agentRoles } from '../src/utils/agentRoles.js';

/**
 * `npm run event-metrics:rollout` — TASK-ANALYTICS-EVENT-METRICS-V2-ROLLOUT-01 real-data audit (local maintainer tool).
 * Reads the private staging store ONLY (raw documents are never written), projects every staged match through the
 * canonical per-match pipeline twice per engine (v1, v2), and reports sanitized aggregates: basic-stat invariants,
 * the classified semantic diff, coverage, high-level analytics availability (with gate reasons), shared-match v1
 * reproduction, rank invariance, facts fingerprints / idempotency and runtime. 0 provider requests.
 */
type Engine = EventMetricRuleVersion;
const ENGINES: Engine[] = ['event-metrics-v1', 'event-metrics-v2'];
const sha = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const round = (value: number | null | undefined, digits = 1) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);

/** Raw-document topology classes (from provider kill events; read-only). */
function rawTopology(document: unknown) {
  const doc = document as { players?: { puuid?: string; team_id?: string }[]; kills?: { round?: number; time_in_round_in_ms?: number; killer?: { puuid?: string }; victim?: { puuid?: string } }[] };
  const team = new Map((doc.players ?? []).map((p) => [p.puuid, p.team_id]));
  const byRound = new Map<number, { killer?: string; victim?: string; t: number }[]>();
  for (const kill of doc.kills ?? []) byRound.set(kill.round ?? -1, [...(byRound.get(kill.round ?? -1) ?? []), { killer: kill.killer?.puuid, victim: kill.victim?.puuid, t: kill.time_in_round_in_ms ?? 0 }]);
  let self = 0; let teamKill = 0; let revive = 0; let deadKiller = 0;
  for (const list of byRound.values()) {
    const dead = new Set<string | undefined>();
    for (const kill of [...list].sort((x, y) => x.t - y.t)) {
      if (kill.killer === kill.victim) self += 1;
      else if (team.get(kill.killer) === team.get(kill.victim)) teamKill += 1;
      if (kill.killer !== kill.victim && dead.has(kill.killer)) deadKiller += 1;
      if (dead.has(kill.victim)) revive += 1;
      dead.add(kill.victim);
    }
  }
  return { self, teamKill, revive, deadKiller, complex: self + teamKill + revive + deadKiller > 0 };
}

const BASIC_PERFORMANCE: (keyof MatchPerformance)[] = ['playerId', 'accountId', 'teamGroup', 'teamWon', 'teamRoundsWon', 'teamRoundsLost', 'agent', 'kills', 'deaths', 'assists', 'acs', 'adr', 'headshotPercentage'];
const BASIC_MATCH: (keyof MatchRecord)[] = ['id', 'playedAt', 'map', 'gameMode', 'opponent', 'scoreFor', 'scoreAgainst', 'won', 'durationMinutes', 'seasonKey'];
const EVENT_METRICS = ['kast', 'opening', 'trade', 'clutch', 'impactContext'] as const;
type EventMetric = (typeof EVENT_METRICS)[number];
const statusOf = (p: MatchPerformance, metric: EventMetric) => (metric === 'kast' ? p.eventEvidence?.kast ?? 'unavailable'
  : metric === 'opening' ? p.eventEvidence?.opening ?? 'unavailable' : p.advancedMetrics?.evidence[metric] ?? 'unavailable');
const valueOf = (p: MatchPerformance, metric: EventMetric) => (metric === 'kast' ? [p.kast, p.advancedMetrics?.kast] : metric === 'opening' ? [p.firstKills, p.firstDeaths, p.advancedMetrics?.opening]
  : metric === 'trade' ? p.advancedMetrics?.trade : metric === 'clutch' ? [p.clutchAttempts, p.clutchWins, p.advancedMetrics?.clutch] : p.advancedMetrics?.impactContext);

const database = openStagingDatabase({ applicationName: 'vsa-event-metrics-rollout' });
try {
  const key = envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY');
  await new RebuildStagingStore(database, key).initialize(); // refuses application databases
  const memberRows = (await database.query<{ account_id: string; member_id: string; community_name: string; affinity: string | null; puuid: string | null }>(
    `SELECT account_public_id::text AS account_id, member_public_id::text AS member_id, community_name, affinity, provider_puuid AS puuid FROM rebuild_staging.accounts ORDER BY account_public_id`)).rows;
  const members: StagingMember[] = memberRows.filter((row) => row.affinity && row.puuid).map((row) => ({ accountPublicId: row.account_id, memberPublicId: row.member_id,
    communityName: row.community_name, affinity: row.affinity!, providerPuuid: row.puuid! }));
  const name = new Map(members.map((member) => [member.memberPublicId, member.communityName]));
  const before = { requests: (await database.query<{ n: string }>('SELECT count(*)::text AS n FROM rebuild_staging.provider_requests')).rows[0]!.n,
    payloadHash: (await database.query<{ h: string }>("SELECT md5(string_agg(md5(payload::text), '' ORDER BY provider_match_id)) AS h FROM rebuild_staging.match_payloads")).rows[0]!.h };
  const rankRows = await new RankStagingStore(database).evidence();
  const rankHashBefore = sha([...rankRows].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))));

  // Load raw documents once (read-only), in canonical order.
  const documents: { ref: string; payload: unknown }[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = (await database.query<{ match_ref: string; payload: unknown }>(
      `SELECT m.match_ref, p.payload FROM rebuild_staging.matches m JOIN rebuild_staging.match_payloads p ON p.provider_match_id=m.provider_match_id
       ORDER BY m.started_at, m.match_ref LIMIT 100 OFFSET $1`, [offset])).rows;
    if (!page.length) break;
    documents.push(...page.map((row) => ({ ref: row.match_ref, payload: row.payload })));
  }
  const topology = new Map(documents.map((doc) => [doc.ref, rawTopology(doc.payload)]));

  // Two full projection runs per engine: runtime, fact fingerprint, idempotency.
  const runs: Record<Engine, { ms: number[]; factHash: string[]; facts: number; factBytes: number; matches: Map<string, MatchRecord> }> = {} as never;
  for (const version of ENGINES) {
    runs[version] = { ms: [], factHash: [], facts: 0, factBytes: 0, matches: new Map() };
    for (let run = 0; run < 2; run += 1) {
      const engine = new EventMetricEngine({ ruleVersion: version });
      const hash = createHash('sha256'); let facts = 0; let bytes = 0;
      const started = performance.now();
      for (const doc of documents) {
        const projected = projectStagedMatch(doc.payload, doc.ref, members, key, engine);
        if (!projected || projected.identityConflict) continue;
        if (run === 0) runs[version].matches.set(doc.ref, projected.match);
        for (const [participant, fact] of [...(projected.facts ?? new Map()).entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
          const text = JSON.stringify([doc.ref, participant, analysisFactsEngineKey(version), fact]);
          hash.update(text); facts += 1; bytes += Buffer.byteLength(JSON.stringify(fact));
        }
      }
      runs[version].ms.push(performance.now() - started);
      runs[version].factHash.push(hash.digest('hex'));
      runs[version].facts = facts; runs[version].factBytes = bytes;
    }
  }
  const v1 = runs['event-metrics-v1'].matches; const v2 = runs['event-metrics-v2'].matches;

  // Basic-stat invariants and the classified semantic diff (all projected matches, every mode).
  let basicCompared = 0; const basicViolations: string[] = []; let nonTopologyAdvancedViolations = 0;
  const classes: Record<EventMetric, Record<'UNCHANGED' | 'EXPECTED_CORRECTION' | 'UNEXPECTED_REGRESSION' | 'UNKNOWN', number>> = Object.fromEntries(
    EVENT_METRICS.map((m) => [m, { UNCHANGED: 0, EXPECTED_CORRECTION: 0, UNEXPECTED_REGRESSION: 0, UNKNOWN: 0 }])) as never;
  const correctionKinds: Record<string, number> = {};
  for (const [ref, one] of v1) {
    const two = v2.get(ref);
    if (!two) { basicViolations.push('match missing in v2'); continue; }
    for (const field of BASIC_MATCH) if (JSON.stringify(one[field]) !== JSON.stringify(two[field])) basicViolations.push(`match.${field}`);
    const raw = topology.get(ref)!;
    for (const p1 of one.performances) {
      const p2 = two.performances.find((p) => p.playerId === p1.playerId);
      basicCompared += 1;
      if (!p2) { basicViolations.push('performance missing'); continue; }
      for (const field of BASIC_PERFORMANCE) if (JSON.stringify(p1[field]) !== JSON.stringify(p2[field])) basicViolations.push(`performance.${field}`);
      for (const domain of ['economy', 'objectives', 'abilityCasts', 'roleValueInputs'] as const) {
        if (JSON.stringify(p1.advancedMetrics?.[domain as keyof typeof p1.advancedMetrics]) !== JSON.stringify(p2.advancedMetrics?.[domain as keyof typeof p2.advancedMetrics])) nonTopologyAdvancedViolations += domain === 'roleValueInputs' ? 0 : 1;
      }
      for (const metric of EVENT_METRICS) {
        const [s1, s2] = [statusOf(p1, metric), statusOf(p2, metric)];
        const same = s1 === s2 && JSON.stringify(valueOf(p1, metric)) === JSON.stringify(valueOf(p2, metric));
        let verdict: keyof (typeof classes)[EventMetric];
        if (same) verdict = 'UNCHANGED';
        else if (s1 !== 'reconstructed' && s2 === 'reconstructed') { verdict = raw.complex ? 'EXPECTED_CORRECTION' : 'UNKNOWN'; correctionKinds.coverage_restored = (correctionKinds.coverage_restored ?? 0) + 1; }
        else if (s1 === 'reconstructed' && s2 === 'reconstructed') { verdict = raw.teamKill > 0 ? 'EXPECTED_CORRECTION' : 'UNEXPECTED_REGRESSION'; if (raw.teamKill > 0) correctionKinds.team_kill_semantics = (correctionKinds.team_kill_semantics ?? 0) + 1; }
        else if (s1 === 'reconstructed') verdict = 'UNEXPECTED_REGRESSION';
        else { verdict = raw.complex ? 'EXPECTED_CORRECTION' : 'UNKNOWN'; if (raw.complex) correctionKinds.still_partial_value_changed = (correctionKinds.still_partial_value_changed ?? 0) + 1; }
        classes[metric][verdict] += 1;
      }
    }
  }

  // Coverage (Competitive + Unrated eligible matches; member-matches) and one-match role-aware dimensions.
  const coverage = (matches: Map<string, MatchRecord>) => {
    const eligible = [...matches.values()].filter((match) => sharedMode(match.gameMode) !== null);
    const usable = (p: MatchPerformance, metric: EventMetric) => statusOf(p, metric) === 'reconstructed';
    const out: Record<string, { matches: number; memberMatches: number }> = {};
    for (const metric of EVENT_METRICS) out[metric] = { matches: eligible.filter((m) => m.performances.every((p) => usable(p, metric))).length,
      memberMatches: eligible.reduce((n, m) => n + m.performances.filter((p) => usable(p, metric)).length, 0) };
    for (const dim of ['firepower', 'entry', 'teamplay', 'roundImpact', 'roleValue'] as const) {
      let memberMatches = 0;
      for (const match of eligible) for (const p of match.performances) if (memberMatchSignals(match, p).dimensions[dim] !== undefined) memberMatches += 1;
      out[`dimension.${dim}`] = { matches: -1, memberMatches };
    }
    return { eligibleMatches: eligible.length, memberMatches: eligible.reduce((n, m) => n + m.performances.length, 0), metrics: out };
  };

  // High-level analytics availability per member (Competitive only; unchanged functions; gate reasons).
  const highLevel = (matches: Map<string, MatchRecord>) => {
    const competitive = [...matches.values()].filter((m) => isAbsoluteStrengthMode(m.gameMode)).sort((x, y) => x.playedAt.localeCompare(y.playedAt) || x.id.localeCompare(y.id));
    const population = populationFromMatches(competitive, 'unverified');
    return [...new Set(members.map((m) => m.memberPublicId))].sort().map((memberId) => {
      const raw = competitive.flatMap((match) => match.performances.filter((p) => p.playerId === memberId).map((performance) => ({ playerId: memberId, match, performance, rounds: match.scoreFor + match.scoreAgainst })));
      const roles = new Map<PlayerRole, number>();
      for (const entry of raw) { const role = agentRoles[entry.performance.agent]; if (role) roles.set(role, (roles.get(role) ?? 0) + entry.rounds); }
      const role = [...roles.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] ?? 'Initiator';
      const player = { id: memberId, handle: memberId, displayName: memberId, role, agents: [], accent: '', tagline: '', playstyle: '', defaultEmoji: 'spark' } as unknown as Player;
      const entries: PerformanceEntry[] = raw.map((entry) => ({ ...entry, player }));
      const lifetime = analyticsFromEntries(player, entries)!.scores;
      const dims = lifetime.overall.trace.dimensions ?? [];
      const window = resolveAdaptiveWindow(entries, policyFor('currentStrength'), { population });
      const current = window.status === 'unavailable' ? undefined : analyticsFromEntries(player, window.currentEntries)!.scores.overall;
      const form = calculateRecentForm(player, entries, population);
      const progress = computeImprovementIndex(player, resolveProgressWindows(entries, population));
      return {
        name: name.get(memberId), competitiveMatches: entries.length, rounds: entries.reduce((s, e) => s + e.rounds, 0),
        communityScore: { available: lifetime.overall.status !== 'unavailable', status: lifetime.overall.status, omission: lifetime.overall.trace.omissionReason ?? null,
          missingDimensions: dims.filter((d) => d.status === 'unavailable').map((d) => d.dimension), partialDimensions: dims.filter((d) => d.status === 'partial').map((d) => d.dimension) },
        roleAware: { roleValue: lifetime.roleValue.status, teamplay: lifetime.teamplay.status, entry: lifetime.entry.status, roundImpact: lifetime.roundImpact.status },
        currentStrength: { available: current !== undefined && current.status !== 'unavailable', window: window.status, windowMatches: window.current.matches, windowRounds: window.current.rounds,
          overall: current?.status ?? 'no_window', omission: current?.trace.omissionReason ?? null, reasons: window.reasons },
        recentForm: { available: form.status !== 'insufficient', status: form.status, recentMatches: form.recentMatches, baselineMatches: form.baselineMatches,
          window: form.window.status, recentOverall: form.status === 'insufficient' ? null : round(form.recentOverall), baselineOverall: form.status === 'insufficient' ? null : round(form.baselineOverall),
          reasons: form.window.reasons },
        progress: { available: progress.status !== 'unavailable', status: progress.status, confidence: round(progress.confidence.overall, 2), reasons: progress.reasons,
          currentMatches: progress.activity.currentMatches, baselineMatches: progress.activity.baselineMatches, value: progress.status === 'unavailable' ? null : round(progress.value) },
      };
    });
  };

  // Shared-match v1 (frozen on event-metrics-v1) and a v2-projected control (Firepower is event-independent).
  const pairsOf = (matches: Map<string, MatchRecord>, version: Engine): PairMatchEvidence[] => [...matches.entries()].flatMap(([ref, match]) => pairMatchesFor(ref, match, (memberId, playedAt, matchRef) => {
    const account = members.find((m) => m.memberPublicId === memberId)?.accountPublicId;
    return account ? resolveRankContextAt(rankRows, account, playedAt, matchRef) : null;
  })).map((pair) => ({ ...pair, engine: version }));
  const memberIds = [...new Set(members.map((m) => m.memberPublicId))];
  const rate = (pairs: PairMatchEvidence[]) => Object.fromEntries(computeSharedMatchRatings(memberIds, pairs).members.map((m) => [name.get(m.memberId), round(m.combined.rating)]));
  const pairsV1 = pairsOf(v1, 'event-metrics-v1'); const pairsV2 = pairsOf(v2, 'event-metrics-v2');
  const rankContextSame = pairsV1.length === pairsV2.length && pairsV1.every((pair, i) => JSON.stringify([pair.rankA, pair.rankB, pair.rankTierDifference]) === JSON.stringify([pairsV2[i]!.rankA, pairsV2[i]!.rankB, pairsV2[i]!.rankTierDifference]));
  // No future leakage: every resolved context is an exact in-match snapshot or STRICTLY prior evidence.
  let futureLeaks = 0;
  for (const pair of pairsV1) for (const side of [pair.a, pair.b]) {
    const account = members.find((m) => m.memberPublicId === side.memberId)!.accountPublicId;
    const context = resolveRankContextAt(rankRows, account, pair.playedAt, pair.matchRef);
    if (context.evidence && context.status !== 'exact_match' && Date.parse(context.evidence.effectiveAt) >= Date.parse(pair.playedAt)) futureLeaks += 1;
  }

  const after = { requests: (await database.query<{ n: string }>('SELECT count(*)::text AS n FROM rebuild_staging.provider_requests')).rows[0]!.n,
    payloadHash: (await database.query<{ h: string }>("SELECT md5(string_agg(md5(payload::text), '' ORDER BY provider_match_id)) AS h FROM rebuild_staging.match_payloads")).rows[0]!.h };
  const rankHashAfter = sha([...(await new RankStagingStore(database).evidence())].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))));

  process.stdout.write(`${JSON.stringify({
    canonicalEngineInCode: CANONICAL_EVENT_METRIC_RULE_VERSION,
    staging: { documents: documents.length, projected: { v1: v1.size, v2: v2.size }, providerRequestsBefore: before.requests, providerRequestsAfter: after.requests,
      rawPayloadsUnchanged: before.payloadHash === after.payloadHash, rankEvidenceRows: rankRows.length, rankEvidenceUnchanged: rankHashBefore === rankHashAfter },
    rawTopologyMatches: { complex: [...topology.values()].filter((t) => t.complex).length, teamKill: [...topology.values()].filter((t) => t.teamKill > 0).length },
    basicStats: { memberMatchesCompared: basicCompared, violations: basicViolations.length, violationFields: [...new Set(basicViolations)], nonTopologyAdvancedViolations },
    semanticDiff: { byMetric: classes, correctionKinds },
    coverage: { v1: coverage(v1), v2: coverage(v2) },
    highLevel: { v1: highLevel(v1), v2: highLevel(v2) },
    sharedMatchV1: { frozenEngine: 'event-metrics-v1', ratings: rate(pairsV1), v2ProjectedControl: rate(pairsV2) },
    rank: { rankContextIdenticalAcrossEngines: rankContextSame, pairUnits: pairsV1.length, futureLeaks },
    facts: Object.fromEntries(ENGINES.map((version) => [version, { engineKey: analysisFactsEngineKey(version), facts: runs[version].facts, bytes: runs[version].factBytes,
      fingerprint: runs[version].factHash[0], secondRunFingerprint: runs[version].factHash[1], idempotent: runs[version].factHash[0] === runs[version].factHash[1],
      projectionMs: runs[version].ms.map((ms) => Math.round(ms)) }])),
  }, null, 2)}\n`);
} finally {
  await database.close();
}
