import type { NormalizedAnalyticsDataset } from '../dataSources/types';
import type { MatchPerformance, MatchRecord, Player } from '../types/valorant';
import { calculatePlayerScores } from '../scoring/calculateScores';
import { aggregatePlayerStats } from '../utils/aggregateStats';
import { agentRoles } from '../utils/agentRoles';
import { calculateSynergyIndex } from './index';
import { SYNERGY_BENCHMARK_VERSION, SYNERGY_RULE_VERSION, synergyCoverageGate, synergyPriorStrength } from './benchmarks';
import type { DuoSynergyResult, PairMember, PairWindow, SynergyFilters } from './types';
import { pairTradeEvidence } from './tradeEvidence';

export const defaultSynergyFilters: SynergyFilters = { from: '', to: '', map: 'all', gameMode: 'all', minimumShared: 0 };
export const canonicalPair = (a: string, b: string) => {
  const [playerAId, playerBId] = [a, b].sort();
  return { key: JSON.stringify([playerAId, playerBId]), playerAId: playerAId!, playerBId: playerBId! };
};
interface Appearance { match: MatchRecord; performance: MatchPerformance }
function usable(p: MatchPerformance): boolean {
  return (p.teamGroup === 'A' || p.teamGroup === 'B') && [p.kills, p.deaths, p.assists, p.acs, p.adr]
    .every((value) => Number.isFinite(value) && value >= 0)
    && (p.kast === undefined || Number.isFinite(p.kast) && p.kast >= 0 && p.kast <= 1);
}
const roundsFor = (p: MatchPerformance, m: MatchRecord) => p.teamRoundsWon !== undefined && p.teamRoundsLost !== undefined
  ? p.teamRoundsWon + p.teamRoundsLost : m.scoreFor + m.scoreAgainst;

export function selectSynergyMatches(dataset: NormalizedAnalyticsDataset, filters: SynergyFilters): MatchRecord[] {
  const seen = new Set<string>();
  return dataset.matches.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    const date = m.playedAt.slice(0, 10);
    return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)
      && (filters.map === 'all' || m.map === filters.map) && (filters.gameMode === 'all' || m.gameMode === filters.gameMode);
  });
}

function windowFor(player: Player, entries: Appearance[]): PairWindow {
  const matches = entries.map(({ match, performance: p }) => ({ ...match,
    scoreFor: p.teamRoundsWon ?? match.scoreFor, scoreAgainst: p.teamRoundsLost ?? match.scoreAgainst,
    won: p.teamWon ?? false, performances: [p] }));
  const overall = calculatePlayerScores(player, aggregatePlayerStats(player, matches), matches).overall;
  const rounds = entries.reduce((total, { match, performance: p }) => total + roundsFor(p, match), 0);
  const kastEntries = entries.filter(({ match, performance: p }) => {
    const coverage = p.advancedMetrics?.coverage;
    return p.kast !== undefined && Number.isFinite(p.kast) && (!p.eventEvidence || p.eventEvidence.kast === 'reconstructed')
      && roundsFor(p, match) > 0 && (!p.advancedMetrics || p.advancedMetrics.ruleVersion === 'event-metrics-v1'
      && coverage?.eligibleRounds === roundsFor(p, match) && coverage.reconstructedRounds === roundsFor(p, match) && coverage.omittedRounds === 0);
  });
  const kastRounds = kastEntries.reduce((total, { match, performance: p }) => total + roundsFor(p, match), 0);
  const kastValid = rounds > 0 && kastRounds / rounds >= .7;
  const outcomeEntries = entries.filter(({ performance: p }) => typeof p.teamWon === 'boolean');
  const outcomesValid = entries.length > 0 && outcomeEntries.length === entries.length;
  return { matches: entries.length, rounds, overall,
    kast: kastValid ? kastEntries.reduce((total, { match, performance: p }) => p.kast === undefined ? total : total + p.kast * roundsFor(p, match), 0) / kastRounds : undefined,
    kastStatus: !kastValid ? 'unavailable' : kastRounds === rounds ? 'available' : 'partial',
    winRate: outcomesValid ? outcomeEntries.filter((e) => e.performance.teamWon).length / entries.length : undefined,
    winRateStatus: outcomesValid ? 'available' : 'unavailable' };
}
function common<T extends string>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}
function member(player: Player, paired: Appearance[], baseline: Appearance[]): PairMember {
  const withPartner = windowFor(player, paired); const withoutPartner = windowFor(player, baseline);
  return { player, paired: withPartner, baseline: withoutPartner,
    overallLift: withPartner.overall.value !== undefined && withoutPartner.overall.value !== undefined ? withPartner.overall.value - withoutPartner.overall.value : undefined,
    kastLift: withPartner.kast !== undefined && withoutPartner.kast !== undefined ? withPartner.kast - withoutPartner.kast : undefined,
    agent: common(paired.map((entry) => entry.performance.agent)),
    role: common(paired.flatMap((entry) => agentRoles[entry.performance.agent] ? [agentRoles[entry.performance.agent]!] : [])) };
}
const combinedStatus = (...statuses: string[]) => statuses.every((s) => s === 'available') ? 'available' as const
  : statuses.some((s) => s === 'unavailable') ? 'unavailable' as const : 'partial' as const;

