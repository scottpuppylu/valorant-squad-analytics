import { createHash } from 'node:crypto';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types.js';
import type { AgentName, GameMode, MatchPerformance, MatchRecord, Player, PlayerRole } from '../src/types/valorant.js';
import type { MatchImportInput } from './contracts.js';
import { PublicApiError } from './errors.js';

type JsonRecord = Record<string, unknown>;

const agentRoles: Record<string, PlayerRole> = {
  Jett: 'Duelist', Raze: 'Duelist', Phoenix: 'Duelist', Reyna: 'Duelist', Yoru: 'Duelist', Neon: 'Duelist', Iso: 'Duelist', Waylay: 'Duelist',
  Sova: 'Initiator', Breach: 'Initiator', Skye: 'Initiator', 'KAY/O': 'Initiator', Fade: 'Initiator', Gekko: 'Initiator', Tejo: 'Initiator',
  Omen: 'Controller', Brimstone: 'Controller', Viper: 'Controller', Astra: 'Controller', Harbor: 'Controller', Clove: 'Controller',
  Sage: 'Sentinel', Cypher: 'Sentinel', Killjoy: 'Sentinel', Chamber: 'Sentinel', Deadlock: 'Sentinel', Vyse: 'Sentinel', Veto: 'Sentinel',
};

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) malformed(label);
  return value as JsonRecord;
}

function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value)) malformed(label);
  return value.map((item) => record(item, label));
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) malformed(label);
  return value as string;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) malformed(label);
  return value as number;
}

function malformed(label: string): never {
  throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', `資料服務回應缺少可用的${label}。`);
}

function sameIdentity(player: JsonRecord, input: MatchImportInput): boolean {
  return typeof player.name === 'string' && typeof player.tag === 'string'
    && player.name.localeCompare(input.gameName, undefined, { sensitivity: 'accent' }) === 0
    && player.tag.localeCompare(input.tag, undefined, { sensitivity: 'accent' }) === 0;
}

function playerRef(value: unknown): { puuid: string; team: string } {
  const item = record(value, '事件玩家');
  return { puuid: textValue(item.puuid, '事件玩家識別'), team: textValue(item.team, '事件隊伍') };
}

