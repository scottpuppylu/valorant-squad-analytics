import type { MatchImportInput } from '../contracts.js';
import { eventHmac, participantHmac, providerIdentityHmac, sourceMatchHmac } from '../identityProtection.js';
import { DURABLE_NORMALIZATION_VERSION, type DurableMatchEvidence, type EvidenceParticipant, type EvidenceRound, type EvidenceRoundParticipant, type EvidenceStatus } from './types.js';

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const asRecords = (value: unknown): Json[] => Array.isArray(value) ? value.filter(isRecord) : [];
const asText = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined;
const asNumber = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function recordsEvidence(container: Json, field: string): { status: EvidenceStatus; records: Json[] } {
  if (!(field in container)) return { status: 'missing', records: [] };
  const value = container[field];
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) return { status: 'unavailable', records: [] };
  return { status: 'observed', records: value };
}

function numericObjectEvidence(container: Json, field: string, keys: string[]): { status: EvidenceStatus; value?: Json } {
  if (!(field in container)) return { status: 'missing' };
  const value = container[field];
  if (!isRecord(value)) return { status: 'unavailable' };
  const statuses = keys.map((key) => !(key in value) ? 'missing' : asNumber(value[key]) === undefined ? 'unavailable' : 'observed');
  if (statuses.every((status) => status === 'observed')) return { status: 'observed', value };
  if (statuses.every((status) => status === 'missing')) return { status: 'missing', value };
  return { status: 'unavailable', value };
}

function refHmac(matchId: string, value: unknown, key?: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const puuid = asText(value.puuid);
  return puuid ? participantHmac(matchId, puuid, key) : undefined;
}

function objectStatus(container: Json, field: string): EvidenceStatus | 'present' | 'absent' {
  if (!(field in container)) return 'missing';
  if (container[field] === null) return 'absent';
  return isRecord(container[field]) ? 'present' : 'unavailable';
}

function asset(value: unknown): { status: EvidenceStatus; id?: string; name?: string } {
  if (value === undefined) return { status: 'missing' };
  if (!isRecord(value)) return { status: 'unavailable' };
  const id = asText(value.id);
  const name = asText(value.name);
  return id || name ? { status: 'observed', id, name } : { status: 'missing' };
}

function roundParticipant(matchId: string, value: Json, key?: string): EvidenceRoundParticipant | undefined {
  const player = isRecord(value.player) ? value.player : value;
  const puuid = asText(player.puuid);
  if (!puuid) return undefined;
  const stats = isRecord(value.stats) ? value.stats : undefined;
  const economy = isRecord(value.economy) ? value.economy : undefined;
  const loadout = asNumber(economy?.loadout_value);
  const remaining = asNumber(economy?.remaining);
  const weapon = asset(economy?.weapon);
  const armor = asset(economy?.armor);
  return {
    participantHmac: participantHmac(matchId, puuid, key),
    statsStatus: stats ? 'observed' : 'missing',
    kills: asNumber(stats?.kills), score: asNumber(stats?.score),
    loadoutStatus: loadout !== undefined || remaining !== undefined ? 'observed' : economy ? 'missing' : 'missing',
    loadoutValue: loadout, remainingCredits: remaining,
    weaponStatus: weapon.status, weaponId: weapon.id, weaponName: weapon.name,
    armorStatus: armor.status, armorId: armor.id, armorName: armor.name,
  };
}

