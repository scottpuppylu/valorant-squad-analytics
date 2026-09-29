export interface HenrikV4SpikeSummary {
  matchCount: number;
  playerRows: number;
  teamRows: number;
  rounds: number;
  kills: number;
  coverage: {
    playerCombatTotals: boolean;
    playerDamageTotals: boolean;
    hitLocations: boolean;
    roundPlayerStats: boolean;
    killTimeline: boolean;
    roundEconomy: boolean;
    objectiveEvents: boolean;
    abilityCasts: boolean;
  };
}

export type HenrikJsonType = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string';

export interface HenrikFieldObservation {
  path: string;
  present: boolean;
  presentCount: number;
  absentCount: number;
  nullCount: number;
  nullFrequency: number;
  observationCount: number;
  types: HenrikJsonType[];
}

export interface HenrikCapabilitySummary {
  sampleCount: number;
  fields: HenrikFieldObservation[];
}

type JsonRecord = Record<string, unknown>;

const missing = Symbol('missing');

export const henrikV4FieldPaths = [
  'metadata.match_id',
  'metadata.map.id',
  'metadata.map.name',
  'metadata.queue.id',
  'metadata.queue.name',
  'metadata.started_at',
  'metadata.game_length_in_ms',
  'metadata.game_version',
  'metadata.platform',
  'metadata.region',
  'metadata.cluster',
  'metadata.season.id',
  'metadata.season.short',
  'metadata.is_completed',
  'players[].name',
  'players[].tag',
  'players[].puuid',
  'players[].team_id',
  'players[].agent.id',
  'players[].agent.name',
  'players[].stats.kills',
  'players[].stats.deaths',
  'players[].stats.assists',
  'players[].stats.score',
  'players[].stats.damage.dealt',
  'players[].stats.damage.received',
  'players[].stats.headshots',
  'players[].stats.bodyshots',
  'players[].stats.legshots',
  'players[].ability_casts.ability1',
  'players[].ability_casts.ability2',
  'players[].ability_casts.grenade',
  'players[].ability_casts.ultimate',
  'players[].economy.loadout_value.overall',
  'players[].economy.loadout_value.average',
  'players[].economy.spent.overall',
  'players[].economy.spent.average',
  'teams[].team_id',
  'teams[].won',
  'teams[].rounds.won',
  'teams[].rounds.lost',
  'rounds[].id',
  'rounds[].winning_team',
  'rounds[].result',
  'rounds[].plant',
  'rounds[].plant.player.puuid',
  'rounds[].plant.round_time_in_ms',
  'rounds[].defuse',
  'rounds[].defuse.player.puuid',
  'rounds[].defuse.round_time_in_ms',
  'rounds[].stats[].player.puuid',
  'rounds[].stats[].stats.kills',
  'rounds[].stats[].stats.score',
  'rounds[].stats[].economy.loadout_value',
  'rounds[].stats[].economy.remaining',
  'rounds[].stats[].economy.weapon.id',
  'rounds[].stats[].economy.weapon.name',
  'rounds[].stats[].economy.armor.id',
  'rounds[].stats[].economy.armor.name',
  'rounds[].stats[].damage_events[].damage',
  'rounds[].stats[].ability_casts.ability_1',
  'rounds[].stats[].ability_casts.ability_2',
  'rounds[].stats[].ability_casts.grenade',
  'rounds[].stats[].ability_casts.ultimate',
  'kills[].round',
  'kills[].time_in_round_in_ms',
  'kills[].time_in_match_in_ms',
  'kills[].killer.puuid',
  'kills[].victim.puuid',
  'kills[].assistants[].puuid',
  'kills[].weapon.id',
  'kills[].weapon.name',
  'kills[].location.x',
  'kills[].location.y',
  'kills[].player_locations[].player.puuid',
  'kills[].player_locations[].location.x',
  'kills[].player_locations[].location.y',
] as const;

export const henrikMmrFieldPaths = [
  'data.current.tier.id',
  'data.current.tier.name',
  'data.current.rr',
  'data.current.elo',
  'data.current.last_change',
  'data.peak.tier.id',
  'data.peak.tier.name',
  'data.peak.rr',
  'data.peak.season.id',
  'data.seasonal[].season.id',
  'data.seasonal[].season.short',
  'data.seasonal[].games',
  'data.seasonal[].wins',
  'data.seasonal[].end_tier.id',
  'data.seasonal[].end_rr',
] as const;

export const henrikMmrHistoryFieldPaths = [
  'data.history[].date',
  'data.history[].match_id',
  'data.history[].map.id',
  'data.history[].map.name',
  'data.history[].season.id',
  'data.history[].tier.id',
  'data.history[].tier.name',
  'data.history[].rr',
  'data.history[].elo',
  'data.history[].last_change',
] as const;

export const henrikStoredMatchFieldPaths = [
  'results.total',
  'results.returned',
  'results.before',
  'results.after',
  'data[].meta.id',
  'data[].meta.map.id',
  'data[].meta.map.name',
  'data[].meta.mode',
  'data[].meta.started_at',
  'data[].meta.version',
  'data[].meta.region',
  'data[].meta.cluster',
  'data[].stats.name',
  'data[].stats.tag',
  'data[].stats.puuid',
  'data[].stats.team',
  'data[].stats.character.id',
  'data[].stats.kills',
  'data[].stats.deaths',
  'data[].stats.assists',
  'data[].stats.score',
  'data[].teams.red',
  'data[].teams.blue',
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(record: JsonRecord, key: string): JsonRecord[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`HenrikDev 回應缺少有效的 ${key} 陣列。`);
  }
  return value;
}

