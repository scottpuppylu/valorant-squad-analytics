import { createHash } from 'node:crypto';
import { playerEmojiOptions, type PlayerEmoji } from '../../src/types/avatar.js';
import type { MatchPerformance, MatchRecord, Player } from '../../src/types/valorant.js';
import { primaryRoleForAgents } from '../../src/utils/agentRoles.js';
import { normalizeGameMode } from '../../src/utils/gameMode.js';
import type { DatasetEventRow, DatasetProjectionResult, DatasetReadRepository } from './types.js';
import { datasetProjectionVersion, datasetSchemaVersion, datasetWindowSize } from './types.js';

interface EventEvidence {
  roundId: string;
  sequence: number;
  time: number;
  killerId: string;
  victimId: string;
  killerTeam: string;
  assistantIds: Set<string>;
}

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

function finite(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function accentFor(publicId: string): string {
  const total = [...publicId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return accentPalette[total % accentPalette.length]!;
}

function groupEvents(rows: DatasetEventRow[]): Map<string, EventEvidence[]> {
  const byEvent = new Map<string, EventEvidence>();
  for (const row of rows) {
    const key = `${row.internal_round_id}|${row.event_sequence}`;
    const existing = byEvent.get(key) ?? {
      roundId: row.internal_round_id,
      sequence: row.event_sequence,
      time: row.time_in_round_ms,
      killerId: row.killer_participant_id,
      victimId: row.victim_participant_id,
      killerTeam: row.killer_team_key,
      assistantIds: new Set<string>(),
    };
    if (row.assistant_participant_id) existing.assistantIds.add(row.assistant_participant_id);
    byEvent.set(key, existing);
  }
  const byRound = new Map<string, EventEvidence[]>();
  for (const event of byEvent.values()) {
    const round = byRound.get(event.roundId) ?? [];
    round.push(event);
    byRound.set(event.roundId, round);
  }
  for (const events of byRound.values()) events.sort((a, b) => a.time - b.time || a.sequence - b.sequence);
  return byRound;
}

function reconstructRoundMetrics(
  participantId: string,
  teamKey: string,
  roundIds: string[],
  participantRoundPresence: Set<string>,
  eventsByRound: Map<string, EventEvidence[]>,
): Pick<MatchPerformance, 'kast' | 'firstKills' | 'firstDeaths'> | null {
  if (roundIds.length === 0 || !roundIds.every((roundId) => participantRoundPresence.has(`${roundId}|${participantId}`))) return null;
  let kastRounds = 0;
  let firstKills = 0;
  let firstDeaths = 0;
  for (const roundId of roundIds) {
    const events = eventsByRound.get(roundId) ?? [];
    const opening = events[0];
    if (opening?.killerId === participantId) firstKills += 1;
    if (opening?.victimId === participantId) firstDeaths += 1;
    const madeKill = events.some((event) => event.killerId === participantId);
    const assisted = events.some((event) => event.assistantIds.has(participantId));
    const death = events.find((event) => event.victimId === participantId);
    const survived = death === undefined;
    const traded = death ? events.some((event) => (
      event.killerTeam === teamKey
      && event.victimId === death.killerId
      && event.time >= death.time
      && event.time - death.time <= 5_000
    )) : false;
    if (madeKill || assisted || survived || traded) kastRounds += 1;
  }
  return { kast: kastRounds / roundIds.length, firstKills, firstDeaths };
}

export class DatasetProjectionService {
  constructor(private readonly repository: DatasetReadRepository) {}

  async read(): Promise<DatasetProjectionResult> {
    const rows = await this.repository.readProjectionRows(datasetWindowSize);
    const projectionStarted = performance.now();
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
    const roundIdsByMatch = new Map<string, string[]>();
    for (const row of rows.rounds) {
      const list = roundIdsByMatch.get(row.internal_match_id) ?? [];
      list.push(row.internal_round_id);
      roundIdsByMatch.set(row.internal_match_id, list);
    }
    const participantRoundPresence = new Set(rows.roundParticipants.map((row) => `${row.internal_round_id}|${row.internal_participant_id}`));
    const eventsByRound = groupEvents(rows.events);
    const grouped = new Map<string, typeof rows.performances>();
    for (const row of rows.performances) {
      const list = grouped.get(row.internal_match_id) ?? [];
      list.push(row);
      grouped.set(row.internal_match_id, list);
    }
    let completeRoundEvidence = true;
    let completeHeadshotEvidence = true;
    const matches: MatchRecord[] = [];
    for (const performanceRows of grouped.values()) {
      const first = performanceRows[0];
      if (!first) continue;
      const playedAt = dateValue(first.started_at);
      if (!playedAt) continue;
      const roundIds = roundIdsByMatch.get(first.internal_match_id) ?? [];
      const performances = performanceRows.flatMap((row): MatchPerformance[] => {
        const player = playerRowByInternalId.get(row.internal_player_id);
        const observedRounds = roundIds.length;
        const roundMetrics = observedRounds > 0
          ? reconstructRoundMetrics(row.internal_participant_id, row.team_key, roundIds, participantRoundPresence, eventsByRound)
          : null;
        if (!roundMetrics) completeRoundEvidence = false;
        if (!player || row.stats_evidence_status !== 'observed' || !row.agent_name
          || !finite(row.kills) || !finite(row.deaths) || !finite(row.assists)
          || !finite(row.score) || !finite(row.damage_dealt) || !roundMetrics) return [];
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
          kast: roundMetrics.kast,
          ...(headshotPercentage === undefined ? {} : { headshotPercentage }),
          firstKills: roundMetrics.firstKills,
          firstDeaths: roundMetrics.firstDeaths,
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
    const dataset = { players, matches, sourceId: 'durable-neon-v1', isDemo: false as const, mode: 'REAL' as const };
    const evidence = {
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
    const version = createHash('sha256').update(JSON.stringify({ dataset, coverage, evidence })).digest('base64url').slice(0, 24);
    const payload = {
      ok: true as const,
      schemaVersion: datasetSchemaVersion,
      state: matches.length === 0 ? 'empty' as const : 'ready' as const,
      snapshot: { version, generation: 'dataset-read-v1' as const, source: 'durable-neon' as const, projectionVersion: datasetProjectionVersion },
      coverage,
      evidence,
      dataset,
    };
    const projectionMs = Math.round((performance.now() - projectionStarted) * 100) / 100;
    return {
      payload,
      metrics: {
        sqlQueryCount: rows.sqlQueryCount,
        databaseMs: rows.databaseMs,
        projectionMs,
        serializedBytes: Buffer.byteLength(JSON.stringify(payload)),
      },
    };
  }
}