export function normalizeHenrikEvidence(payload: unknown, input: MatchImportInput, explicitKey?: string): DurableMatchEvidence[] {
  if (!isRecord(payload)) return [];
  return asRecords(payload.data).slice(0, input.limit).flatMap((match) => {
    const metadata = isRecord(match.metadata) ? match.metadata : undefined;
    const matchId = asText(metadata?.match_id);
    if (!metadata || !matchId) return [];
    const roundEvidence = recordsEvidence(match, 'rounds');
    const killEvidence = recordsEvidence(match, 'kills');
    const participants: EvidenceParticipant[] = asRecords(match.players).flatMap((player) => {
      const puuid = asText(player.puuid);
      if (!puuid) return [];
      const stats = isRecord(player.stats) ? player.stats : undefined;
      const damage = isRecord(stats?.damage) ? stats.damage : undefined;
      const agent = isRecord(player.agent) ? player.agent : undefined;
      const ability = numericObjectEvidence(player, 'ability_casts', ['ability1', 'ability2', 'grenade', 'ultimate']);
      const economy = isRecord(player.economy) ? player.economy : undefined;
      const loadout = economy && numericObjectEvidence(economy, 'loadout_value', ['overall', 'average']);
      const spent = economy && numericObjectEvidence(economy, 'spent', ['overall', 'average']);
      const economyStatus: EvidenceStatus = !('economy' in player)
        ? 'missing'
        : !economy || loadout?.status === 'unavailable' || spent?.status === 'unavailable'
          ? 'unavailable'
          : loadout?.status === 'observed' && spent?.status === 'observed' ? 'observed' : 'missing';
      const consenting = asText(player.name)?.toLocaleLowerCase() === input.gameName.toLocaleLowerCase()
        && asText(player.tag)?.toLocaleLowerCase() === input.tag.toLocaleLowerCase();
      return [{
        lookupHmac: participantHmac(matchId, puuid, explicitKey),
        providerIdentityHmac: consenting ? providerIdentityHmac('HenrikDev', input.affinity, puuid, explicitKey) : undefined,
        teamKey: asText(player.team_id) ?? 'unknown',
        agentId: asText(agent?.id), agentName: asText(agent?.name),
        status: stats ? 'observed' as const : 'missing' as const,
        kills: asNumber(stats?.kills), deaths: asNumber(stats?.deaths), assists: asNumber(stats?.assists), score: asNumber(stats?.score),
        damageDealt: asNumber(damage?.dealt), damageReceived: asNumber(damage?.received),
        headshots: asNumber(stats?.headshots), bodyshots: asNumber(stats?.bodyshots), legshots: asNumber(stats?.legshots),
        abilityStatus: ability.status,
        ability1Casts: asNumber(ability.value?.ability1), ability2Casts: asNumber(ability.value?.ability2),
        grenadeCasts: asNumber(ability.value?.grenade), ultimateCasts: asNumber(ability.value?.ultimate),
        economyStatus,
        loadoutValueTotal: asNumber(loadout?.value?.overall), loadoutValueAverage: asNumber(loadout?.value?.average),
        spentTotal: asNumber(spent?.value?.overall), spentAverage: asNumber(spent?.value?.average),
      }];
    });
    const kills = killEvidence.records;
    const knownParticipants = new Set(participants.map((participant) => participant.lookupHmac));
    for (const kill of kills) {
      for (const value of [kill.killer, kill.victim, ...asRecords(kill.assistants), ...asRecords(kill.player_locations)]) {
        if (!isRecord(value)) continue;
        const puuid = asText(value.puuid);
        if (!puuid) continue;
        const lookupHmac = participantHmac(matchId, puuid, explicitKey);
        if (knownParticipants.has(lookupHmac)) continue;
        participants.push({ lookupHmac, teamKey: asText(value.team) ?? 'unknown', status: 'missing', abilityStatus: 'missing', economyStatus: 'missing' });
        knownParticipants.add(lookupHmac);
      }
    }
    const rounds: EvidenceRound[] = roundEvidence.records.map((round, roundIndex) => {
      const number = asNumber(round.id) ?? roundIndex;
      const plant = isRecord(round.plant) ? round.plant : undefined;
      const defuse = isRecord(round.defuse) ? round.defuse : undefined;
      const participantEvidence = recordsEvidence(round, 'stats');
      const roundKills = kills.filter((kill) => asNumber(kill.round) === number).flatMap((kill, index) => {
        const killer = refHmac(matchId, kill.killer, explicitKey);
        const victim = refHmac(matchId, kill.victim, explicitKey);
        const time = asNumber(kill.time_in_round_in_ms);
        if (!killer || !victim || time === undefined) return [];
        const weapon = asset(kill.weapon);
        const locationSource = isRecord(kill.location) ? kill.location : undefined;
        return [{
          lookupHmac: eventHmac(matchId, `${number}|${time}|${killer}|${victim}|${index}`, explicitKey), sequence: index,
          timeInRoundMs: time, timeInMatchMs: asNumber(kill.time_in_match_in_ms), killerHmac: killer, victimHmac: victim,
          assistantHmacs: asRecords(kill.assistants).flatMap((assistant) => {
            const id = asText(assistant.puuid); return id ? [participantHmac(matchId, id, explicitKey)] : [];
          }),
          weaponId: weapon.id, weaponName: weapon.name,
          location: locationSource && asNumber(locationSource.x) !== undefined && asNumber(locationSource.y) !== undefined
            ? { x: asNumber(locationSource.x)!, y: asNumber(locationSource.y)! } : undefined,
          playerLocations: asRecords(kill.player_locations).flatMap((location) => {
            const id = asText(location.puuid); const x = asNumber(location.x); const y = asNumber(location.y);
            return id && x !== undefined && y !== undefined ? [{ participantHmac: participantHmac(matchId, id, explicitKey), x, y }] : [];
          }),
        }];
      });
      return {
        number, winningTeam: asText(round.winning_team), result: asText(round.result),
        plantStatus: objectStatus(round, 'plant'), plantParticipantHmac: refHmac(matchId, plant?.player, explicitKey), plantTimeMs: asNumber(plant?.round_time_in_ms),
        defuseStatus: objectStatus(round, 'defuse'), defuseParticipantHmac: refHmac(matchId, defuse?.player, explicitKey), defuseTimeMs: asNumber(defuse?.round_time_in_ms),
        participantsStatus: participantEvidence.status,
        participants: participantEvidence.records.flatMap((item) => {
          const normalized = roundParticipant(matchId, item, explicitKey); return normalized ? [normalized] : [];
        }),
        kills: roundKills,
      };
    });
    const map = isRecord(metadata.map) ? metadata.map : undefined;
    const queue = isRecord(metadata.queue) ? metadata.queue : undefined;
    return [{
      matchLookupHmac: sourceMatchHmac('HenrikDev', matchId, explicitKey), provider: 'HenrikDev' as const,
      providerSchemaVersion: 'v4' as const, normalizationVersion: DURABLE_NORMALIZATION_VERSION, affinity: input.affinity,
      mapId: asText(map?.id), mapName: asText(map?.name), queueId: asText(queue?.id), queueName: asText(queue?.name),
      startedAt: asText(metadata.started_at), gameLengthMs: asNumber(metadata.game_length_in_ms),
      roundsStatus: roundEvidence.status, killsStatus: killEvidence.status, participants,
      teams: asRecords(match.teams).map((team) => ({ teamKey: asText(team.team_id) ?? 'unknown', won: typeof team.won === 'boolean' ? team.won : undefined, roundsWon: asNumber(isRecord(team.rounds) ? team.rounds.won : undefined), roundsLost: asNumber(isRecord(team.rounds) ? team.rounds.lost : undefined) })),
      rounds,
    }];
  });
}
