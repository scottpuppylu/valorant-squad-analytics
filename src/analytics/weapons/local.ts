import { selectPerformances, defaultAnalysisFilters } from '../filters';
import type { PerformanceEntry } from '../types';
import type { ScopePopulation } from '../scope/types';
import type { NormalizedAnalyticsDataset } from '../../dataSources/types';
import { aggregateWeaponFacts, buildWeaponAnalytics, type EvidenceState, type WeaponAnalyticsResult, type WeaponMatchFact, type WeaponScopeMode } from './engine';

/** Semantic weapon query (the same fields the server accepts; never sample sizes). */
export interface WeaponQuery { player: string; scope: WeaponScopeMode; act?: string; map: string; agent: string; mode: string }

const hash = (value: string) => [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);

/**
 * DEMO ONLY: deterministic fictional weapon evidence derived from the fictional matches, so GitHub
 * Pages exercises weapon-analytics-v1 (including multi-account aggregation) without any API.
 * The two fictional NovaHex accounts have deliberately different habits (main Vandal, alt Operator).
 */
export function demoWeaponFacts(dataset: NormalizedAnalyticsDataset): WeaponMatchFact[] {
  const primaryAccount = new Map(dataset.players.map((player) => [player.id, player.accounts?.find((account) => account.isPrimary)?.id ?? player.accounts?.[0]?.id ?? player.id]));
  const altAccounts = new Set(dataset.players.flatMap((player) => (player.accounts ?? []).filter((account) => !account.isPrimary).map((account) => account.id)));
  return dataset.matches.flatMap((match, matchIndex) => match.performances.map((performance): WeaponMatchFact => {
    const accountId = performance.accountId ?? primaryAccount.get(performance.playerId) ?? performance.playerId;
    const won = performance.teamRoundsWon ?? match.scoreFor;
    const total = Math.max(1, won + (performance.teamRoundsLost ?? match.scoreAgainst));
    const seed = hash(`${performance.playerId}|${match.map}`);
    const sniper = altAccounts.has(accountId) || ['Jett', 'Chamber'].includes(performance.agent) ? 0.45 : seed % 5 === 0 ? 0.15 : 0.03;
    const rifle = ['Omen', 'Viper', 'Killjoy', 'Cypher', 'Sage'].includes(performance.agent) ? 'Phantom' : 'Vandal';
    const roundWeapon = (round: number): string => {
      if (round === 0 || round === 12) return seed % 2 ? 'Ghost' : 'Classic';
      if (round === 1 || round === 13) return seed % 3 ? 'Spectre' : 'Sheriff';
      const roll = (hash(`${seed}|${round}|${matchIndex}`) % 100) / 100;
      return roll < sniper ? 'Operator' : roll < sniper + 0.08 ? 'Bulldog' : rifle;
    };
    const rounds = Array.from({ length: total }, (_value, round) => {
      const weaponName = roundWeapon(round);
      const missing = (round + matchIndex) % 17 === 16;
      return {
        won: Math.floor(((round + 1) * won) / total) > Math.floor((round * won) / total),
        weaponStatus: missing ? 'missing' as const : 'observed' as const, weaponId: null, weaponName: missing ? null : weaponName,
        loadoutStatus: 'observed' as const, loadoutValue: round === 0 || round === 12 ? 800 : round === 1 || round === 13 ? 2400 : weaponName === 'Operator' ? 5700 : 3900,
        statsStatus: 'observed' as const, score: Math.round(performance.acs * (0.6 + ((hash(`${round}|${seed}`) % 80) / 100))),
      };
    });
    const kills = Array.from({ length: performance.kills }, (_value, index) => {
      if (index % 23 === 22) return { weaponId: null, weaponName: null };
      if (index % 19 === 18) return { weaponId: null, weaponName: 'Showstopper' };
      if (index % 9 === 8) return { weaponId: null, weaponName: 'Sheriff' };
      const round = rounds[(index * 7) % rounds.length]!;
      return { weaponId: null, weaponName: round.weaponName };
    });
    return { memberId: performance.playerId, accountId, matchId: match.id, map: match.map, agent: performance.agent, act: match.seasonKey ?? 'unknown', startedAt: match.playedAt, rounds, kills };
  }));
}

/** Demo/Pages local weapon analysis over fictional facts (REAL always uses the server; no fallback). */
export function localWeaponAnalytics(dataset: NormalizedAnalyticsDataset, entries: PerformanceEntry[], population: ScopePopulation, query: WeaponQuery): WeaponAnalyticsResult {
  const reasons: string[] = [];
  let facts = demoWeaponFacts(dataset).filter((fact) => {
    const match = dataset.matches.find((item) => item.id === fact.matchId);
    return (query.mode === 'all' || match?.gameMode === query.mode) && (query.map === 'all' || fact.map === query.map) && (query.agent === 'all' || fact.agent === query.agent)
      && (query.scope !== 'act' || fact.act === query.act);
  });
  if (query.scope === 'act' && facts.length === 0) reasons.push('act_not_observed');
  if (query.scope === 'current') {
    const selection = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'current', map: query.map, agent: query.agent, gameMode: query.mode }, { population });
    const allowed = new Set([...selection.byPlayer].flatMap(([playerId, list]) => list.map((entry) => `${playerId}|${entry.match.id}`)));
    facts = facts.filter((fact) => allowed.has(`${fact.memberId}|${fact.matchId}`));
    reasons.push('current_strength_adaptive_window');
  }
  const memberIds = dataset.players.map((player) => player.id).sort();
  const status: EvidenceState = facts.some((fact) => fact.rounds.length > 0) ? 'available' : 'unavailable';
  return buildWeaponAnalytics(aggregateWeaponFacts(facts), {
    memberIds, ...(query.player !== 'all' ? { memberId: query.player } : {}),
    scope: { mode: query.scope, status, reasons: [...new Set(reasons)].sort(), ...(query.act ? { act: query.act } : {}), context: { map: query.map, agent: query.agent, mode: query.mode } },
  });
}
