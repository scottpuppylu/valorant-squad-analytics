import { envValue, openStagingDatabase } from '../server/rebuildStaging/localConfig.js';
import { RebuildStagingStore } from '../server/rebuildStaging/stagingStore.js';
import { EventMetricEngine } from '../server/metrics/eventMetricEngine.js';
import { buildStagedPairs } from '../server/sharedMatch/buildPairs.js';
import { projectStagedMatch, type StagingMember } from '../server/sharedMatch/stagingMatches.js';
import { FitModel } from '../src/analytics/teamComposition/fit.js';
import { auc, evaluateIndividual, partition, shrunkMapSynergy, spearman, splitTime, teamUnits, type PairSynergySource, type TeamUnit } from '../src/analytics/teamComposition/holdout.js';
import { buildObservations, type MemberObservation } from '../src/analytics/teamComposition/observations.js';
import { computeSharedMatchRatings } from '../src/analytics/sharedMatch/rating.js';
import { calculatePlayerScores } from '../src/scoring/calculateScores.js';
import { defaultProfile } from '../src/scoring/profiles.js';
import { buildSynergy, canonicalPair, defaultSynergyFilters } from '../src/synergy/analytics.js';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types.js';
import type { MatchRecord, Player } from '../src/types/valorant.js';
import { AGENT_ROLES_CATALOG_V0, agentRoles } from '../src/utils/agentRoles.js';

/**
 * `npm run team-composition -- evaluate | demo` — TASK-ANALYTICS-TEAM-COMPOSITION-01 (local maintainer tool; reads the
 * private staging store read-only; canonical event-metrics-v2 + agent-catalog-v1; 0 provider requests).
 * Output: community names, map / agent names and aggregates only.
 */
