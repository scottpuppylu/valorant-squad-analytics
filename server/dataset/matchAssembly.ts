import type { AdvancedMetrics } from '../../src/types/advancedMetrics.js';
import type { MatchPairTradeEvidence, MatchPerformance, MatchRecord } from '../../src/types/valorant.js';
import { normalizeGameMode } from '../../src/utils/gameMode.js';
import { normalizeSeasonKey } from '../../src/analytics/scope/season.js';
import type { EvidenceStatus } from '../evidence/types.js';
import type { EventMetricEngine } from '../metrics/eventMetricEngine.js';
import type { EventMetricMatchInput, MetricKillInput, MetricParticipantInput, MetricRoundInput, ReconstructedAdvancedMetrics } from '../metrics/types.js';
import type { DatasetEventRow, DatasetPerformanceRow, DatasetPlayerRow, DatasetRoundParticipantRow, DatasetRoundRow } from './types.js';

/**
 * TASK-DATA-03B.2D — the ONE per-match projection, split into two deterministic halves:
 *
 * 1. `reconstructMatchFacts` runs the unchanged event-metrics-v1 engine over one match's durable topology
 *    and returns, per performance participant, exactly what the projection consumes (`ParticipantFact`).
 * 2. `assembleMatch` turns visible performance rows + those facts into the public `MatchRecord`.
 *
 * The raw path (snapshot, history, analysis fallback) calls 1 then 2. The materialized path
 * (analysis-match-facts-v1) stores the output of 1 and later calls only 2. Both paths therefore share
 * every line of projection logic; parity tests compare them end to end.
 */

/** Everything `assembleMatch` needs about one participant beyond its performance row. */
export interface ParticipantFact {
  /** Durable rounds of the match (the ACS/ADR denominator). */
  observedRounds: number;
  /** Basic round evidence: the match has rounds and the participant is present in every one. */
  presentEveryRound: boolean;
  /** event-metrics-v1 reconstruction of this participant (trace excluded; it is never projected). */
  metrics: ReconstructedAdvancedMetrics;
  /** Direct trade edges where this participant is the trader: [victim participant id, count]. */
  tradeEdges: [string, number][];
}

export interface MatchTopology {
  /** Performance rows of the participants to reconstruct (all of the match's rows the caller holds). */
  performances: DatasetPerformanceRow[];
  rounds: DatasetRoundRow[];
  roundParticipants: DatasetRoundParticipantRow[];
  events: DatasetEventRow[];
}

