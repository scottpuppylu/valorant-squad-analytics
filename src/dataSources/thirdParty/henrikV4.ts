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

type JsonRecord = Record<string, unknown>;

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
