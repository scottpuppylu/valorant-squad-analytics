import type { MatchImportInput } from '../contracts.js';
import type { DatasetEventRow, DatasetPerformanceRow, DatasetPlayerRow, DatasetRoundParticipantRow, DatasetRoundRow } from '../dataset/types.js';
import { assembleMatch, reconstructMatchFacts, type MatchTopology, type ParticipantFact } from '../dataset/matchAssembly.js';
import { normalizeHenrikEvidence } from '../evidence/normalizeHenrikEvidence.js';
import type { DurableMatchEvidence } from '../evidence/types.js';
import { participantHmac, providerIdentityHmac } from '../identityProtection.js';
import { EventMetricEngine } from '../metrics/eventMetricEngine.js';
import type { MatchRecord } from '../../src/types/valorant.js';

/**
 * TASK-SCORING-SHARED-MATCH-01 — the PRIVATE staging → public `MatchRecord` projection, reusing every line of the
 * canonical per-match logic:
 *   raw v4 document → normalizeHenrikEvidence (durable-evidence-v2, private rebuild key)
 *   → the exact rows upsertMatch would store and the four detail SELECTs would read (in memory)
 *   → reconstructMatchFacts (event-metrics-v1 by default: shared-match-evidence-v1 is FROZEN on the engine it was
 *     accepted with, independent of the canonical engine; pass an engine explicitly for research) → assembleMatch.
 * No consent table, no canonical database, no provider call. Only tracked members get performance rows (like the
 * canonical projection, which joins only visible accounts); every match participant still feeds the engine.
 */
/** shared-match-evidence-v1 / shared-match-rating-v1 were accepted on event-metrics-v1; pinned, never the canonical default. */
export const SHARED_MATCH_EVIDENCE_EVENT_ENGINE = 'event-metrics-v1' as const;

export interface StagingMember { accountPublicId: string; memberPublicId: string; communityName: string; affinity: string; providerPuuid: string }

/** In-memory equivalent of upsertMatch + performanceSelect / roundSelect / roundParticipantSelect / eventSelect. */
export function evidenceTopology(evidence: DurableMatchEvidence, matchRef: string, tracked: ReadonlyMap<string, string>): MatchTopology {
  const participantIds = new Set(evidence.participants.map((participant) => participant.lookupHmac));
  const teamOf = new Map(evidence.participants.map((participant) => [participant.lookupHmac, participant.teamKey]));
  const teamRows = new Map(evidence.teams.map((team) => [team.teamKey, team]));
  const performances: DatasetPerformanceRow[] = evidence.participants.flatMap((participant) => {
    const accountId = tracked.get(participant.lookupHmac);
    if (!accountId) return [];
    const team = teamRows.get(participant.teamKey);
    return [{
      internal_match_id: matchRef, public_match_id: matchRef, started_at: evidence.startedAt ?? null, map_name: evidence.mapName ?? null,
      queue_id: evidence.queueId ?? null, queue_name: evidence.queueName ?? null, game_length_ms: evidence.gameLengthMs ?? null,
      season_short: evidence.seasonShort ?? null,
      internal_participant_id: participant.lookupHmac, internal_player_id: accountId, team_key: participant.teamKey,
      agent_name: participant.agentName ?? null, stats_evidence_status: participant.status,
      kills: participant.kills ?? null, deaths: participant.deaths ?? null, assists: participant.assists ?? null, score: participant.score ?? null,
      damage_dealt: participant.damageDealt ?? null, headshots: participant.headshots ?? null, bodyshots: participant.bodyshots ?? null,
      legshots: participant.legshots ?? null, normalization_version: evidence.normalizationVersion,
      rounds_evidence_status: evidence.roundsStatus, kills_evidence_status: evidence.killsStatus,
      ability_evidence_status: participant.abilityStatus, ability_1_casts: participant.ability1Casts ?? null,
      ability_2_casts: participant.ability2Casts ?? null, grenade_casts: participant.grenadeCasts ?? null, ultimate_casts: participant.ultimateCasts ?? null,
      economy_evidence_status: participant.economyStatus, loadout_value_total: participant.loadoutValueTotal ?? null,
      loadout_value_average: participant.loadoutValueAverage ?? null, spent_total: participant.spentTotal ?? null, spent_average: participant.spentAverage ?? null,
      team_won: team?.won ?? null, rounds_won: team?.roundsWon ?? null, rounds_lost: team?.roundsLost ?? null,
    }];
  });
  const roundId = (number: number) => `${matchRef}:r${number}`;
  const rounds: DatasetRoundRow[] = [...evidence.rounds].sort((a, b) => a.number - b.number).map((round) => ({
    internal_match_id: matchRef, internal_round_id: roundId(round.number), round_number: round.number,
    winning_team: round.winningTeam ?? null, participants_evidence_status: round.participantsStatus,
    plant_status: round.plantStatus, plant_participant_id: round.plantParticipantHmac && participantIds.has(round.plantParticipantHmac) ? round.plantParticipantHmac : null,
    defuse_status: round.defuseStatus, defuse_participant_id: round.defuseParticipantHmac && participantIds.has(round.defuseParticipantHmac) ? round.defuseParticipantHmac : null,
  }));
  const roundParticipants: DatasetRoundParticipantRow[] = evidence.rounds.flatMap((round) => round.participants
    .filter((item) => participantIds.has(item.participantHmac))
    .map((item) => ({ internal_round_id: roundId(round.number), internal_participant_id: item.participantHmac, team_key: teamOf.get(item.participantHmac)!, present: true })));
  const events: DatasetEventRow[] = evidence.rounds.flatMap((round) => round.kills
    .filter((kill) => participantIds.has(kill.killerHmac) && participantIds.has(kill.victimHmac))
    .flatMap((kill): DatasetEventRow[] => {
      const base = { internal_match_id: matchRef, internal_round_id: roundId(round.number), event_sequence: kill.sequence, time_in_round_ms: kill.timeInRoundMs,
        killer_participant_id: kill.killerHmac, victim_participant_id: kill.victimHmac, killer_team_key: teamOf.get(kill.killerHmac)! };
      const assistants = [...new Set(kill.assistantHmacs)].filter((id) => participantIds.has(id));
      return assistants.length === 0 ? [{ ...base, assistant_participant_id: null }] : assistants.map((id) => ({ ...base, assistant_participant_id: id }));
    }))
    .sort((a, b) => (a.internal_round_id < b.internal_round_id ? -1 : a.internal_round_id > b.internal_round_id ? 1 : a.time_in_round_ms - b.time_in_round_ms || a.event_sequence - b.event_sequence));
  return { performances, rounds, roundParticipants, events };
}

