import { describe, expect, it } from 'vitest';
import { aggregateAdvancedMetrics } from '../src/analytics/advancedMetrics';
import type { AdvancedMetrics } from '../src/types/advancedMetrics';
import type { MatchPerformance } from '../src/types/valorant';
import { DURABLE_NORMALIZATION_VERSION } from '../server/evidence/types';
import { EventMetricEngine } from '../server/metrics/eventMetricEngine';
import type { EventMetricMatchInput, MetricKillInput, MetricParticipantInput, MetricRoundInput, ReconstructedAdvancedMetrics } from '../server/metrics/types';

const engine = new EventMetricEngine();

function participant(id: string, teamKey: string, overrides: Partial<MetricParticipantInput> = {}): MetricParticipantInput {
  return {
    id, teamKey, agent: 'Test Agent', kills: 2, assists: 1, damage: 300,
    abilityStatus: 'observed', ability1Casts: 0, ability2Casts: 0, grenadeCasts: 0, ultimateCasts: 0,
    economyStatus: 'observed', loadoutValueTotal: 7000, loadoutValueAverage: 3500, spentTotal: 6000, spentAverage: 3000,
    ...overrides,
  };
}

function round(id: string, number: number, participantIds: string[], overrides: Partial<MetricRoundInput> = {}): MetricRoundInput {
  return {
    id, number, winningTeam: 'Blue', participantsStatus: 'observed', participantIds,
    plantStatus: 'absent', defuseStatus: 'absent', ...overrides,
  };
}

function kill(roundId: string, sequence: number, timeInRoundMs: number, killerId: string, victimId: string, assistantIds: string[] = []): MetricKillInput {
  return { roundId, sequence, timeInRoundMs, killerId, victimId, assistantIds };
}

function match(overrides: Partial<EventMetricMatchInput> = {}): EventMetricMatchInput {
  const participants = [participant('A1', 'Blue'), participant('A2', 'Blue'), participant('A3', 'Blue'), participant('A4', 'Blue'), participant('B1', 'Red'), participant('B2', 'Red'), participant('B3', 'Red')];
  return {
    normalizationVersion: DURABLE_NORMALIZATION_VERSION,
    roundsStatus: 'observed', killsStatus: 'observed', participants,
    rounds: [round('r1', 1, participants.map((value) => value.id))], kills: [], ...overrides,
  };
}

function playerMetrics(input: EventMetricMatchInput, id: string): ReconstructedAdvancedMetrics {
  const result = engine.reconstruct(input).players.get(id);
  if (!result) throw new Error('missing player result');
  return result.metrics;
}

function publicMetrics(metrics: ReconstructedAdvancedMetrics): AdvancedMetrics {
  return {
    ruleVersion: metrics.ruleVersion,
    coverage: metrics.coverage,
    evidence: {
      trade: metrics.trade.status, clutch: metrics.clutch.status, objectives: metrics.objectives.status,
      abilityCasts: metrics.abilityCasts.status, economy: metrics.economy.status,
      impactContext: metrics.impactContext.status, roleValueInputs: metrics.roleValueInputs.status,
    },
    ...(metrics.trade.value ? { trade: metrics.trade.value } : {}),
    ...(metrics.clutch.value ? { clutch: metrics.clutch.value } : {}),
    ...(metrics.objectives.value ? { objectives: metrics.objectives.value } : {}),
    ...(metrics.abilityCasts.value ? { abilityCasts: metrics.abilityCasts.value } : {}),
    ...(metrics.economy.value ? { economy: metrics.economy.value } : {}),
    ...(metrics.impactContext.value ? { impactContext: metrics.impactContext.value } : {}),
  };
}