const command = process.argv[2] ?? 'evaluate';
const r3 = (value: number | null | undefined, digits = 3) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
const mean = (values: readonly number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);
const database = openStagingDatabase({ applicationName: 'vsa-team-composition' });
try {
  const key = envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY');
  await new RebuildStagingStore(database, key).initialize(); // refuses application databases
  const memberRows = (await database.query<{ account_id: string; member_id: string; community_name: string; affinity: string | null; puuid: string | null }>(
    `SELECT account_public_id::text AS account_id, member_public_id::text AS member_id, community_name, affinity, provider_puuid AS puuid FROM rebuild_staging.accounts ORDER BY account_public_id`)).rows;
  const members: StagingMember[] = memberRows.filter((row) => row.affinity && row.puuid).map((row) => ({ accountPublicId: row.account_id, memberPublicId: row.member_id,
    communityName: row.community_name, affinity: row.affinity!, providerPuuid: row.puuid! }));
  const name = new Map(members.map((m) => [m.memberPublicId, m.communityName]));
  const memberIds = [...new Set(members.map((m) => m.memberPublicId))].sort();
  const engine = new EventMetricEngine(); // canonical (event-metrics-v2)
  const matches: MatchRecord[] = [];
  const teamAgents = new Map<string, string[]>(); // match → the tracked team's five agents (raw provider names; read-only)
  const documents: { matchId: string; payload: unknown }[] = []; // raw documents kept in memory for `v2` (read-only)
  for (let offset = 0; ; offset += 100) {
    const page = (await database.query<{ match_ref: string; payload: { players?: { puuid?: string; team_id?: string; agent?: { name?: string } }[] } }>(
      `SELECT m.match_ref, p.payload FROM rebuild_staging.matches m JOIN rebuild_staging.match_payloads p ON p.provider_match_id=m.provider_match_id
       ORDER BY m.started_at, m.match_ref LIMIT 100 OFFSET $1`, [offset])).rows;
    if (!page.length) break;
    for (const row of page) {
      const projected = projectStagedMatch(row.payload, row.match_ref, members, key, engine);
      if (!projected || projected.identityConflict) continue;
      matches.push(projected.match);
      documents.push({ matchId: projected.match.id, payload: row.payload });
      const players = row.payload.players ?? [];
      const trackedTeams = new Set(players.filter((p) => members.some((m) => m.providerPuuid === p.puuid)).map((p) => p.team_id));
      if (trackedTeams.size === 1) teamAgents.set(projected.match.id, players.filter((p) => p.team_id === [...trackedTeams][0]).map((p) => p.agent?.name ?? 'Unknown').sort());
    }
  }
  const observations = buildObservations(matches);
  const players = memberIds.map((id) => ({ id, handle: id, displayName: id, agents: [], accent: '', tagline: '', playstyle: '', defaultEmoji: 'spark' }) as unknown as Player);
  const datasetOf = (subset: MatchRecord[]) => ({ players, matches: subset }) as unknown as NormalizedAnalyticsDataset;
  const synergySource = (subset: MatchRecord[], maps: readonly string[]): PairSynergySource => {
    const index = (results: ReturnType<typeof buildSynergy>) => new Map(results.map((r) => [r.pair.key, { value: r.status === 'unavailable' || typeof r.value !== 'number' ? null : r.value, matches: r.sharedSample.matches }]));
    const global = index(buildSynergy(datasetOf(subset), { ...defaultSynergyFilters, gameMode: 'Competitive' }));
    const byMap = new Map(maps.map((map) => [map, index(buildSynergy(datasetOf(subset), { ...defaultSynergyFilters, gameMode: 'Competitive', map }))]));
    const lookup = (table: Map<string, { value: number | null; matches: number }> | undefined, a: string, b: string) =>
      table?.get(canonicalPair(a, b).key) ?? { value: null, matches: 0 };
    return { global: (a, b) => lookup(global, a, b), onMap: (a, b, map) => lookup(byMap.get(map), a, b) };
  };

  if (command === 'evaluate') {
    // ---- Shared-Match catalog sensitivity (frozen v1 vs corrected-catalog CONTROL; same formula / engine / thresholds).
    const staged = await buildStagedPairs(database, key);
    const byRef = new Map(staged.matches.map((x) => [x.matchRef, x.match]));
    let correctedSides = 0;
    const correctedPairs = staged.pairs.map((pair) => {
      const fix = (side: typeof pair.a) => {
        const match = byRef.get(pair.matchRef)!; const p = match.performances.find((x) => x.playerId === side.memberId)!;
        if (AGENT_ROLES_CATALOG_V0[p.agent] === agentRoles[p.agent]) return side;
        correctedSides += 1;
        const s = calculatePlayerScores({ id: p.playerId, role: agentRoles[p.agent] } as never, {} as never, [{ ...match, performances: [p] }], defaultProfile, { roles: agentRoles });
        const firepower = s.firepower.status !== 'unavailable' && typeof s.firepower.value === 'number' ? s.firepower.value : undefined;
        return { ...side, role: agentRoles[p.agent] ?? null, dimensions: { ...side.dimensions, ...(firepower !== undefined ? { firepower } : {}) } };
      };
      return { ...pair, a: fix(pair.a), b: fix(pair.b) };
    });
    const ratings = (pairs: typeof staged.pairs) => new Map(computeSharedMatchRatings(memberIds, pairs).members.map((m) => [m.memberId, m.combined.rating ?? null]));
    const frozen = ratings(staged.pairs); const corrected = ratings(correctedPairs);
    const ids = memberIds.filter((id) => frozen.get(id) !== null && corrected.get(id) !== null);
    const sensitivity = { correctedPairSides: correctedSides,
      rankCorrelation: r3(spearman(ids.map((id) => frozen.get(id)!), ids.map((id) => corrected.get(id)!))),
      maxMemberRatingDelta: r3(Math.max(...ids.map((id) => Math.abs(frozen.get(id)! - corrected.get(id)!))), 1),
      frozen: Object.fromEntries(ids.map((id) => [name.get(id), r3(frozen.get(id), 1)])), corrected: Object.fromEntries(ids.map((id) => [name.get(id), r3(corrected.get(id), 1)])),
      frozenOrder: [...ids].sort((a, b) => frozen.get(b)! - frozen.get(a)!).map((id) => name.get(id)), correctedOrder: [...ids].sort((a, b) => corrected.get(b)! - corrected.get(a)!).map((id) => name.get(id)) };

    // ---- Input readiness (full data).
    const cells = (keyOf: (o: MemberObservation) => string | null) => {
      const counts = new Map<string, number>();
      for (const o of observations) { const k = keyOf(o); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
      const v = [...counts.values()]; return { cells: v.length, ge5: v.filter((x) => x >= 5).length, ge10: v.filter((x) => x >= 10).length };
    };
    const readiness = {
      observations: observations.length, withPerformance: observations.filter((o) => o.performance !== null).length, unknownAgentObservations: observations.filter((o) => !o.agentKnown).length,
      memberMap: cells((o) => `${o.memberId}|${o.map}`), memberAgent: cells((o) => `${o.memberId}|${o.agent}`), memberRole: cells((o) => (o.role ? `${o.memberId}|${o.role}` : null)),
      memberAgentMap: cells((o) => `${o.memberId}|${o.agent}|${o.map}`), memberRoleMap: cells((o) => (o.role ? `${o.memberId}|${o.role}|${o.map}` : null)),
      behaviour: { opening: observations.filter((o) => o.behaviour.firstKills !== null).length, trade: observations.filter((o) => o.behaviour.tradeKills !== null).length,
        kast: observations.filter((o) => o.behaviour.kastRate !== null).length, clutch: observations.filter((o) => o.behaviour.clutchAttempts !== null).length },
      teamUnits: { ge2: teamUnits(observations, 2).length, ge3: teamUnits(observations, 3).length, ge4: teamUnits(observations, 4).length, five: teamUnits(observations, 5).length },
      teamAgentsKnown: teamAgents.size,
    };
    const allSynergy = synergySource(matches.filter((m) => m.gameMode === 'Competitive'), [...new Set(observations.map((o) => o.map))]);
    let pairsAvailable = 0; let mapPairsAvailable = 0; let mapPairCells = 0;
    for (let i = 0; i < memberIds.length; i += 1) for (let j = i + 1; j < memberIds.length; j += 1) {
      if (allSynergy.global(memberIds[i]!, memberIds[j]!).value !== null) pairsAvailable += 1;
      for (const map of new Set(observations.map((o) => o.map))) { const s = allSynergy.onMap(memberIds[i]!, memberIds[j]!, map); if (s.matches > 0) { mapPairCells += 1; if (s.value !== null) mapPairsAvailable += 1; } }
    }

    // ---- Holdout: main 70/30 + forward chaining (4 blocks).
    const folds = [{ q: 0.7, to: null as number | null }, ...[0.5, 0.625, 0.75, 0.875].map((q, i, all) => ({ q, to: all[i + 1] ?? null }))];
    const roleKey = (agents: string[]) => {
      const counts = { Duelist: 0, Initiator: 0, Controller: 0, Sentinel: 0, Unknown: 0 } as Record<string, number>;
      for (const agent of agents) counts[agentRoles[agent] ?? 'Unknown'] = (counts[agentRoles[agent] ?? 'Unknown'] ?? 0) + 1;
      return `D${counts.Duelist}I${counts.Initiator}C${counts.Controller}S${counts.Sentinel}U${counts.Unknown}`;
    };
    const foldResults = folds.map(({ q, to }) => {
      const split = splitTime(observations, q); const end = to === null ? null : splitTime(observations, to);
      const { train } = partition(observations, split);
      const test = observations.filter((o) => o.playedAt >= split && (end === null || o.playedAt < end));
      const individual = evaluateIndividual(train, test);
      // Map-shrinkage sensitivity (model selection, every value reported): hierarchy incremental r for K_map.
      const mapShrinkSensitivity = Object.fromEntries([8, 16, 32, 64].map((mapK) => {
        const e = evaluateIndividual(train, test, { mapK }).find((x) => x.channel === 'performance' && x.model === 'hierarchy')!;
        return [`K${mapK}`, r3(e.incrementalCorrelation)];
      }));
      const model = new FitModel(train);
      const trainMatches = matches.filter((m) => m.gameMode === 'Competitive' && m.playedAt < split);
      const synergy = synergySource(trainMatches, [...new Set(test.map((o) => o.map))]);
      // Role-distribution evidence: train win rate per full-team role-count pattern, shrunk (K = 8) to the train win rate.
      const trainUnits = teamUnits(train, 1);
      const overallWin = mean(trainUnits.flatMap((u) => (u.won === null ? [] : [u.won ? 1 : 0]))) ?? 0.5;
      const pattern = new Map<string, { n: number; w: number }>();
      for (const u of trainUnits) { const agents = teamAgents.get(u.matchId); if (!agents || u.won === null) continue; const k = roleKey(agents); const c = pattern.get(k) ?? { n: 0, w: 0 }; c.n += 1; c.w += u.won ? 1 : 0; pattern.set(k, c); }
      const units = teamUnits(test, 2);
      const rows = units.map((u: TeamUnit) => {
        const perf = u.members.flatMap((m) => { const f = model.fit(m.memberId, m.agent, m.map, 'performance'); return f.value === null ? [] : [f.value]; });
        const win = u.members.flatMap((m) => { const f = model.fit(m.memberId, m.agent, m.map, 'win'); return f.value === null ? [] : [f.value]; });
        const base = u.members.map((m) => model.memberBaseline(m.memberId, 'performance'));
        const pairs: [string, string][] = [];
        for (let i = 0; i < u.members.length; i += 1) for (let j = i + 1; j < u.members.length; j += 1) pairs.push([u.members[i]!.memberId, u.members[j]!.memberId]);
        const synG = pairs.flatMap(([a, b]) => { const s = synergy.global(a, b).value; return s === null ? [] : [s]; });
        const synM = pairs.flatMap(([a, b]) => { const s = shrunkMapSynergy(synergy, a, b, u.map); return s === null ? [] : [s]; });
        const agents = teamAgents.get(u.matchId);
        const cell = agents ? pattern.get(roleKey(agents)) : undefined;
        const roleDist = agents ? (((cell?.w ?? 0) + 8 * overallWin) / ((cell?.n ?? 0) + 8)) : null;
        return { won: u.won, roundDiff: u.roundDiff, meanPerformance: u.meanPerformance, fitPerf: mean(perf), fitWin: mean(win), baseline: mean(base), synG: mean(synG), synM: mean(synM), roleDist, size: u.members.length };
      });
      const z = (pick: (row: (typeof rows)[number]) => number | null) => {
        const values = rows.flatMap((row) => { const v = pick(row); return v === null ? [] : [v]; });
        const m = mean(values) ?? 0; const sd = values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)) : 0;
        return (row: (typeof rows)[number]) => { const v = pick(row); return v === null || sd === 0 ? null : (v - m) / sd; };
      };
      const zA = z((r) => r.fitPerf); const zG = z((r) => r.synG); const zM = z((r) => r.synM); const zR = z((r) => r.roleDist); const zW = z((r) => r.fitWin); const zB0 = z((r) => r.baseline);
      const consensus = (...parts: ((row: (typeof rows)[number]) => number | null)[]) => (row: (typeof rows)[number]) => mean(parts.flatMap((p) => { const v = p(row); return v === null ? [] : [v]; }));
      const candidates: Record<string, (row: (typeof rows)[number]) => number | null> = {
        baseline_member_level: zB0, A_individual_fit: zA, A_win_channel: zW, B_fit_plus_global_synergy: consensus(zA, zG), C_fit_plus_map_synergy: consensus(zA, zM),
        D_fit_synergy_role_distribution: consensus(zA, zM, zR), synergy_only: zM, role_distribution_only: zR,
      };
      const evaluateTeam = Object.fromEntries(Object.entries(candidates).map(([id, score]) => {
        const scored = rows.flatMap((row) => { const s = score(row); return s === null ? [] : [{ s, row }]; });
        const winRows = scored.filter((x) => x.row.won !== null);
        const rdRows = scored.filter((x) => x.row.roundDiff !== null); const perfRows = scored.filter((x) => x.row.meanPerformance !== null);
        return [id, { units: scored.length, winAuc: r3(auc(winRows.map((x) => x.s), winRows.map((x) => x.row.won!))),
          roundDiffSpearman: r3(spearman(rdRows.map((x) => x.s), rdRows.map((x) => x.row.roundDiff!))),
          teamPerformanceSpearman: r3(spearman(perfRows.map((x) => x.s), perfRows.map((x) => x.row.meanPerformance!))) }];
      }));
      return { q, to, trainMatches: new Set(train.map((o) => o.matchId)).size, testMatches: new Set(test.map((o) => o.matchId)).size, teamUnits: units.length,
        individual: individual.map((e) => ({ ...e, incrementalCorrelation: r3(e.incrementalCorrelation), spearman: r3(e.spearman), mae: r3(e.mae), auc: r3(e.auc) })), mapShrinkSensitivity, team: evaluateTeam,
        rolePatterns: pattern.size };
    });
    process.stdout.write(`${JSON.stringify({ engine: engine.ruleVersion, sharedMatchCatalogSensitivity: sensitivity, readiness,
      pairSynergy: { pairs: memberIds.length * (memberIds.length - 1) / 2, available: pairsAvailable, mapPairCells, mapPairCellsWithValue: mapPairsAvailable }, folds: foldResults }, null, 2)}\n`);
  } else if (command === 'demo') {
    const { recommendTeamComposition, TeamCompositionModel } = await import('../src/analytics/teamComposition/recommend.js');
    const competitive = matches.filter((m) => m.gameMode === 'Competitive');
    const maps = [...new Set(observations.map((o) => o.map))];
    const synergy = synergySource(competitive, maps);
    const model = new TeamCompositionModel(observations, synergy);
    const scored = new TeamCompositionModel(observations, synergy, { mapEvidence: 'scored' });
    // Deterministic, non-cherry-picked examples.
    const counts = new Map<string, number>(); for (const o of observations) counts.set(o.memberId, (counts.get(o.memberId) ?? 0) + 1);
    const mostActive = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([id]) => id);
    const together = new Map<string, number>();
    for (const unit of teamUnits(observations, 4)) {
      const ids = unit.members.map((m) => m.memberId).sort();
      const combos = ids.length === 5 ? [ids] : [];
      for (const combo of combos) together.set(combo.join(','), (together.get(combo.join(',')) ?? 0) + 1);
    }
    const mostTogether = [...together.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0].split(',') ?? mostActive;
    const firstById = [...memberIds].slice(0, 5);
    const mapCounts = new Map<string, number>(); for (const o of observations) mapCounts.set(o.map, (mapCounts.get(o.map) ?? 0) + 1);
    const byPlay = [...mapCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => m);
    const demoMaps = [byPlay[0]!, byPlay[1]!, byPlay.at(-1)!];
    const lineupSets = [{ rule: 'five most active members', ids: mostActive }, { rule: 'most frequent five-stack', ids: mostTogether }, { rule: 'first five by public id', ids: firstById }];
    const nm = (id: string) => name.get(id) ?? '?';
    const view = (lineup: { members: { memberId: string; agent: string; role: string; responsibility: string | null; fit: number; confidence: number; evidenceLevel: string; samples: Record<string, number>; reasons: string[] }[];
      roleDistribution: Record<string, number>; fitScore: number; teamFit: number; confidence: number; pairSynergy: unknown; tradeoff: string | null }) => ({
      assignment: lineup.members.map((m) => `${nm(m.memberId)}=${m.agent}`).join(', '), roles: lineup.roleDistribution,
      responsibilities: lineup.members.map((m) => `${nm(m.memberId)}:${m.responsibility ?? '—'}`).join(', '),
      teamFit: r3(lineup.teamFit, 1), fitScore: r3(lineup.fitScore, 1), confidence: r3(lineup.confidence, 0), pairSynergy: lineup.pairSynergy, tradeoff: lineup.tradeoff, comparable: (lineup as { comparableToBest?: boolean }).comparableToBest,
      members: lineup.members.map((m) => ({ name: nm(m.memberId), agent: m.agent, role: m.role, fit: r3(m.fit, 1), confidence: r3(m.confidence, 0), level: m.evidenceLevel,
        samples: m.samples, topReasons: m.reasons.slice(0, 4) })),
    });
    const examples = lineupSets.flatMap(({ rule, ids }) => demoMaps.map((map) => {
      const result = recommendTeamComposition({ memberIds: ids, map }, model);
      const research = recommendTeamComposition({ memberIds: ids, map }, scored);
      return { rule, members: ids.map(nm), map, status: result.status, feasibleAssignments: result.feasibleAssignments, experimentalUsed: result.experimentalUsed,
        top: result.lineups[0] ? view(result.lineups[0]) : null, alternatives: result.lineups.slice(1).map(view),
        researchScoredMapTop: research.lineups[0]?.members.map((m) => `${nm(m.memberId)}=${m.agent}`).join(', ') ?? null };
    }));
    // Map variation in the research (map-scored) mode across ALL maps for the three sets.
    const variation = lineupSets.map(({ rule, ids }) => ({ rule, distinctTopAssignmentsAcrossMaps: {
      context: new Set(maps.map((map) => recommendTeamComposition({ memberIds: ids, map }, model).lineups[0]?.members.map((m) => m.agent).join(','))).size,
      scored: new Set(maps.map((map) => recommendTeamComposition({ memberIds: ids, map }, scored).lineups[0]?.members.map((m) => m.agent).join(','))).size }, maps: maps.length }));
    process.stdout.write(`${JSON.stringify({ demoMaps, examples, variation }, null, 2)}
`);
  } else if (command === 'v2') {
    // TASK-ANALYTICS-TEAM-COMPOSITION-02: site-reference-v1 + side-evidence-v1 + team-composition-v2 (private, read-only).
    const { recommendTeamComposition, TeamCompositionModel } = await import('../src/analytics/teamComposition/recommend.js');
    const { SiteReference } = await import('../src/analytics/teamComposition/siteReference.js');
    const { memberRounds } = await import('../src/analytics/teamComposition/sideEvidence.js');
    const { SideModel, refineTeamComposition } = await import('../src/analytics/teamComposition/v2.js');
    const { normalizeHenrikEvidence } = await import('../server/evidence/normalizeHenrikEvidence.js');
    const { participantHmac, providerIdentityHmac } = await import('../server/identityProtection.js');
    // Canonical position-evidence-v1 rounds per match (same normalizer as the durable path).
    const evidenceByMatch = new Map(documents.flatMap(({ matchId, payload }) => {
      const players = (payload as { players?: { puuid?: string }[] }).players ?? [];
      const anchor = members.find((m) => players.some((p) => p.puuid === m.providerPuuid));
      if (!anchor) return [];
      const [evidence] = normalizeHenrikEvidence({ data: [payload] }, { affinity: anchor.affinity, limit: 1 } as never, key, providerIdentityHmac('HenrikDev', anchor.affinity, anchor.providerPuuid, key));
      return evidence ? [[matchId, { evidence, payload }] as const] : [];
    }));
    const competitive = matches.filter((m) => m.gameMode === 'Competitive').sort((a, b) => a.playedAt.localeCompare(b.playedAt) || (a.id < b.id ? -1 : 1));
    const plantsOf = (subset: MatchRecord[]) => subset.flatMap((m) => (evidenceByMatch.get(m.id)?.evidence.rounds ?? [])
      .flatMap((r) => (r.plantSite && r.plantLocation ? [{ map: m.map, site: r.plantSite, x: r.plantLocation.x, y: r.plantLocation.y }] : [])));
    const matchInput = (m: MatchRecord) => {
      const entry = evidenceByMatch.get(m.id)!; const evidence = entry.evidence;
      const matchKey = (entry.payload as { metadata: { match_id: string } }).metadata.match_id;
      const tracked = new Map(members.filter((a) => evidence.participants.some((p) => p.lookupHmac === participantHmac(matchKey, a.providerPuuid, key)))
        .map((a) => { const hmac = participantHmac(matchKey, a.providerPuuid, key); return [hmac, { memberId: a.memberPublicId, agent: m.performances.find((p) => p.playerId === a.memberPublicId)?.agent ?? 'Unknown' }] as const; }));
      return { matchId: m.id, playedAt: m.playedAt, map: m.map, mode: m.gameMode, teams: new Map(evidence.participants.map((p) => [p.lookupHmac, p.teamKey])), members: tracked,
        rounds: evidence.rounds.map((r) => ({ number: r.number, winningTeam: r.winningTeam, attackingTeamKey: r.attackingTeamKey, plantSite: r.plantSite, plantTimeMs: r.plantTimeMs, planter: r.plantParticipantHmac,
          kills: r.kills.map((k) => ({ t: k.timeInRoundMs, killer: k.killerHmac, victim: k.victimHmac, assistants: k.assistantHmacs, snapshots: k.playerLocations.map((s) => ({ participant: s.participantHmac, x: s.x, y: s.y })) })) })) };
    };
    const allMatches = matches.filter((m) => evidenceByMatch.has(m.id)).sort((a, b) => a.playedAt.localeCompare(b.playedAt) || (a.id < b.id ? -1 : 1));
    const splitAt = (list: MatchRecord[], q: number) => list[Math.floor(list.length * q)]!.playedAt;
    // ---- 1. Site reference: chronological validation (train plants → later labelled plants), both gates.
    const plantSplit = splitAt(allMatches, 0.7);
    const siteValidation = Object.fromEntries((['p95', 'p99'] as const).map((gate) => {
      const ref = new SiteReference(plantsOf(allMatches.filter((m) => m.playedAt < plantSplit)), gate);
      const test = plantsOf(allMatches.filter((m) => m.playedAt >= plantSplit));
      let correct = 0; let wrong = 0; let outside = 0; let ambiguous = 0; let unknown = 0;
      for (const p of test) { const c = ref.classify(p.map, p.x, p.y); if (c.status === 'proximal') { if (c.site === p.site) correct += 1; else wrong += 1; } else if (c.status === 'outside') outside += 1; else if (c.status === 'ambiguous') ambiguous += 1; else unknown += 1; }
      const total = test.length;
      return [gate, { testPlants: total, accuracy: r3(correct / total), wrongSite: r3(wrong / total), abstention: r3(outside / total), ambiguity: r3(ambiguous / total), unknownMap: r3(unknown / total),
        precisionWhenClassified: r3(correct / Math.max(1, correct + wrong)) }];
    }));
    const fullRef = new SiteReference(plantsOf(allMatches), 'p95');
    // ---- 2. Side evidence (Competitive only) with the full reference; coverage.
    const rounds = competitive.flatMap((m) => memberRounds(matchInput(m), fullRef));
    const sideCoverage = { memberRounds: rounds.length, attack: rounds.filter((r) => r.side === 'ATTACK').length, defense: rounds.filter((r) => r.side === 'DEFENSE').length,
      unknownSide: rounds.filter((r) => r.side === null).length, snapshots: rounds.reduce((s, r) => s + r.snapshots, 0), siteProximalSnapshots: rounds.reduce((s, r) => s + r.classifiedSnapshots, 0),
      abstainedSnapshots: rounds.reduce((s, r) => s + r.abstainedSnapshots, 0), clutchExcludedRounds: rounds.filter((r) => r.clutchAttempt === null).length,
      firstContactContext: Object.fromEntries([...rounds.reduce((m, r) => (r.firstDuelContext === null ? m : m.set(r.firstDuelContext, (m.get(r.firstDuelContext) ?? 0) + 1)), new Map<string, number>())].sort()) };
    // ---- 3. Holdout: train (< split) vs test (≥ split); site reference rebuilt from train plants only.
    const split = splitAt(competitive, 0.7);
    const trainRef = new SiteReference(plantsOf(allMatches.filter((m) => m.playedAt < split)), 'p95');
    const trainRounds = competitive.filter((m) => m.playedAt < split).flatMap((m) => memberRounds(matchInput(m), trainRef));
    const testRounds = competitive.filter((m) => m.playedAt >= split).flatMap((m) => memberRounds(matchInput(m), trainRef));
    const trainModel = new SideModel(trainRounds); const testModel = new SideModel(testRounds);
    const rates = ['firstContact', 'trade', 'assists', 'survival', 'plant', 'postPlant', 'sitePresence', 'clutch'] as const;
    const behaviour = Object.fromEntries((['ATTACK', 'DEFENSE'] as const).map((side) => [side, Object.fromEntries(rates.map((rate) => {
      const pairs = memberIds.flatMap((id) => { const a = trainModel.profile(id, side); const b = testModel.profile(id, side);
        return a && b && a.matches >= 5 && b.matches >= 5 && a.rates[rate] !== undefined && b.rates[rate] !== undefined ? [[a.rates[rate]!, b.rates[rate]!]] : []; });
      return [rate, { members: pairs.length, spearman: r3(spearman(pairs.map((p) => p[0]!), pairs.map((p) => p[1]!))) }];
    }))]));
    // Within-member attack − defense differences: does the side split replicate?
    const sideSplit = Object.fromEntries(rates.slice(0, 4).map((rate) => {
      let agree = 0; let n = 0;
      for (const id of memberIds) {
        const [ta, td, sa, sd] = [trainModel.profile(id, 'ATTACK'), trainModel.profile(id, 'DEFENSE'), testModel.profile(id, 'ATTACK'), testModel.profile(id, 'DEFENSE')];
        if (!ta || !td || !sa || !sd || [ta, td, sa, sd].some((p) => p.matches < 5)) continue;
        n += 1; if (Math.sign(ta.rates[rate]! - td.rates[rate]!) === Math.sign(sa.rates[rate]! - sd.rates[rate]!)) agree += 1;
      }
      return [rate, { members: n, signAgreement: r3(n ? agree / n : null) }];
    }));
    // Site tendency: affinities established in train → test-period votes for that site vs the test group base rate.
    const mapsC = [...new Set(competitive.map((m) => m.map))];
    const affinityTests: { side: string; trainP: number; testShare: number | null; testBase: number | null; testMatches: number }[] = [];
    for (const id of memberIds) for (const map of mapsC) for (const side of ['ATTACK', 'DEFENSE'] as const) {
      const a = trainModel.siteAffinity(id, map, side);
      if (!a.site) continue;
      const t = testModel.siteAffinity(id, map, side);
      const testShare = t.votingMatches ? (t.site === a.site ? t.matchesForSite / t.votingMatches : null) : null;
      affinityTests.push({ side, trainP: a.pValue ?? 1, testShare, testBase: t.baseRate, testMatches: t.votingMatches });
    }
    const sameSiteInTest = affinityTests.filter((a) => a.testMatches >= 1);
    // Per-member stability of the site-tendency decision (affinity present in train AND test with the same site).
    let stableAffinities = 0; let trainAffinities = 0;
    for (const id of memberIds) for (const map of mapsC) for (const side of ['ATTACK', 'DEFENSE'] as const) {
      const a = trainModel.siteAffinity(id, map, side); if (!a.site) continue; trainAffinities += 1;
      const t = testModel.siteAffinity(id, map, side); if (t.site === a.site) stableAffinities += 1;
    }
    // Responsibility flag stability: above-median flags per member × side × rate, train vs test (vs chance).
    let flagAgree = 0; let flagN = 0; let flagPosTrain = 0; let flagPosTest = 0;
    for (const id of memberIds) for (const side of ['ATTACK', 'DEFENSE'] as const) for (const rate of rates) {
      const a = trainModel.profile(id, side); const b = testModel.profile(id, side);
      if (!a || !b || a.matches < 5 || b.matches < 5 || a.rates[rate] === undefined || b.rates[rate] === undefined) continue;
      const fa = a.rates[rate]! > trainModel.median(side, rate); const fb = b.rates[rate]! > testModel.median(side, rate);
      flagN += 1; if (fa === fb) flagAgree += 1; if (fa) flagPosTrain += 1; if (fb) flagPosTest += 1;
    }
    const pa = flagPosTrain / Math.max(1, flagN); const pb = flagPosTest / Math.max(1, flagN);
    const chance = pa * pb + (1 - pa) * (1 - pb);
    // ---- 4. Real examples: the SAME deterministic V1 selection, V1 output + V2 refinement (full data).
    const model = new TeamCompositionModel(observations, synergySource(competitive, [...new Set(observations.map((o) => o.map))]));
    const sideModel = new SideModel(rounds);
    const counts = new Map<string, number>(); for (const o of observations) counts.set(o.memberId, (counts.get(o.memberId) ?? 0) + 1);
    const mostActive = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([id]) => id);
    const together = new Map<string, number>();
    for (const unit of teamUnits(observations, 4)) { const ids = unit.members.map((m) => m.memberId).sort(); if (ids.length === 5) together.set(ids.join(','), (together.get(ids.join(',')) ?? 0) + 1); }
    const mostTogether = [...together.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0].split(',') ?? mostActive;
    const mapCounts = new Map<string, number>(); for (const o of observations) mapCounts.set(o.map, (mapCounts.get(o.map) ?? 0) + 1);
    const byPlay = [...mapCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => m);
    const nm = (id: string) => name.get(id) ?? '?';
    const examples = [{ rule: 'five most active members', ids: mostActive }, { rule: 'most frequent five-stack', ids: mostTogether }, { rule: 'first five by public id', ids: [...memberIds].slice(0, 5) }]
      .flatMap(({ rule, ids }) => [byPlay[0]!, byPlay[1]!, byPlay.at(-1)!].map((map) => {
        const v1 = recommendTeamComposition({ memberIds: ids, map }, model);
        const v2 = refineTeamComposition(v1, sideModel);
        const v1Assignment = v1.lineups[0]?.members.map((m) => `${nm(m.memberId)}=${m.agent}`).join(', ') ?? null;
        return { rule, map, v1Assignment, v2Assignment: v2?.assignment.map((m) => `${nm(m.memberId)}=${m.agent}`).join(', ') ?? null,
          emittable: v2?.emittable, members: v2?.members.map((m) => ({ name: nm(m.memberId), agent: m.agent, role: m.role,
            attack: { responsibility: m.attack.responsibility, site: m.attack.siteTendency.site, siteMatches: `${m.attack.siteTendency.matchesForSite}/${m.attack.siteTendency.votingMatches}`, confidence: r3(m.attack.confidence, 0) },
            defense: { responsibility: m.defense.responsibility, site: m.defense.siteTendency.site, siteMatches: `${m.defense.siteTendency.matchesForSite}/${m.defense.siteTendency.votingMatches}`, confidence: r3(m.defense.confidence, 0) },
            evidence: [...m.attack.evidence.slice(0, 1), ...m.defense.evidence.slice(-1)] })) ?? [] };
      }));
    // Site-tendency summary on full data (member × map × side cells).
    let cells = 0; let withAffinity = 0; let insufficient = 0;
    const affinityMembers = new Set<string>();
    for (const id of memberIds) for (const map of mapsC) for (const side of ['ATTACK', 'DEFENSE'] as const) {
      const a = sideModel.siteAffinity(id, map, side); cells += 1;
      if (a.site) { withAffinity += 1; affinityMembers.add(id); } else if (a.votingMatches < 5) insufficient += 1;
    }
    process.stdout.write(`${JSON.stringify({ siteValidation, sideCoverage,
      holdout: { split: 'chronological 70/30 by Competitive match; site reference from train plants only', trainRounds: trainRounds.length, testRounds: testRounds.length,
        behaviourStability: behaviour, sideSplitReplication: sideSplit,
        siteTendency: { trainAffinities, stableInTest: stableAffinities, withTestEvidence: sameSiteInTest.length,
          meanTestShare: r3(mean(sameSiteInTest.flatMap((a) => (a.testShare === null ? [] : [a.testShare])))), meanTestBase: r3(mean(sameSiteInTest.flatMap((a) => (a.testBase === null ? [] : [a.testBase])))),
          aboveBase: sameSiteInTest.filter((a) => a.testShare !== null && a.testBase !== null && a.testShare > a.testBase).length },
        responsibilityFlagStability: { flags: flagN, agreement: r3(flagAgree / Math.max(1, flagN)), chanceAgreement: r3(chance) } },
      siteAffinityFull: { cells, withAffinity, insufficient, membersWithAnyAffinity: [...affinityMembers].map(nm).sort() },
      examples }, null, 2)}\n`);
  } else {
    throw new Error('usage: team-composition -- evaluate | demo <json> | v2');
  }
} finally {
  await database.close();
}
