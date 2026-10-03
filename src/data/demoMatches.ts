import { players } from './players';
import type { GameMode, MapName, MatchPerformance, MatchRecord } from '../types/valorant';

interface PlayerBaseline {
  killsPerRound: number;
  deathsPerRound: number;
  assistsPerRound: number;
  acs: number;
  adr: number;
  kast: number;
  headshotPercentage: number;
  firstKillRate: number;
  firstDeathRate: number;
  clutchRate: number;
  variance: number;
}

const playerBaselines: Record<string, PlayerBaseline> = {
  'nova-hex': { killsPerRound: 0.87, deathsPerRound: 0.71, assistsPerRound: 0.18, acs: 268, adr: 171, kast: 0.73, headshotPercentage: 0.28, firstKillRate: 0.18, firstDeathRate: 0.11, clutchRate: 0.26, variance: 0.12 },
  'echo-vale': { killsPerRound: 0.68, deathsPerRound: 0.62, assistsPerRound: 0.48, acs: 205, adr: 137, kast: 0.79, headshotPercentage: 0.24, firstKillRate: 0.1, firstDeathRate: 0.07, clutchRate: 0.32, variance: 0.08 },
  'moss-byte': { killsPerRound: 0.64, deathsPerRound: 0.6, assistsPerRound: 0.45, acs: 191, adr: 130, kast: 0.82, headshotPercentage: 0.22, firstKillRate: 0.07, firstDeathRate: 0.06, clutchRate: 0.36, variance: 0.07 },
  quartz: { killsPerRound: 0.7, deathsPerRound: 0.55, assistsPerRound: 0.27, acs: 199, adr: 134, kast: 0.81, headshotPercentage: 0.27, firstKillRate: 0.08, firstDeathRate: 0.05, clutchRate: 0.55, variance: 0.06 },
  'blitz-lark': { killsPerRound: 0.82, deathsPerRound: 0.78, assistsPerRound: 0.2, acs: 250, adr: 163, kast: 0.68, headshotPercentage: 0.25, firstKillRate: 0.2, firstDeathRate: 0.16, clutchRate: 0.21, variance: 0.25 },
  'anchor-mint': { killsPerRound: 0.61, deathsPerRound: 0.58, assistsPerRound: 0.42, acs: 184, adr: 126, kast: 0.8, headshotPercentage: 0.2, firstKillRate: 0.06, firstDeathRate: 0.05, clutchRate: 0.34, variance: 0.035 },
  'pulse-fern': { killsPerRound: 0.71, deathsPerRound: 0.64, assistsPerRound: 0.4, acs: 212, adr: 143, kast: 0.78, headshotPercentage: 0.26, firstKillRate: 0.11, firstDeathRate: 0.08, clutchRate: 0.3, variance: 0.09 },
  'vanta-kite': { killsPerRound: 0.72, deathsPerRound: 0.63, assistsPerRound: 0.24, acs: 216, adr: 145, kast: 0.76, headshotPercentage: 0.37, firstKillRate: 0.09, firstDeathRate: 0.07, clutchRate: 0.4, variance: 0.1 },
};

const maps: MapName[] = ['Ascent', 'Bind', 'Haven', 'Lotus', 'Pearl', 'Split', 'Sunset'];
const gameModes: GameMode[] = ['Competitive', 'Competitive', 'Competitive', 'Premier', 'Unrated', 'Custom'];
const opponents = ['Neon Orchard', 'Late Buy Club', 'Pixel Harbor', 'Five Stack', 'Moon Circuit', 'Low Gravity', 'Paper Tigers', 'Side Quest'];
const performanceWave = [-0.9, 0.35, 0.8, -0.25, 1.05, -0.55, 0.15, 0.62];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pick<T>(values: T[], index: number): T {
  return values[index % values.length] ?? values[0]!;
}