describe('event-metrics-v1 trade reconstruction', () => {
  it('reconstructs a basic trade and one same-team trade assist', () => {
    const metrics = playerMetrics(match({ kills: [
      kill('r1', 0, 10_000, 'B1', 'A1'),
      kill('r1', 1, 13_000, 'A2', 'B1', ['A4', 'A4']),
    ] }), 'A1');
    expect(metrics.trade.value).toMatchObject({ tradedDeaths: 1 });
    expect(playerMetrics(match({ kills: [
      kill('r1', 0, 10_000, 'B1', 'A1'), kill('r1', 1, 13_000, 'A2', 'B1', ['A4', 'A4']),
    ] }), 'A2').trade.value).toMatchObject({ tradeKills: 1, tradeKillEvents: 1 });
    expect(playerMetrics(match({ kills: [
      kill('r1', 0, 10_000, 'B1', 'A1'), kill('r1', 1, 13_000, 'A2', 'B1', ['A4', 'A4']),
    ] }), 'A4').trade.value).toMatchObject({ tradeAssists: 1 });
  });

  it('rejects a late retaliation and a kill of the wrong target', () => {
    const late = playerMetrics(match({ kills: [kill('r1', 0, 10_000, 'B1', 'A1'), kill('r1', 1, 16_001, 'A2', 'B1')] }), 'A1');
    const wrong = playerMetrics(match({ kills: [kill('r1', 0, 10_000, 'B1', 'A1'), kill('r1', 1, 13_000, 'A2', 'B2')] }), 'A1');
    expect(late.trade.value?.tradedDeaths).toBe(0);
    expect(wrong.trade.value?.tradedDeaths).toBe(0);
  });

  it('counts one physical retaliation as one trade kill while trading two deaths', () => {
    const input = match({ kills: [
      kill('r1', 0, 9_000, 'B1', 'A1'), kill('r1', 1, 10_000, 'B1', 'A2'), kill('r1', 2, 12_000, 'A3', 'B1'),
    ] });
    expect(playerMetrics(input, 'A3').trade.value?.tradeKills).toBe(1);
    expect(playerMetrics(input, 'A1').trade.value?.tradedDeaths).toBe(1);
    expect(playerMetrics(input, 'A2').trade.value?.tradedDeaths).toBe(1);
  });

  it('uses event sequence to break same-millisecond ordering ties', () => {
    const input = match({ kills: [kill('r1', 2, 10_000, 'A2', 'B1'), kill('r1', 1, 10_000, 'B1', 'A1')] });
    expect(playerMetrics(input, 'A1').trade.value?.tradedDeaths).toBe(1);
    expect(playerMetrics(input, 'A2').opening.value).toEqual({ firstKills: 0, firstDeaths: 0 });
    expect(playerMetrics(input, 'B1').opening.value).toEqual({ firstKills: 1, firstDeaths: 0 });
  });
});