export interface ProjectedMatch {
  matchRef: string; match: MatchRecord; accountByMember: Map<string, string>; identityConflict: boolean;
  /** The per-participant analysis facts (exactly what analysis_participant_facts would store); private keys. */
  facts?: Map<string, ParticipantFact>;
}

/** One staged v4 document → the canonical public MatchRecord of the tracked members in it (or undefined). */
export function projectStagedMatch(document: unknown, matchRef: string, members: readonly StagingMember[], hmacKey: string,
  engine: EventMetricEngine = new EventMetricEngine({ ruleVersion: SHARED_MATCH_EVIDENCE_EVENT_ENGINE })): ProjectedMatch | undefined {
  const metadata = (document as { metadata?: { match_id?: unknown } })?.metadata;
  const matchId = typeof metadata?.match_id === 'string' ? metadata.match_id : undefined;
  if (!matchId) return undefined;
  const players = Array.isArray((document as { players?: unknown }).players) ? (document as { players: { puuid?: unknown }[] }).players : [];
  const present = members.filter((member) => players.some((player) => player.puuid === member.providerPuuid));
  if (present.length === 0) return undefined;
  const anchor = present[0]!;
  // normalizeHenrikEvidence reads only `affinity` and `limit` from its input (identity = expected provider HMAC).
  const input = { affinity: anchor.affinity, limit: 1 } as unknown as MatchImportInput;
  const [evidence] = normalizeHenrikEvidence({ data: [document] }, input, hmacKey,
    providerIdentityHmac('HenrikDev', anchor.affinity, anchor.providerPuuid, hmacKey));
  if (!evidence) return undefined;
  const tracked = new Map(present.map((member) => [participantHmac(matchId, member.providerPuuid, hmacKey), member.accountPublicId]));
  const topology = evidenceTopology(evidence, matchRef, tracked);
  const { facts } = reconstructMatchFacts(engine, topology);
  const playerRows = new Map<string, DatasetPlayerRow>(present.map((member) => [member.accountPublicId, {
    internal_player_id: member.accountPublicId, public_id: member.accountPublicId, display_name: member.communityName, display_tag: '',
    default_emoji: '', is_primary_account: true, account_label: null, internal_member_id: member.memberPublicId,
    member_public_id: member.memberPublicId, member_display_name: member.communityName, member_name_source: 'community', member_default_emoji: '',
  }]));
  const accountsPerMember = new Map<string, number>();
  for (const member of members) accountsPerMember.set(member.memberPublicId, (accountsPerMember.get(member.memberPublicId) ?? 0) + 1);
  const result = assembleMatch({ playerRowByInternalId: playerRows, accountsPerMember }, topology.performances, facts);
  if (result.kind === 'identity_conflict') return { matchRef, match: undefined as unknown as MatchRecord, accountByMember: new Map(), identityConflict: true };
  if (result.kind !== 'assembled' || !result.match) return undefined;
  return { matchRef, match: result.match, accountByMember: new Map(present.map((member) => [member.memberPublicId, member.accountPublicId])), identityConflict: false, facts };
}