export function dateValue(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableNumber(value: unknown): number | undefined {
  if (finite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function evidenceStatus(value: string): EvidenceStatus {
  return value === 'observed' || value === 'unavailable' ? value : 'missing';
}

function objectiveStatus(value: string): MetricRoundInput['plantStatus'] {
  return value === 'present' || value === 'absent' || value === 'unavailable' ? value : 'missing';
}

function metricEvents(rows: DatasetEventRow[]): MetricKillInput[] {
  const events = new Map<string, MetricKillInput>();
  for (const row of rows) {
    const key = `${row.internal_round_id}|${row.event_sequence}`;
    const existing = events.get(key) ?? {
      roundId: row.internal_round_id,
      sequence: row.event_sequence,
      timeInRoundMs: row.time_in_round_ms,
      killerId: row.killer_participant_id,
      victimId: row.victim_participant_id,
      assistantIds: [],
    };
    if (row.assistant_participant_id && !existing.assistantIds.includes(row.assistant_participant_id)) {
      existing.assistantIds.push(row.assistant_participant_id);
    }
    events.set(key, existing);
  }
  return [...events.values()];
}

function participantInput(row: DatasetPerformanceRow): MetricParticipantInput {
  return {
    id: row.internal_participant_id,
    teamKey: row.team_key,
    agent: row.agent_name ?? undefined,
    assists: nullableNumber(row.assists),
    kills: nullableNumber(row.kills),
    damage: nullableNumber(row.damage_dealt),
    abilityStatus: evidenceStatus(row.ability_evidence_status),
    ability1Casts: nullableNumber(row.ability_1_casts),
    ability2Casts: nullableNumber(row.ability_2_casts),
    grenadeCasts: nullableNumber(row.grenade_casts),
    ultimateCasts: nullableNumber(row.ultimate_casts),
    economyStatus: evidenceStatus(row.economy_evidence_status),
    loadoutValueTotal: nullableNumber(row.loadout_value_total),
    loadoutValueAverage: nullableNumber(row.loadout_value_average),
    spentTotal: nullableNumber(row.spent_total),
    spentAverage: nullableNumber(row.spent_average),
  };
}

function publicAdvancedMetrics(metrics: ReconstructedAdvancedMetrics): AdvancedMetrics {
  const nonZero = <T extends object>(value: T): Partial<T> => Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== 0),
  ) as Partial<T>;
  const compactTrade = metrics.trade.value ? nonZero(metrics.trade.value) : undefined;
  const compactObjectives = metrics.objectives.value ? nonZero(metrics.objectives.value) : undefined;
  const compactAbilities = metrics.abilityCasts.value ? nonZero(metrics.abilityCasts.value) : undefined;
  const compactImpact = metrics.impactContext.value ? nonZero(metrics.impactContext.value) : undefined;
  const clutch = metrics.clutch.value;
  const compactClutch = clutch ? {
    ...(clutch.clutchAttempts ? { clutchAttempts: clutch.clutchAttempts } : {}),
    ...(clutch.clutchWins ? { clutchWins: clutch.clutchWins } : {}),
    ...(Object.values(clutch.attemptsByOpponents).some(Boolean) ? { attemptsByOpponents: nonZero(clutch.attemptsByOpponents) } : {}),
    ...(clutch.winsByOpponents && Object.values(clutch.winsByOpponents).some(Boolean) ? { winsByOpponents: nonZero(clutch.winsByOpponents) } : {}),
  } : undefined;
  const economy = metrics.economy.value;
  const compactEconomy = economy ? {
    ...nonZero({
      loadoutValueTotal: economy.loadoutValueTotal, loadoutValueAverage: economy.loadoutValueAverage,
      spentTotal: economy.spentTotal, spentAverage: economy.spentAverage, damage: economy.damage, kills: economy.kills,
    }),
    damagePer1000SpentStatus: economy.damagePer1000SpentStatus,
    ...(economy.damagePer1000Spent === undefined ? {} : { damagePer1000Spent: economy.damagePer1000Spent }),
    killsPer1000SpentStatus: economy.killsPer1000SpentStatus,
    ...(economy.killsPer1000Spent === undefined ? {} : { killsPer1000Spent: economy.killsPer1000Spent }),
  } : undefined;
  return {
    ruleVersion: metrics.ruleVersion,
    coverage: metrics.coverage,
    evidence: {
      trade: metrics.trade.status,
      clutch: metrics.clutch.status,
      objectives: metrics.objectives.status,
      abilityCasts: metrics.abilityCasts.status,
      economy: metrics.economy.status,
      impactContext: metrics.impactContext.status,
      roleValueInputs: metrics.roleValueInputs.status,
    },
    ...(compactTrade && Object.keys(compactTrade).length > 0 ? { trade: compactTrade } : {}),
    ...(compactClutch && Object.keys(compactClutch).length > 0 ? { clutch: compactClutch } : {}),
    ...(compactObjectives && Object.keys(compactObjectives).length > 0 ? { objectives: compactObjectives } : {}),
    ...(compactAbilities && Object.keys(compactAbilities).length > 0 ? { abilityCasts: compactAbilities } : {}),
    ...(compactEconomy ? { economy: compactEconomy } : {}),
    ...(compactImpact && Object.keys(compactImpact).length > 0 ? { impactContext: compactImpact } : {}),
  };
}

/**
 * event-metrics-v1 over one match. `topology.performances` are the participants whose facts are wanted;
 * every round-present participant joins the engine input exactly like the projection always did.
 */
export function reconstructMatchFacts(engine: EventMetricEngine, topology: MatchTopology): { facts: Map<string, ParticipantFact>; eventCount: number } {
  const first = topology.performances[0];
  const participantRows = new Map<string, MetricParticipantInput>();
  for (const row of topology.roundParticipants) {
    participantRows.set(row.internal_participant_id, { id: row.internal_participant_id, teamKey: row.team_key, abilityStatus: 'missing', economyStatus: 'missing' });
  }
  for (const row of topology.performances) participantRows.set(row.internal_participant_id, participantInput(row));
  const roundInputs: MetricRoundInput[] = topology.rounds.map((round) => ({
    id: round.internal_round_id,
    number: round.round_number,
    winningTeam: round.winning_team ?? undefined,
    participantsStatus: evidenceStatus(round.participants_evidence_status),
    participantIds: topology.roundParticipants
      .filter((participant) => participant.internal_round_id === round.internal_round_id && participant.present)
      .map((participant) => participant.internal_participant_id),
    plantStatus: objectiveStatus(round.plant_status),
    plantParticipantId: round.plant_participant_id ?? undefined,
    defuseStatus: objectiveStatus(round.defuse_status),
    defuseParticipantId: round.defuse_participant_id ?? undefined,
  }));
  const kills = metricEvents(topology.events);
  const metricInput: EventMetricMatchInput = {
    normalizationVersion: first?.normalization_version ?? '',
    roundsStatus: evidenceStatus(first?.rounds_evidence_status ?? 'missing'),
    killsStatus: evidenceStatus(first?.kills_evidence_status ?? 'missing'),
    participants: [...participantRows.values()],
    rounds: roundInputs,
    kills,
  };
  const reconstruction = engine.reconstruct(metricInput);
  const edgesByTrader = new Map<string, [string, number][]>();
  for (const edge of reconstruction.directTradeEdges) edgesByTrader.set(edge.traderId, [...(edgesByTrader.get(edge.traderId) ?? []), [edge.victimId, edge.count]]);
  const facts = new Map<string, ParticipantFact>();
  for (const row of topology.performances) {
    const reconstructed = reconstruction.players.get(row.internal_participant_id);
    if (!reconstructed) continue;
    const visibleRoundIds = new Set(topology.roundParticipants
      .filter((presence) => presence.internal_participant_id === row.internal_participant_id && presence.present)
      .map((presence) => presence.internal_round_id));
    facts.set(row.internal_participant_id, {
      observedRounds: topology.rounds.length,
      presentEveryRound: topology.rounds.length > 0 && topology.rounds.every((round) => visibleRoundIds.has(round.internal_round_id)),
      metrics: reconstructed.metrics,
      tradeEdges: edgesByTrader.get(row.internal_participant_id) ?? [],
    });
  }
  return { facts, eventCount: kills.length };
}

/**
 * analysis-match-facts-v1 exactness condition. Facts are computed at write time for every LINKED
 * participant, while the read projection feeds the engine round-present participants plus only the
 * VISIBLE (consenting) ones. A linked participant outside every round could change OTHER participants'
 * results only through the engine's participant map (objective owner lookup, winning-team presence,
 * trade team lookup). When none of those can differ for any visible subset, the stored facts equal the
 * read-time reconstruction for every possible visibility; otherwise no facts are stored (raw fallback).
 */
export function factsAreVisibilityIndependent(topology: MatchTopology): boolean {
  const roundPresent = new Set(topology.roundParticipants.filter((row) => row.present).map((row) => row.internal_participant_id));
  const roundTeams = new Set(topology.roundParticipants.map((row) => row.team_key));
  const referenced = new Set<string>();
  for (const event of topology.events) {
    referenced.add(event.killer_participant_id);
    referenced.add(event.victim_participant_id);
    if (event.assistant_participant_id) referenced.add(event.assistant_participant_id);
  }
  for (const round of topology.rounds) {
    if (round.plant_participant_id) referenced.add(round.plant_participant_id);
    if (round.defuse_participant_id) referenced.add(round.defuse_participant_id);
  }
  return topology.performances.every((row) => roundPresent.has(row.internal_participant_id)
    || (!referenced.has(row.internal_participant_id) && (topology.rounds.length === 0 || roundTeams.has(row.team_key))));
}

/** Same-match duplicate-member guard: a person cannot normally play two accounts in one match. */
export function hasMemberCollision(memberIds: (string | undefined)[]): boolean {
  const known = memberIds.filter((id): id is string => id !== undefined);
  return new Set(known).size !== known.length;
}

export interface AssemblyContext {
  playerRowByInternalId: Map<string, DatasetPlayerRow>;
  accountsPerMember: Map<string, number>;
}

export type AssemblyResult =
  | { kind: 'skipped' }
  | { kind: 'identity_conflict' }
  | { kind: 'assembled'; match: MatchRecord | undefined; roundEvidenceComplete: boolean; headshotEvidenceComplete: boolean };

/**
 * Public MatchRecord of one match from its VISIBLE performance rows (projection order) and their facts.
 * `match` is undefined when no performance passes the basic gates. The evidence flags describe every
 * visible row, exactly as the projection's dataset-wide availability always did.
 */
export function assembleMatch(context: AssemblyContext, performanceRows: DatasetPerformanceRow[], facts: Map<string, ParticipantFact>): AssemblyResult {
  const first = performanceRows[0];
  if (!first) return { kind: 'skipped' };
  const playedAt = dateValue(first.started_at);
  if (!playedAt) return { kind: 'skipped' };
  // Identity invariant: never sum two account performances of one member in one match.
  if (hasMemberCollision(performanceRows.map((row) => context.playerRowByInternalId.get(row.internal_player_id)?.member_public_id))) {
    return { kind: 'identity_conflict' };
  }
  let roundEvidenceComplete = true;
  let headshotEvidenceComplete = true;
  const visibleTeams = [...new Set(performanceRows.map((row) => row.team_key).filter((key) => key && key !== 'unknown'))].sort();
  const teamGroups = new Map(visibleTeams.length <= 2 ? visibleTeams.map((key, index) => [key, index === 0 ? 'A' as const : 'B' as const]) : []);
  let observedRoundsForMatch = 0;

  const performances = performanceRows.flatMap((row): MatchPerformance[] => {
    const player = context.playerRowByInternalId.get(row.internal_player_id);
    const fact = facts.get(row.internal_participant_id);
    const reconstructed = fact?.metrics;
    const observedRounds = fact?.observedRounds ?? 0;
    observedRoundsForMatch = observedRounds;
    const basicRoundEvidenceComplete = fact?.presentEveryRound === true;
    if (!reconstructed?.kast.value || !reconstructed.opening.value) roundEvidenceComplete = false;
    if (!player || row.stats_evidence_status !== 'observed' || !row.agent_name
      || !finite(row.kills) || !finite(row.deaths) || !finite(row.assists)
      || !finite(row.score) || !finite(row.damage_dealt) || !basicRoundEvidenceComplete) return [];
    let headshotPercentage: number | undefined;
    if (finite(row.headshots) && finite(row.bodyshots) && finite(row.legshots)) {
      const shotTotal = row.headshots + row.bodyshots + row.legshots;
      headshotPercentage = shotTotal === 0 ? 0 : row.headshots / shotTotal;
    } else {
      headshotEvidenceComplete = false;
    }
    return [{
      playerId: player.member_public_id,
      ...((context.accountsPerMember.get(player.member_public_id) ?? 0) > 1 ? { accountId: player.public_id } : {}),
      ...(teamGroups.has(row.team_key) ? { teamGroup: teamGroups.get(row.team_key) } : {}),
      ...(typeof row.team_won === 'boolean' ? { teamWon: row.team_won } : {}),
      ...(finite(row.rounds_won) && row.rounds_won >= 0 ? { teamRoundsWon: row.rounds_won } : {}),
      ...(finite(row.rounds_lost) && row.rounds_lost >= 0 ? { teamRoundsLost: row.rounds_lost } : {}),
      agent: row.agent_name,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      acs: row.score / observedRounds,
      adr: row.damage_dealt / observedRounds,
      eventEvidence: {
        kast: reconstructed?.kast.status === 'reconstructed' ? 'reconstructed' : reconstructed?.kast.status === 'partial' ? 'partial' : 'unavailable',
        opening: reconstructed?.opening.status === 'reconstructed' ? 'reconstructed' : reconstructed?.opening.status === 'partial' ? 'partial' : 'unavailable',
      },
      ...(reconstructed?.kast.status === 'reconstructed' && reconstructed.kast.value ? { kast: reconstructed.kast.value.rate } : {}),
      ...(headshotPercentage === undefined ? {} : { headshotPercentage }),
      ...(reconstructed?.opening.status === 'reconstructed' && reconstructed.opening.value ? {
        firstKills: reconstructed.opening.value.firstKills,
        firstDeaths: reconstructed.opening.value.firstDeaths,
      } : {}),
      ...(reconstructed ? { advancedMetrics: publicAdvancedMetrics(reconstructed) } : {}),
    }];
  });
  if (performances.length === 0) return { kind: 'assembled', match: undefined, roundEvidenceComplete, headshotEvidenceComplete };
  const internalByPublic = new Map(performanceRows.map((row) => [context.playerRowByInternalId.get(row.internal_player_id)?.member_public_id, row.internal_participant_id]));
  const edgeCounts = new Map<string, number>();
  for (const row of performanceRows) {
    for (const [victimId, count] of facts.get(row.internal_participant_id)?.tradeEdges ?? []) edgeCounts.set(JSON.stringify([row.internal_participant_id, victimId]), count);
  }
  const complete = performances.every((p) => p.advancedMetrics?.evidence.trade === 'reconstructed');
  const synergyEvidence: MatchPairTradeEvidence = { ruleVersion: 'event-metrics-v1', status: complete ? 'reconstructed' : 'unavailable',
    reconstructedRounds: complete ? observedRoundsForMatch : 0, pairs: [] };
  for (let i = 0; i < performances.length; i += 1) for (let j = i + 1; j < performances.length; j += 1) {
    const a = performances[i]!; const b = performances[j]!;
    if (!a.teamGroup || a.teamGroup !== b.teamGroup) continue;
    synergyEvidence.pairs.push(complete ? [i, j,
      edgeCounts.get(JSON.stringify([internalByPublic.get(a.playerId), internalByPublic.get(b.playerId)])) ?? 0,
      edgeCounts.get(JSON.stringify([internalByPublic.get(b.playerId), internalByPublic.get(a.playerId)])) ?? 0,
    ] : [i, j]);
  }
  const seasonKey = normalizeSeasonKey(first.season_short);
  return {
    kind: 'assembled',
    roundEvidenceComplete,
    headshotEvidenceComplete,
    match: {
      id: first.public_match_id,
      playedAt,
      map: first.map_name ?? 'Unknown',
      gameMode: normalizeGameMode(first.queue_id, first.queue_name),
      opponent: '對手隊伍',
      scoreFor: first.rounds_won ?? 0,
      scoreAgainst: first.rounds_lost ?? 0,
      won: first.team_won === true,
      durationMinutes: Math.max(1, Math.round((first.game_length_ms ?? 0) / 60_000)),
      ...(seasonKey ? { seasonKey } : {}),
      performances,
      ...(synergyEvidence.pairs.length ? { synergyEvidence } : {}),
    },
  };
}