function opaqueId(value: string): string {
  return `real-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function queueMode(metadata: JsonRecord): GameMode {
  const queue = record(metadata.queue, '對戰模式');
  const label = typeof queue.name === 'string' && queue.name ? queue.name : textValue(queue.id, '對戰模式');
  const normalized = label.toLowerCase();
  if (normalized.includes('competitive')) return 'Competitive';
  if (normalized.includes('premier')) return 'Premier';
  if (normalized.includes('unrated')) return 'Unrated';
  if (normalized.includes('custom')) return 'Custom';
  return label as GameMode;
}

function deriveRoundEvidence(match: JsonRecord, targetPuuid: string, targetTeam: string) {
  const rounds = records(match.rounds, '回合');
  const kills = records(match.kills, '擊殺事件');
  let firstKills = 0;
  let firstDeaths = 0;
  let kastRounds = 0;

  for (const round of rounds) {
    const roundId = numberValue(round.id, '回合編號');
    const events = kills
      .filter((kill) => kill.round === roundId)
      .sort((a, b) => numberValue(a.time_in_round_in_ms, '擊殺時間') - numberValue(b.time_in_round_in_ms, '擊殺時間'));
    const opening = events[0];
    if (opening) {
      if (playerRef(opening.killer).puuid === targetPuuid) firstKills += 1;
      if (playerRef(opening.victim).puuid === targetPuuid) firstDeaths += 1;
    }

    const madeKill = events.some((kill) => playerRef(kill.killer).puuid === targetPuuid);
    const assisted = events.some((kill) => records(kill.assistants, '助攻者').some((assistant) => textValue(assistant.puuid, '助攻者識別') === targetPuuid));
    const death = events.find((kill) => playerRef(kill.victim).puuid === targetPuuid);
    const survived = death === undefined;
    let traded = false;
    if (death) {
      const killer = playerRef(death.killer).puuid;
      const deathAt = numberValue(death.time_in_round_in_ms, '死亡時間');
      traded = events.some((kill) => {
        const tradeAt = numberValue(kill.time_in_round_in_ms, '交換時間');
        const tradeKiller = playerRef(kill.killer);
        return tradeKiller.team === targetTeam
          && playerRef(kill.victim).puuid === killer
          && tradeAt >= deathAt
          && tradeAt - deathAt <= 5_000;
      });
    }
    if (madeKill || assisted || survived || traded) kastRounds += 1;
  }

  return {
    rounds: rounds.length,
    firstKills,
    firstDeaths,
    kast: rounds.length === 0 ? 0 : kastRounds / rounds.length,
  };
}

function normalizeMatch(match: JsonRecord, input: MatchImportInput, playerId: string): { match: MatchRecord; agent: AgentName } {
  const metadata = record(match.metadata, '對戰中繼資料');
  const players = records(match.players, '玩家');
  const target = players.find((player) => sameIdentity(player, input));
  if (!target) malformed('目標玩家');
  const targetPuuid = textValue(target.puuid, '玩家識別');
  const targetTeam = textValue(target.team_id, '玩家隊伍');
  const teams = records(match.teams, '隊伍');
  const team = teams.find((candidate) => candidate.team_id === targetTeam);
  if (!team) malformed('玩家隊伍');
  const teamRounds = record(team.rounds, '隊伍回合');
  const scoreFor = numberValue(teamRounds.won, '勝方回合');
  const scoreAgainst = numberValue(teamRounds.lost, '敗方回合');
  const rounds = Math.max(scoreFor + scoreAgainst, 1);
  const stats = record(target.stats, '玩家統計');
  const damage = record(stats.damage, '傷害統計');
  const agent = textValue(record(target.agent, '特務').name, '特務名稱') as AgentName;
  const hits = numberValue(stats.headshots, '爆頭命中') + numberValue(stats.bodyshots, '身體命中') + numberValue(stats.legshots, '腿部命中');
  const evidence = deriveRoundEvidence(match, targetPuuid, targetTeam);
  const performance: MatchPerformance = {
    playerId,
    agent,
    kills: numberValue(stats.kills, '擊殺'),
    deaths: numberValue(stats.deaths, '死亡'),
    assists: numberValue(stats.assists, '助攻'),
    acs: numberValue(stats.score, '戰鬥分數') / rounds,
    adr: numberValue(damage.dealt, '輸出傷害') / rounds,
    kast: evidence.kast,
    headshotPercentage: hits === 0 ? 0 : numberValue(stats.headshots, '爆頭命中') / hits,
    firstKills: evidence.firstKills,
    firstDeaths: evidence.firstDeaths,
  };
  const map = textValue(record(metadata.map, '地圖').name, '地圖名稱');
  const startedAt = textValue(metadata.started_at, '開始時間');
  const durationMs = numberValue(metadata.game_length_in_ms, '對戰時間');
  const rawMatchId = textValue(metadata.match_id, '對戰識別');
  return {
    agent,
    match: {
      id: opaqueId(rawMatchId),
      playedAt: new Date(startedAt).toISOString(),
      map,
      gameMode: queueMode(metadata),
      opponent: '對手隊伍',
      scoreFor,
      scoreAgainst,
      won: team.won === true,
      durationMinutes: Math.max(1, Math.round(durationMs / 60_000)),
      performances: [performance],
    },
  };
}

function primaryRole(agents: AgentName[]): PlayerRole {
  const counts = new Map<PlayerRole, number>();
  for (const agent of agents) {
    const role = agentRoles[agent];
    if (role) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  const winner = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (!winner) malformed('特務角色對應');
  return winner;
}

export function normalizeHenrikMatches(payload: unknown, input: MatchImportInput): NormalizedAnalyticsDataset {
  const envelope = record(payload, '回應');
  numberValue(envelope.status, '回應狀態');
  const matches = records(envelope.data, '對戰資料');
  if (matches.length === 0) {
    throw new PublicApiError(404, 'NO_MATCHES', '找不到可匯入的近期戰績。');
  }
  const playerId = opaqueId(`${input.gameName.toLowerCase()}#${input.tag.toLowerCase()}`);
  const normalized = matches.slice(0, input.limit).map((match) => normalizeMatch(match, input, playerId));
  const agents = [...new Set(normalized.map((item) => item.agent))];
  const player: Player = {
    id: playerId,
    handle: `${input.gameName}#${input.tag}`,
    displayName: input.gameName,
    role: primaryRole(agents),
    agents,
    accent: '#6ee7b7',
    tagline: '已連接真實戰績',
    playstyle: '依最近匯入的公開戰績產生；進階欄位仍受資料證據限制。',
    defaultEmoji: '🤖',
  };
  return {
    players: [player],
    matches: normalized.map((item) => item.match),
    sourceId: 'henrik-production-v1',
    isDemo: false,
    mode: 'REAL',
  };
}