function buildPerformance(matchIndex: number, playerIndex: number, rounds: number): MatchPerformance {
  const player = players[playerIndex]!;
  const baseline = playerBaselines[player.id]!;
  const wave = pick(performanceWave, matchIndex + playerIndex * 3);
  const impact = 1 + wave * baseline.variance;
  const survivalSwing = 1 - wave * baseline.variance * 0.28;
  const firstKills = Math.max(0, Math.round(rounds * baseline.firstKillRate * impact));
  const firstDeaths = Math.max(0, Math.round(rounds * baseline.firstDeathRate * (2 - impact)));
  const clutchAttempts = 1 + ((matchIndex + playerIndex) % 3);
  const clutchWins = clamp(Math.round(clutchAttempts * baseline.clutchRate * (1 + wave * 0.25)), 0, clutchAttempts);
  const optionalSeed = matchIndex + playerIndex;

  const kills = Math.max(2, Math.round(rounds * baseline.killsPerRound * impact));
  const damage = Math.round(baseline.adr * impact * rounds);
  const spent = rounds * (2500 + optionalSeed % 5 * 150);
  const opponents = 1 + optionalSeed % 3;
  const breakdown = (count: number) => Object.fromEntries([1,2,3,4,5].map((n) => [n,n === opponents ? count : 0]));
  // Fictional aggregate evidence, not a reconstruction of real player events.
  const support = ['Initiator','Controller'].includes(player.role);
  const tradeKills = Math.min(kills, 1 + optionalSeed % 3);
  return {
    advancedMetrics: {
      ruleVersion:'event-metrics-v1', coverage:{eligibleRounds:rounds,reconstructedRounds:rounds,omittedRounds:0},
      evidence:{trade:'reconstructed',clutch:'reconstructed',objectives:'reconstructed',abilityCasts:'derived',economy:'derived',impactContext:'reconstructed',roleValueInputs:'partial'},
      trade:{tradeKills,tradeAssists:support ? 2+optionalSeed%3 : optionalSeed%2,tradedDeaths:2,deathsEligibleForTrade:rounds,tradeKillEvents:tradeKills},
      clutch:{clutchAttempts,clutchWins,attemptsByOpponents:breakdown(clutchAttempts),winsByOpponents:breakdown(clutchWins)},
      objectives:{plants:support ? 1+optionalSeed%3 : optionalSeed%2,defuses:player.role === 'Sentinel' ? optionalSeed%3 : optionalSeed%2},
      abilityCasts:{ability1Casts:rounds,ability2Casts:rounds,grenadeCasts:Math.floor(rounds/2),ultimateCasts:2},
      economy:{loadoutValueTotal:spent,loadoutValueAverage:spent/rounds,spentTotal:spent,spentAverage:spent/rounds,damage,kills,damagePer1000SpentStatus:'derived',killsPer1000SpentStatus:'derived',damagePer1000Spent:1000*damage/spent,killsPer1000Spent:1000*kills/spent},
      impactContext:{openingKills:firstKills,tradeKills,manDisadvantageKills:1+optionalSeed%3,clutchStateKills:optionalSeed%3,multiKillRounds:3+optionalSeed%3,twoKillRounds:3,threePlusKillRounds:optionalSeed%3,roundWonKills:Math.floor(kills*(.5+optionalSeed%3*.1))},
    },
    playerId: player.id,
    agent: pick(player.agents, matchIndex + playerIndex),
    kills: Math.max(2, Math.round(rounds * baseline.killsPerRound * impact)),
    deaths: Math.max(1, Math.round(rounds * baseline.deathsPerRound * survivalSwing)),
    assists: Math.max(0, Math.round(rounds * baseline.assistsPerRound * (1 + wave * baseline.variance * 0.6))),
    acs: Math.round(baseline.acs * impact),
    adr: Math.round(baseline.adr * impact * 10) / 10,
    kast: Math.round(clamp(baseline.kast + wave * baseline.variance * 0.09, 0.45, 0.96) * 1000) / 1000,
    headshotPercentage: optionalSeed % 9 === 0 ? undefined : Math.round(clamp(baseline.headshotPercentage + wave * 0.012, 0.1, 0.55) * 1000) / 1000,
    firstKills: firstKills,
    firstDeaths: firstDeaths,
    clutchAttempts: clutchAttempts,
    clutchWins: clutchWins,
  };
}

function buildMatch(index: number): MatchRecord {
  const won = index % 3 !== 1;
  const scoreFor = won ? 13 : 8 + (index % 4);
  const scoreAgainst = won ? 7 + (index % 6) : 13;
  const rounds = scoreFor + scoreAgainst;
  const playedAt = new Date(Date.UTC(2026, 6, 25 + index * 2)).toISOString();
  const lineup = Array.from({ length: 5 }, (_, offset) => (index + offset) % players.length);

  return {
    id: 'match-' + String(index + 1).padStart(2, '0'),
    playedAt,
    map: pick(maps, index * 2),
    gameMode: pick(gameModes, index),
    opponent: pick(opponents, index),
    scoreFor,
    scoreAgainst,
    won,
    durationMinutes: 31 + (index % 8) * 3,
    performances: lineup.map((playerIndex) => {
      const performance = buildPerformance(index, playerIndex, rounds);
      // Fictional match-local teams: Quartz and Moss meet as opponents, never as a public duo.
      const teamGroup = playerIndex === 3 ? 'B' as const : 'A' as const;
      const sameSide = teamGroup === 'A';
      const hasNovaEcho = lineup.includes(0) && lineup.includes(2);
      const hasBlitzPulse = lineup.includes(4) && lineup.includes(6);
      const delta = hasNovaEcho && [0,2].includes(playerIndex) ? .09 : hasBlitzPulse && [4,6].includes(playerIndex) ? -.10 : 0;
      return { ...performance, teamGroup, teamWon: sameSide ? won : !won,
        teamRoundsWon: sameSide ? scoreFor : scoreAgainst, teamRoundsLost: sameSide ? scoreAgainst : scoreFor,
        acs: performance.acs * (1 + delta), adr: performance.adr * (1 + delta),
        ...(performance.kast === undefined ? {} : { kast: clamp(performance.kast + delta * .4, 0, 1) }) };
    }),
  };
}

export const demoMatches: MatchRecord[] = Array.from({ length: 32 }, (_, index) => {
  const match = buildMatch(index);
  const visible = match.performances;
  match.synergyEvidence = {ruleVersion:'event-metrics-v1',status:'reconstructed',reconstructedRounds:match.scoreFor+match.scoreAgainst,pairs:[]};
  for (let i = 0; i < visible.length; i += 1) for (let j = i + 1; j < visible.length; j += 1) {
    const a = visible[i]!; const b = visible[j]!;
    if (a.teamGroup === b.teamGroup) match.synergyEvidence.pairs.push([i,j,(index+i)%2,(index+j)%3]);
  }
  return match;
});