describe('event-metrics-v1 round reconstruction', () => {
  it('reconstructs K, A, S, T and an unqualified round without fake missing zeros', () => {
    const ids = ['A1', 'A2', 'B1', 'B2'];
    const input = match({
      participants: [participant('A1', 'Blue'), participant('A2', 'Blue'), participant('B1', 'Red'), participant('B2', 'Red')],
      rounds: Array.from({ length: 5 }, (_value, index) => round(`r${index + 1}`, index + 1, ids)),
      kills: [
        kill('r1', 0, 1_000, 'A1', 'B1'),
        kill('r2', 0, 1_000, 'A2', 'B1', ['A1']),
        kill('r4', 0, 1_000, 'B1', 'A1'), kill('r4', 1, 4_000, 'A2', 'B1'),
        kill('r5', 0, 1_000, 'B2', 'A1'),
      ],
    });
    expect(playerMetrics(input, 'A1').kast).toMatchObject({
      status: 'reconstructed',
      value: { qualifiedRounds: 4, eligibleRounds: 5, rate: 0.8, survivedRounds: 3 },
    });
    const unavailable = playerMetrics({ ...input, killsStatus: 'missing' }, 'A1').kast;
    expect(unavailable.status).toBe('partial');
    expect(unavailable).not.toHaveProperty('value');
  });

  it('reconstructs 1v2 win, 1v3 loss, and rejects incomplete topology', () => {
    const winInput = match({
      participants: [participant('A1', 'Blue'), participant('A2', 'Blue'), participant('B1', 'Red'), participant('B2', 'Red')],
      rounds: [round('r1', 1, ['A1', 'A2', 'B1', 'B2'], { winningTeam: 'Blue' })],
      kills: [kill('r1', 0, 1_000, 'B1', 'A2')],
    });
    expect(playerMetrics(winInput, 'A1').clutch.value).toMatchObject({ clutchAttempts: 1, clutchWins: 1, attemptsByOpponents: { 2: 1 }, winsByOpponents: { 2: 1 } });

    const lossInput = match({
      participants: [participant('A1', 'Blue'), participant('A2', 'Blue'), participant('B1', 'Red'), participant('B2', 'Red'), participant('B3', 'Red')],
      rounds: [round('r1', 1, ['A1', 'A2', 'B1', 'B2', 'B3'], { winningTeam: 'Red' })],
      kills: [kill('r1', 0, 1_000, 'B1', 'A2')],
    });
    expect(playerMetrics(lossInput, 'A1').clutch.value).toMatchObject({ clutchAttempts: 1, clutchWins: 0, attemptsByOpponents: { 3: 1 } });

    const incomplete = { ...winInput, rounds: [{ ...winInput.rounds[0]!, participantsStatus: 'missing' as const }] };
    expect(playerMetrics(incomplete, 'A1').clutch).toMatchObject({ status: 'partial' });
    expect(playerMetrics(incomplete, 'A1').clutch).not.toHaveProperty('value');
  });

  it('keeps a missing winner as a partial clutch with a reconstructed attempt only', () => {
    const input = match({
      participants: [participant('A1', 'Blue'), participant('A2', 'Blue'), participant('B1', 'Red'), participant('B2', 'Red')],
      rounds: [round('r1', 1, ['A1', 'A2', 'B1', 'B2'], { winningTeam: undefined })],
      kills: [kill('r1', 0, 1_000, 'B1', 'A2')],
    });
    const clutch = playerMetrics(input, 'A1').clutch;
    expect(clutch.status).toBe('partial');
    expect(clutch.value).toMatchObject({ clutchAttempts: 1, attemptsByOpponents: { 2: 1 } });
    expect(clutch.value).not.toHaveProperty('clutchWins');
  });

  it('reconstructs objective and transparent impact context counts', () => {
    const input = match({
      participants: [participant('A1', 'Blue'), participant('A2', 'Blue'), participant('B1', 'Red'), participant('B2', 'Red')],
      rounds: [round('r1', 1, ['A1', 'A2', 'B1', 'B2'], { plantStatus: 'present', plantParticipantId: 'A1', defuseStatus: 'absent' })],
      kills: [kill('r1', 0, 1_000, 'B1', 'A2'), kill('r1', 1, 2_000, 'A1', 'B1'), kill('r1', 2, 3_000, 'A1', 'B2')],
    });
    const metrics = playerMetrics(input, 'A1');
    expect(metrics.objectives.value).toEqual({ plants: 1, defuses: 0 });
    expect(metrics.impactContext.value).toMatchObject({ tradeKills: 1, manDisadvantageKills: 1, clutchStateKills: 2, multiKillRounds: 1, twoKillRounds: 1, threePlusKillRounds: 0 });
  });

  it('keeps objective evidence independent from a missing kill collection', () => {
    const input = match({
      killsStatus: 'missing',
      rounds: [round('r1', 1, ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3'], {
        plantStatus: 'present', plantParticipantId: 'A1', defuseStatus: 'absent',
      })],
    });
    expect(playerMetrics(input, 'A1').objectives).toMatchObject({ status: 'reconstructed', value: { plants: 1, defuses: 0 } });
    expect(playerMetrics(input, 'A1').trade.status).toBe('unavailable');
  });
});

