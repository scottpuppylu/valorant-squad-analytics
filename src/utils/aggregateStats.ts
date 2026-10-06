import type { MatchRecord, Player, RawPlayerStats, RecentPerformance } from '../types/valorant.js';
import { safeDivide } from './number.js';

interface PlayerMatchEntry {
  match: MatchRecord;
  performance: MatchRecord['performances'][number];
}

function getEntries(playerId: string, matches: MatchRecord[]): PlayerMatchEntry[] {
  return matches.flatMap((match) => {
    const performance = match.performances.find((item) => item.playerId === playerId);
    return performance ? [{ match, performance }] : [];
  });
}

function sumOptional(entries: PlayerMatchEntry[], selector: (entry: PlayerMatchEntry) => number | undefined): number | undefined {
  const values = entries.map(selector).filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
}

function weightedAverage(
  entries: PlayerMatchEntry[],
  selector: (entry: PlayerMatchEntry) => number | undefined,
  weight: (entry: PlayerMatchEntry) => number,
): number | undefined {
  const available = entries.filter((entry) => selector(entry) !== undefined);
  const totalWeight = available.reduce((total, entry) => total + weight(entry), 0);
  if (available.length === 0 || totalWeight === 0) {
    return undefined;
  }

  return available.reduce((total, entry) => total + selector(entry)! * weight(entry), 0) / totalWeight;
}

export function aggregatePlayerStats(player: Player, matches: MatchRecord[]): RawPlayerStats {
  const entries = getEntries(player.id, matches);
  const rounds = entries.reduce((total, { match }) => total + match.scoreFor + match.scoreAgainst, 0);
  const kills = entries.reduce((total, { performance }) => total + performance.kills, 0);
  const deaths = entries.reduce((total, { performance }) => total + performance.deaths, 0);
  const assists = entries.reduce((total, { performance }) => total + performance.assists, 0);
  const firstKills = sumOptional(entries, ({ performance }) => performance.firstKills);
  const firstDeaths = sumOptional(entries, ({ performance }) => performance.firstDeaths);
  const clutchAttempts = sumOptional(entries, ({ performance }) => performance.clutchAttempts);
  const clutchWins = sumOptional(entries, ({ performance }) => performance.clutchWins);
  const acs = weightedAverage(entries, ({ performance }) => performance.acs, ({ match }) => match.scoreFor + match.scoreAgainst) ?? 0;
  const adr = weightedAverage(entries, ({ performance }) => performance.adr, ({ match }) => match.scoreFor + match.scoreAgainst) ?? 0;
  const kast = weightedAverage(entries, ({ performance }) => performance.eventEvidence && performance.eventEvidence.kast !== 'reconstructed' ? undefined : performance.kast, ({ match }) => match.scoreFor + match.scoreAgainst);
  const headshotPercentage = weightedAverage(entries, ({ performance }) => performance.headshotPercentage, ({ performance }) => Math.max(performance.kills, 1));

  return {
    playerId: player.id,
    matches: entries.length,
    rounds,
    wins: entries.filter(({ match }) => match.won).length,
    kills,
    deaths,
    assists,
    acs,
    adr,
    kd: deaths > 0 ? kills / deaths : undefined,
    kpr: safeDivide(kills, rounds),
    apr: safeDivide(assists, rounds),
    kast,
    headshotPercentage,
    firstKills,
    firstDeaths,
    fkFd: firstKills === undefined || firstDeaths === undefined ? undefined : firstDeaths > 0 ? firstKills / firstDeaths : undefined,
    clutchAttempts,
    clutchWins,
  };
}

export function getRecentPerformances(playerId: string, matches: MatchRecord[], limit = 6): RecentPerformance[] {
  return getEntries(playerId, matches)
    .sort((a, b) => b.match.playedAt.localeCompare(a.match.playedAt))
    .slice(0, limit)
    .map(({ match, performance }) => ({
      matchId: match.id,
      playedAt: match.playedAt,
      map: match.map,
      opponent: match.opponent,
      agent: performance.agent,
      won: match.won,
      scoreFor: match.scoreFor,
      scoreAgainst: match.scoreAgainst,
      performance,
    }));
}