function pairResult(a: Player, b: Player, matches: MatchRecord[], appearances: Map<string, Appearance[]>, shared: MatchRecord[]): DuoSynergyResult {
  const pair = canonicalPair(a.id, b.id);
  const sharedIds = new Set(shared.map((m) => m.id));
  const oppositeIds = new Set(matches.filter((m) => {
    const pa = m.performances.find((p) => p.playerId === a.id); const pb = m.performances.find((p) => p.playerId === b.id);
    return pa?.teamGroup && pb?.teamGroup && pa.teamGroup !== pb.teamGroup;
  }).map((m) => m.id));
  const split = (id: string, other: string) => {
    const entries = appearances.get(id) ?? [];
    return { paired: entries.filter((e) => sharedIds.has(e.match.id)), baseline: entries.filter((e) => !sharedIds.has(e.match.id)
      && !e.match.performances.some((p) => p.playerId === other)) };
  };
  const ae = split(a.id, b.id); const be = split(b.id, a.id);
  const playerA = member(a, ae.paired, ae.baseline); const playerB = member(b, be.paired, be.baseline);
  const baselineWinRate = playerA.baseline.winRate !== undefined && playerB.baseline.winRate !== undefined
    ? (playerA.baseline.winRate + playerB.baseline.winRate) / 2 : undefined;
  const sharedWinRate = playerA.paired.winRate;
  const winRateLift = sharedWinRate !== undefined && baselineWinRate !== undefined ? sharedWinRate - baselineWinRate : undefined;
  const index = calculateSynergyIndex(shared.length, ae.baseline.length, be.baseline.length,
    { a: playerA.overallLift, b: playerB.overallLift, status: combinedStatus(playerA.paired.overall.status, playerA.baseline.overall.status, playerB.paired.overall.status, playerB.baseline.overall.status) },
    { a: playerA.kastLift, b: playerB.kastLift, status: combinedStatus(playerA.paired.kastStatus, playerA.baseline.kastStatus, playerB.paired.kastStatus, playerB.baseline.kastStatus) },
    { delta: winRateLift, status: winRateLift === undefined ? 'unavailable' : 'available' });
  let reconstructedRounds = 0; let aTradedBDeaths = 0; let bTradedADeaths = 0; let observed = 0;
  for (const match of shared) {
    const edge = pairTradeEvidence(match).find((e) => canonicalPair(e.playerAId, e.playerBId).key === pair.key);
    const pa = ae.paired.find((e) => e.match.id === match.id)!.performance;
    if (!edge || edge.ruleVersion !== 'event-metrics-v1' || edge.status !== 'reconstructed' || edge.reconstructedRounds !== roundsFor(pa, match)
      || edge.reconstructedRounds <= 0 || edge.aTradedBDeaths === undefined || edge.bTradedADeaths === undefined) continue;
    observed += 1; reconstructedRounds += edge.reconstructedRounds;
    const reverse = edge.playerAId !== a.id;
    aTradedBDeaths += reverse ? edge.bTradedADeaths : edge.aTradedBDeaths;
    bTradedADeaths += reverse ? edge.aTradedBDeaths : edge.bTradedADeaths;
  }
  const tradeEvidence = { status: observed === 0 ? 'unavailable' as const : observed === shared.length ? 'available' as const : 'partial' as const,
    reconstructedRounds, ...(observed > 0 ? { aTradedBDeaths, bTradedADeaths, directPairTrades: aTradedBDeaths + bTradedADeaths,
      rate: (aTradedBDeaths + bTradedADeaths) / reconstructedRounds } : {}) };
  return { ...index, pair, sharedSample: { matches: shared.length, rounds: playerA.paired.rounds,
    wins: sharedWinRate === undefined ? undefined : ae.paired.filter((e) => e.performance.teamWon === true).length, winRate: sharedWinRate, opponentMatches: oppositeIds.size },
    playerA, playerB, tradeEvidence, trace: { sharedMatches: shared.length, baselineA: ae.baseline.length, baselineB: be.baseline.length,
      baselineWinRate, priorStrength: synergyPriorStrength, componentWeightGate: synergyCoverageGate, index },
    ruleVersion: SYNERGY_RULE_VERSION, benchmarkVersion: SYNERGY_BENCHMARK_VERSION };
}

export function buildSynergy(dataset: NormalizedAnalyticsDataset, filters = defaultSynergyFilters): DuoSynergyResult[] {
  const matches = selectSynergyMatches(dataset, filters);
  const players = new Map(dataset.players.map((p) => [p.id, p]));
  const appearances = new Map<string, Appearance[]>();
  const pairs = new Map<string, { a: string; b: string; shared: MatchRecord[] }>();
  for (const match of matches) {
    const visible = [...new Map(match.performances.filter((p) => players.has(p.playerId) && usable(p) && roundsFor(p, match) > 0).map((p) => [p.playerId, p])).values()];
    for (const p of visible) { const entries = appearances.get(p.playerId) ?? []; entries.push({ match, performance: p }); appearances.set(p.playerId, entries); }
    for (let i = 0; i < visible.length; i += 1) for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i]!; const b = visible[j]!;
      if (a.teamGroup !== b.teamGroup) continue;
      // Contradictory same-team outcomes are unusable for a pair, never borrowed from the first row.
      if (a.teamWon !== b.teamWon || a.teamRoundsWon !== b.teamRoundsWon || a.teamRoundsLost !== b.teamRoundsLost) continue;
      const pair = canonicalPair(a.playerId, b.playerId);
      const entry = pairs.get(pair.key) ?? { a: pair.playerAId, b: pair.playerBId, shared: [] };
      entry.shared.push(match); pairs.set(pair.key, entry);
    }
  }
  const order = { available: 0, partial: 1, unavailable: 2 };
  return [...pairs.values()].filter((p) => p.shared.length >= filters.minimumShared)
    .map((p) => pairResult(players.get(p.a)!, players.get(p.b)!, matches, appearances, p.shared))
    .sort((a, b) => order[a.status] - order[b.status] || (b.value ?? 0) - (a.value ?? 0)
      || b.sharedSample.matches - a.sharedSample.matches || b.confidence - a.confidence || a.pair.key.localeCompare(b.pair.key));
}