function hasNumericFields(record: JsonRecord, fields: string[]): boolean {
  return fields.every((field) => typeof record[field] === 'number' && Number.isFinite(record[field]));
}

export function summarizeHenrikV4Matches(payload: unknown): HenrikV4SpikeSummary {
  if (!isRecord(payload) || typeof payload.status !== 'number' || !Array.isArray(payload.data)) {
    throw new Error('HenrikDev 回應不是預期的 v4 match history envelope。');
  }

  const matches = payload.data;
  if (!matches.every(isRecord)) throw new Error('HenrikDev data 必須是 match 物件陣列。');

  let playerRows = 0;
  let teamRows = 0;
  let rounds = 0;
  let kills = 0;
  let playerCombatTotals = false;
  let playerDamageTotals = false;
  let hitLocations = false;
  let roundPlayerStats = false;
  let roundEconomy = false;
  let objectiveEvents = false;
  let abilityCasts = false;

  for (const match of matches) {
    if (!isRecord(match.metadata)) throw new Error('HenrikDev match 缺少 metadata。');
    const players = recordArray(match, 'players');
    const teams = recordArray(match, 'teams');
    const matchRounds = recordArray(match, 'rounds');
    const matchKills = recordArray(match, 'kills');

    playerRows += players.length;
    teamRows += teams.length;
    rounds += matchRounds.length;
    kills += matchKills.length;

    for (const player of players) {
      if (!isRecord(player.stats)) continue;
      playerCombatTotals ||= hasNumericFields(player.stats, ['score', 'kills', 'deaths', 'assists']);
      playerDamageTotals ||= isRecord(player.stats.damage) && hasNumericFields(player.stats.damage, ['dealt', 'received']);
      hitLocations ||= hasNumericFields(player.stats, ['headshots', 'bodyshots', 'legshots']);
      abilityCasts ||= isRecord(player.ability_casts);
    }

    for (const round of matchRounds) {
      const stats = Array.isArray(round.stats) && round.stats.every(isRecord) ? round.stats : [];
      roundPlayerStats ||= stats.length > 0;
      roundEconomy ||= stats.some((row) => isRecord(row.economy) && typeof row.economy.loadout_value === 'number');
      objectiveEvents ||= isRecord(round.plant) || isRecord(round.defuse);
    }
  }

  return {
    matchCount: matches.length,
    playerRows,
    teamRows,
    rounds,
    kills,
    coverage: {
      playerCombatTotals,
      playerDamageTotals,
      hitLocations,
      roundPlayerStats,
      killTimeline: kills > 0,
      roundEconomy,
      objectiveEvents,
      abilityCasts,
    },
  };
}

function jsonType(value: unknown): HenrikJsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'object';
}

function resolvePath(roots: unknown[], path: string): Array<unknown | typeof missing> {
  return path.split('.').reduce<Array<unknown | typeof missing>>((values, token) => {
    const expandsArray = token.endsWith('[]');
    const key = expandsArray ? token.slice(0, -2) : token;
    return values.flatMap((value) => {
      if (value === missing || !isRecord(value) || !(key in value)) return [missing];
      const next = value[key];
      if (!expandsArray) return [next];
      if (!Array.isArray(next)) return [missing];
      return next;
    });
  }, roots);
}

export function summarizeHenrikFields(roots: unknown[], paths: readonly string[]): HenrikCapabilitySummary {
  const fields = paths.map((path): HenrikFieldObservation => {
    const values = resolvePath(roots, path);
    const absentCount = values.filter((value) => value === missing).length;
    const presentValues = values.filter((value) => value !== missing);
    const nullCount = presentValues.filter((value) => value === null).length;
    const types = [...new Set(presentValues.map(jsonType))].sort();
    return {
      path,
      present: presentValues.length > 0,
      presentCount: presentValues.length,
      absentCount,
      nullCount,
      nullFrequency: values.length === 0 ? 0 : nullCount / values.length,
      observationCount: values.length,
      types,
    };
  });
  return { sampleCount: roots.length, fields };
}

export function summarizeHenrikV4Fields(payload: unknown): HenrikCapabilitySummary {
  if (!isRecord(payload) || typeof payload.status !== 'number' || !Array.isArray(payload.data) || !payload.data.every(isRecord)) {
    throw new Error('HenrikDev 回應不是預期的 v4 match history envelope。');
  }
  return summarizeHenrikFields(payload.data, henrikV4FieldPaths);
}

export function summarizeHenrikV4DetailFields(payload: unknown): HenrikCapabilitySummary {
  if (!isRecord(payload) || typeof payload.status !== 'number' || !isRecord(payload.data)) {
    throw new Error('HenrikDev 回應不是預期的 v4 match detail envelope。');
  }
  return summarizeHenrikFields([payload.data], henrikV4FieldPaths);
}
