import { describe, expect, it } from 'vitest';
import { demoMatches } from '../src/data/demoMatches';
import { buildAnalytics } from '../src/data/analytics';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import { players } from '../src/data/players';
import { calculateConfidence, calculatePlayerScores } from '../src/scoring/calculateScores';
import { normalizeRange, weightedAvailableScore } from '../src/scoring/normalize';
import type { RawPlayerStats } from '../src/types/valorant';
import { safeDivide } from '../src/utils/number';

const { playerAnalytics } = buildAnalytics(demoDataSource.snapshot());

describe('demo dataset', () => {
  it('contains 32 unique matches and eight fictional players', () => {
    expect(demoMatches).toHaveLength(32);
    expect(new Set(demoMatches.map((match) => match.id)).size).toBe(32);
    expect(players).toHaveLength(8);
    expect(new Set(players.map((player) => player.handle)).size).toBe(8);
  });

  it('gives every match five performances and every player twenty appearances', () => {
    expect(demoMatches.every((match) => match.performances.length === 5)).toBe(true);
    expect(playerAnalytics.every(({ stats }) => stats.matches === 20)).toBe(true);
  });
});

describe('normalization and safety', () => {
  it('handles division by zero with a predictable finite fallback', () => {
    expect(safeDivide(10, 0)).toBe(0);
    expect(safeDivide(10, 0, 50)).toBe(50);
  });

  it('clamps normalized values to 0–100', () => {
    expect(normalizeRange(-10, 0, 10)).toBe(0);
    expect(normalizeRange(5, 0, 10)).toBe(50);
    expect(normalizeRange(20, 0, 10)).toBe(100);
    expect(normalizeRange(5, 5, 5)).toBe(0);
  });

  it('renormalizes available weights and uses the neutral fallback when all values are missing', () => {
    expect(weightedAvailableScore([{ score: 80, weight: 0.2 }, { score: undefined, weight: 0.8 }])).toBe(80);
    expect(weightedAvailableScore([{ score: undefined, weight: 1 }])).toBe(50);
  });
});

describe('player scoring', () => {
  it('keeps every score finite and inside the defined range', () => {
    for (const { scores } of playerAnalytics) {
      for (const value of Object.values(scores)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('handles missing advanced statistics without breaking a score', () => {
    const source = playerAnalytics[0]!;
    const stats: RawPlayerStats = {
      ...source.stats,
      firstKills: undefined,
      firstDeaths: undefined,
      fkFd: undefined,
      clutchAttempts: undefined,
      clutchWins: undefined,
      headshotPercentage: undefined,
    };
    const scores = calculatePlayerScores(source.player, stats, []);
    expect(Object.values(scores).every(Number.isFinite)).toBe(true);
    expect(scores.entry).toBeGreaterThanOrEqual(0);
    expect(scores.clutch).toBe(50);
  });

  it('uses role-aware expectations for identical raw statistics', () => {
    const stats = playerAnalytics[0]!.stats;
    const duelist = players.find((player) => player.role === 'Duelist')!;
    const controller = players.find((player) => player.role === 'Controller')!;
    const duelistScore = calculatePlayerScores(duelist, { ...stats, playerId: duelist.id }, []);
    const controllerScore = calculatePlayerScores(controller, { ...stats, playerId: controller.id }, []);
    expect(controllerScore.firepower).toBeGreaterThan(duelistScore.firepower);
  });

  it('demonstrates that a higher K/D does not always mean a higher overall score', () => {
    const inversionExists = playerAnalytics.some((candidate) =>
      playerAnalytics.some((other) => candidate.stats.kd < other.stats.kd && candidate.scores.overall > other.scores.overall),
    );
    expect(inversionExists).toBe(true);
  });

  it('keeps confidence separate and monotonic with match count', () => {
    expect(calculateConfidence(0)).toBe(0);
    expect(calculateConfidence(10)).toBeLessThan(calculateConfidence(20));
    expect(calculateConfidence(30)).toBe(100);
    expect(calculateConfidence(120)).toBe(100);
  });
});
