import { createHash } from 'node:crypto';
import { playerEmojiOptions, type PlayerEmoji } from '../../src/types/avatar.js';
import type { AdvancedMetrics } from '../../src/types/advancedMetrics.js';
import type { MatchPerformance, MatchRecord, Player } from '../../src/types/valorant.js';
import { primaryRoleForAgents } from '../../src/utils/agentRoles.js';
import { normalizeGameMode } from '../../src/utils/gameMode.js';
import type { EvidenceStatus } from '../evidence/types.js';
import { EventMetricEngine } from '../metrics/eventMetricEngine.js';
import type { EventMetricMatchInput, MetricKillInput, MetricParticipantInput, MetricRoundInput, ReconstructedAdvancedMetrics } from '../metrics/types.js';
import type { DatasetEventRow, DatasetPerformanceRow, DatasetProjectionResult, DatasetReadRepository } from './types.js';
import { datasetProjectionVersion, datasetSchemaVersion, datasetWindowSize } from './types.js';

const accentPalette = ['#6ee7b7', '#67e8f9', '#c4b5fd', '#f9a8d4', '#fdba74', '#fde68a'];
const playerEmojiSet = new Set<string>(playerEmojiOptions);

function safePlayerEmoji(value: string): PlayerEmoji {
  return playerEmojiSet.has(value) ? value as PlayerEmoji : '🤖';
}