describe('direct advanced evidence and aggregation', () => {
  it('preserves observed ability zero while missing evidence stays unavailable', () => {
    expect(playerMetrics(match(), 'A1').abilityCasts).toMatchObject({ status: 'derived', value: { ability1Casts: 0, ability2Casts: 0, grenadeCasts: 0, ultimateCasts: 0 } });
    const input = match({ participants: [participant('A1', 'Blue', { abilityStatus: 'missing', ability1Casts: undefined, ability2Casts: undefined, grenadeCasts: undefined, ultimateCasts: undefined }), participant('B1', 'Red')] });
    expect(playerMetrics(input, 'A1').abilityCasts).toEqual({ status: 'unavailable' });
  });

  it('computes economy ratios at full precision and makes zero spend ratios unavailable', () => {
    const value = playerMetrics(match(), 'A1').economy.value!;
    expect(value.damagePer1000Spent).toBe(50);
    expect(value.killsPer1000Spent).toBeCloseTo(1 / 3, 12);
    const zero = match({ participants: [participant('A1', 'Blue', { spentTotal: 0 }), participant('B1', 'Red')] });
    expect(playerMetrics(zero, 'A1').economy.value?.damagePer1000SpentStatus).toBe('unavailable');
    expect(playerMetrics(zero, 'A1').economy.value).not.toHaveProperty('damagePer1000Spent');
  });

  it('recomputes aggregate economy ratios from additive totals rather than averaging match ratios', () => {
    const first = playerMetrics(match(), 'A1');
    const second = playerMetrics(match({ participants: [participant('A1', 'Blue', { damage: 100, kills: 1, spentTotal: 1000 }), participant('B1', 'Red')] }), 'A1');
    const performance = (advancedMetrics: AdvancedMetrics): MatchPerformance => ({ playerId: 'p', agent: 'A', kills: 0, deaths: 0, assists: 0, acs: 0, adr: 0, kast: 0, advancedMetrics });
    const aggregated = aggregateAdvancedMetrics([performance(publicMetrics(first)), performance(publicMetrics(second))]);
    expect(aggregated.economy.value?.damagePer1000Spent).toBeCloseTo(1000 * 400 / 7000, 12);
    expect(aggregated.economy.value?.killsPer1000Spent).toBeCloseTo(1000 * 3 / 7000, 12);
  });

  it('keeps internal trace deterministic and free of participant identifiers', () => {
    const result = engine.reconstruct(match({ kills: [kill('r1', 0, 1_000, 'B1', 'A2'), kill('r1', 1, 2_000, 'A1', 'B1')] })).players.get('A1')!;
    const trace = JSON.stringify(result.trace);
    expect(trace).toContain('eventSequence');
    expect(trace).not.toMatch(/A1|A2|B1|puuid|hmac/iu);
  });

  it('aggregates omitted measured-zero domains without manufacturing unavailable evidence', () => {
    const advancedMetrics = publicMetrics(playerMetrics(match(), 'A1'));
    delete advancedMetrics.trade;
    delete advancedMetrics.clutch;
    delete advancedMetrics.objectives;
    delete advancedMetrics.abilityCasts;
    delete advancedMetrics.impactContext;
    const performance: MatchPerformance = { playerId: 'p', agent: 'A', kills: 0, deaths: 0, assists: 0, acs: 0, adr: 0, kast: 1, advancedMetrics };
    const result = aggregateAdvancedMetrics([performance]);
    expect(result.trade).toMatchObject({ status: 'reconstructed', value: { tradeKills: 0, tradedDeaths: 0 } });
    expect(result.clutch.value).toMatchObject({ clutchAttempts: 0, clutchWins: 0 });
    expect(result.abilityCasts).toMatchObject({ status: 'derived', value: { ability1Casts: 0 } });
    expect(result.kast.value).not.toHaveProperty('survivedRounds');
  });
});