function dateValue(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function finite(value: unknown): value is number {
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

function accentFor(publicId: string): string {
  const total = [...publicId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return accentPalette[total % accentPalette.length]!;
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const list = grouped.get(groupKey) ?? [];
    list.push(value);
    grouped.set(groupKey, list);
  }
  return grouped;
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

export class DatasetProjectionService {
  private readonly metricEngine = new EventMetricEngine();

  constructor(private readonly repository: DatasetReadRepository) {}

  async read(): Promise<DatasetProjectionResult> {
    const rows = await this.repository.readProjectionRows(datasetWindowSize);
    const projectionStarted = performance.now();
    let metricReconstructionMs = 0;
    let eventCount = 0;
    const playerRowByInternalId = new Map(rows.players.map((row) => [row.internal_player_id, row]));
    const agentsByPlayer = new Map<string, Set<string>>();
    for (const row of rows.performances) {
      if (!row.agent_name) continue;
      const agents = agentsByPlayer.get(row.internal_player_id) ?? new Set<string>();
      agents.add(row.agent_name);
      agentsByPlayer.set(row.internal_player_id, agents);
    }
    const players: Player[] = rows.players.map((row) => {
      const agents = [...(agentsByPlayer.get(row.internal_player_id) ?? [])].sort();
      return {
        id: row.public_id,
        handle: `${row.display_name}#${row.display_tag}`,
        displayName: row.display_name,
        role: primaryRoleForAgents(agents),
        agents,
        accent: accentFor(row.public_id),
        tagline: '持久化戰績成員',
        playstyle: '依目前可用的持久化對戰證據呈現；不代表完整生涯紀錄。',
        defaultEmoji: safePlayerEmoji(row.default_emoji),
      };
    });

    const performanceByMatch = groupBy(rows.performances, (row) => row.internal_match_id);
    const roundsByMatch = groupBy(rows.rounds, (row) => row.internal_match_id);
    const roundMatch = new Map(rows.rounds.map((row) => [row.internal_round_id, row.internal_match_id]));
    const roundParticipantsByMatch = groupBy(rows.roundParticipants, (row) => roundMatch.get(row.internal_round_id) ?? '');
    const eventsByMatch = groupBy(rows.events, (row) => row.internal_match_id);
    let completeRoundEvidence = true;
    let completeHeadshotEvidence = true;
    const matches: MatchRecord[] = [];

    for (const [matchId, performanceRows] of performanceByMatch) {
      const first = performanceRows[0];
      if (!first) continue;
      const playedAt = dateValue(first.started_at);
      if (!playedAt) continue;
      const matchRounds = roundsByMatch.get(matchId) ?? [];
      const matchRoundParticipants = roundParticipantsByMatch.get(matchId) ?? [];
      const participantRows = new Map<string, MetricParticipantInput>();
      for (const row of matchRoundParticipants) {
        participantRows.set(row.internal_participant_id, {
          id: row.internal_participant_id,
          teamKey: row.team_key,
          abilityStatus: 'missing',
          economyStatus: 'missing',
        });
      }
      for (const row of performanceRows) participantRows.set(row.internal_participant_id, participantInput(row));
      const roundInputs: MetricRoundInput[] = matchRounds.map((round) => ({
        id: round.internal_round_id,
        number: round.round_number,
        winningTeam: round.winning_team ?? undefined,
        participantsStatus: evidenceStatus(round.participants_evidence_status),
        participantIds: matchRoundParticipants
          .filter((participant) => participant.internal_round_id === round.internal_round_id && participant.present)
          .map((participant) => participant.internal_participant_id),
        plantStatus: objectiveStatus(round.plant_status),
        plantParticipantId: round.plant_participant_id ?? undefined,
        defuseStatus: objectiveStatus(round.defuse_status),
        defuseParticipantId: round.defuse_participant_id ?? undefined,
      }));
      const matchMetricEvents = metricEvents(eventsByMatch.get(matchId) ?? []);
      eventCount += matchMetricEvents.length;
      const metricInput: EventMetricMatchInput = {
        normalizationVersion: first.normalization_version,
        roundsStatus: evidenceStatus(first.rounds_evidence_status),
        killsStatus: evidenceStatus(first.kills_evidence_status),
        participants: [...participantRows.values()],
        rounds: roundInputs,
        kills: matchMetricEvents,
      };
      const metricStarted = performance.now();
      const reconstruction = this.metricEngine.reconstruct(metricInput);
      metricReconstructionMs += performance.now() - metricStarted;

      const performances = performanceRows.flatMap((row): MatchPerformance[] => {
        const player = playerRowByInternalId.get(row.internal_player_id);
        const reconstructed = reconstruction.players.get(row.internal_participant_id)?.metrics;
        const observedRounds = matchRounds.length;
        if (!reconstructed?.kast.value || !reconstructed.opening.value) completeRoundEvidence = false;
        if (!player || row.stats_evidence_status !== 'observed' || !row.agent_name
          || !finite(row.kills) || !finite(row.deaths) || !finite(row.assists)
          || !finite(row.score) || !finite(row.damage_dealt) || observedRounds === 0
          || !reconstructed?.kast.value || !reconstructed.opening.value) return [];
        let headshotPercentage: number | undefined;
        if (finite(row.headshots) && finite(row.bodyshots) && finite(row.legshots)) {
          const shotTotal = row.headshots + row.bodyshots + row.legshots;
          headshotPercentage = shotTotal === 0 ? 0 : row.headshots / shotTotal;
        } else {
          completeHeadshotEvidence = false;
        }
        return [{
          playerId: player.public_id,
          agent: row.agent_name,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          acs: row.score / observedRounds,
          adr: row.damage_dealt / observedRounds,
          kast: reconstructed.kast.value.rate,
          ...(headshotPercentage === undefined ? {} : { headshotPercentage }),
          firstKills: reconstructed.opening.value.firstKills,
          firstDeaths: reconstructed.opening.value.firstDeaths,
          advancedMetrics: publicAdvancedMetrics(reconstructed),
        }];
      });
      if (performances.length === 0) continue;
      matches.push({
        id: first.public_match_id,
        playedAt,
        map: first.map_name ?? 'Unknown',
        gameMode: normalizeGameMode(first.queue_id, first.queue_name),
        opponent: '對手隊伍',
        scoreFor: first.rounds_won ?? 0,
        scoreAgainst: first.rounds_lost ?? 0,
        won: first.team_won === true,
        durationMinutes: Math.max(1, Math.round((first.game_length_ms ?? 0) / 60_000)),
        performances,
      });
    }
    matches.sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
    const dataset = { players, matches, sourceId: 'durable-neon-v2', isDemo: false as const, mode: 'REAL' as const };
    const availability = {
      acs: 'derived' as const,
      adr: 'derived' as const,
      headshotPercentage: completeHeadshotEvidence ? 'derived' as const : 'partial' as const,
      kast: completeRoundEvidence ? 'reconstructed' as const : 'partial' as const,
      firstKills: completeRoundEvidence ? 'reconstructed' as const : 'partial' as const,
      firstDeaths: completeRoundEvidence ? 'reconstructed' as const : 'partial' as const,
    };
    const coverage = {
      from: dateValue(rows.coverage?.coverage_from),
      to: dateValue(rows.coverage?.coverage_to),
      lastSyncedAt: dateValue(rows.coverage?.last_synced_at),
      completeForProviderWindow: rows.coverage?.complete_for_provider_window === true,
      boundedMatchLimit: datasetWindowSize,
      lifetimeComplete: false as const,
    };
    const version = createHash('sha256').update(JSON.stringify({ dataset, coverage, evidence: availability })).digest('base64url').slice(0, 24);
    const payload = {
      ok: true as const,
      schemaVersion: datasetSchemaVersion,
      state: matches.length === 0 ? 'empty' as const : 'ready' as const,
      snapshot: { version, generation: 'dataset-read-v2' as const, source: 'durable-neon' as const, projectionVersion: datasetProjectionVersion },
      coverage,
      evidence: availability,
      dataset,
    };
    const projectionMs = Math.round((performance.now() - projectionStarted) * 100) / 100;
    return {
      payload,
      metrics: {
        sqlQueryCount: rows.sqlQueryCount,
        databaseMs: rows.databaseMs,
        metricReconstructionMs: Math.round(metricReconstructionMs * 100) / 100,
        projectionMs,
        serializedBytes: Buffer.byteLength(JSON.stringify(payload)),
        roundCount: rows.rounds.length,
        roundParticipantCount: rows.roundParticipants.length,
        eventCount,
      },
    };
  }
}
