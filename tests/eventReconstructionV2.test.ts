import { describe, expect, it } from 'vitest';
import { DURABLE_NORMALIZATION_VERSION } from '../server/evidence/types';
import { EventMetricEngine } from '../server/metrics/eventMetricEngine';
import { analyzeRoundTopology } from '../server/metrics/roundTopology';
import type { EventMetricMatchInput, MetricKillInput, MetricParticipantInput, MetricRoundInput } from '../server/metrics/types';

/** TASK-ANALYTICS-EVENT-RECONSTRUCTION-ROBUSTNESS-01 — deterministic synthetic topologies (no network, no real data). */
const BLUE = ['a1', 'a2', 'a3', 'a4', 'a5'];
const RED = ['b1', 'b2', 'b3', 'b4', 'b5'];
const participants: MetricParticipantInput[] = [...BLUE.map((id) => ({ id, teamKey: 'Blue' })), ...RED.map((id) => ({ id, teamKey: 'Red' }))]
  .map((p) => ({ ...p, abilityStatus: 'missing' as const, economyStatus: 'missing' as const }));
type K = [killer: string, victim: string, timeMs: number, assistants?: string[]];
function input(rounds: { kills: K[]; winner?: 'Blue' | 'Red'; participants?: string[] }[], extra: Partial<EventMetricMatchInput> = {}): EventMetricMatchInput {
  const roundInputs: MetricRoundInput[] = rounds.map((round, index) => ({ id: `r${index}`, number: index, winningTeam: round.winner ?? 'Blue', participantsStatus: 'observed',
    participantIds: round.participants ?? [...BLUE, ...RED], plantStatus: 'absent', defuseStatus: 'absent' }));
  const kills: MetricKillInput[] = rounds.flatMap((round, index) => round.kills.map(([killerId, victimId, timeInRoundMs, assistantIds = []], sequence) => ({
    roundId: `r${index}`, sequence, timeInRoundMs, killerId, victimId, assistantIds })));
  return { normalizationVersion: DURABLE_NORMALIZATION_VERSION, roundsStatus: 'observed', killsStatus: 'observed', participants, rounds: roundInputs, kills, ...extra };
}
const UNDECIDABLE: K[] = [['b1', 'a1', 1000], ['b1', 'a2', 1500], ['b2', 'a3', 2000], ['b2', 'a4', 2500], ['a5', 'b3', 3000], ['a5', 'b4', 3500],
  ['a5', 'b5', 4000], ['a1', 'b1', 5000]];
const v1 = new EventMetricEngine({ ruleVersion: 'event-metrics-v1' });
const v2 = new EventMetricEngine({ ruleVersion: 'event-metrics-v2' });
const m = (engine: EventMetricEngine, data: EventMetricMatchInput, id: string) => engine.reconstruct(data).players.get(id)!.metrics;

const NORMAL: K[][] = [
  [['a1', 'b1', 1000], ['b2', 'a2', 3000], ['a3', 'b2', 4500, ['a4']], ['a1', 'b3', 9000], ['b4', 'a1', 12000], ['a5', 'b4', 14000], ['a5', 'b5', 20000]],
  [['b1', 'a1', 2000], ['b1', 'a2', 6000], ['a3', 'b1', 8000], ['b2', 'a3', 30000], ['b2', 'a4', 31000], ['b3', 'a5', 40000]],
];

describe('NORMAL_ROUND — v2 equals v1 on ordinary topology', () => {
  it('every metric is identical (only the rule version label differs)', () => {
    const data = input([{ kills: NORMAL[0]!, winner: 'Blue' }, { kills: NORMAL[1]!, winner: 'Red' }]);
    for (const id of [...BLUE, ...RED]) {
      const { ruleVersion: r1, ...one } = m(v1, data, id);
      const { ruleVersion: r2, ...two } = m(v2, data, id);
      expect(r1).toBe('event-metrics-v1');
      expect(r2).toBe('event-metrics-v2');
      expect(two).toEqual(one);
    }
    expect(v2.reconstruct(data).directTradeEdges).toEqual(v1.reconstruct(data).directTradeEdges);
  });
});

describe('legitimate complex events (v1 fails closed on the whole match; v2 reconstructs)', () => {
  it('SELF_KILL_ROUND: a Spike / fall / Not-Dead-Yet self kill is a death, never a kill, opening or trade', () => {
    const data = input([{ kills: [['b1', 'b1', 500], ['a1', 'b2', 2000], ['a2', 'b3', 3000]] }]);
    expect(m(v1, data, 'a1').kast.status).toBe('partial');
    const b1 = m(v2, data, 'b1');
    expect(b1.kast).toMatchObject({ status: 'reconstructed', value: { qualifiedRounds: 0, survivedRounds: 0 } });
    expect(b1.opening.value).toEqual({ firstKills: 0, firstDeaths: 0 }); // the self kill does not open the duel
    expect(m(v2, data, 'a1').opening.value).toEqual({ firstKills: 1, firstDeaths: 0 });
    expect(b1.trade.value!.deathsEligibleForTrade).toBe(0);
  });

  it('VALID_POSTHUMOUS_KILL: a kill credited to a recorded-dead player still counts as a Kill', () => {
    const data = input([{ kills: [['b1', 'a1', 1000], ['a1', 'b2', 4000], ['a2', 'b1', 5000]] }]);
    const a1 = m(v2, data, 'a1');
    expect(a1.kast).toMatchObject({ status: 'reconstructed', value: { qualifiedRounds: 1 } });
    expect(a1.opening.value).toEqual({ firstKills: 0, firstDeaths: 1 });
    expect(m(v1, data, 'a1').kast.status).toBe('partial');
  });

  it('REVIVE_THEN_SECOND_DEATH: each death is its own trade case; KAST "Traded" uses the final death', () => {
    // a1 dies (traded by a2 within 5 s), is revived, dies again untraded.
    const data = input([{ kills: [['b1', 'a1', 1000], ['a2', 'b1', 3000], ['b2', 'a1', 20000]] }]);
    const a1 = m(v2, data, 'a1');
    expect(a1.trade.value).toMatchObject({ deathsEligibleForTrade: 2, tradedDeaths: 1 });
    expect(a1.kast.value!.qualifiedRounds).toBe(0); // final death untraded, no K/A, not alive at the end
    const topology = analyzeRoundTopology(data.rounds[0]!, data.kills, new Map(participants.map((p) => [p.id, p])));
    expect(topology.issues.get('REVIVE')).toBe(1);
    expect(topology.lifeBefore[2]!.get('a1')).toBe('alive'); // proven alive immediately before the second death
    expect(topology.lifeBefore[1]!.get('a1')).toBe('unknown'); // revive moment unknown
  });

  it('REVIVE_THEN_SURVIVE: a revived player who then kills qualifies on K without inventing survival', () => {
    const data = input([{ kills: [['b1', 'a1', 1000], ['a1', 'b1', 15000]] }]);
    const a1 = m(v2, data, 'a1');
    expect(a1.kast.value!.qualifiedRounds).toBe(1);
    expect(a1.kast.value!.survivedRounds).toBe(0); // survival is never claimed for a recorded death
  });

  it('POSTHUMOUS_KILL_AFTER_DEATH: undecidable alive counts make Impact PARTIAL, never zero', () => {
    // a1 dies, then gets a kill while recorded dead: Blue alive is 1 or 2 against exactly 2 Red → undecidable.
    const data = input([{ kills: UNDECIDABLE }]);
    const a1 = m(v2, data, 'a1');
    expect(a1.kast.status).toBe('reconstructed');
    expect(a1.impactContext.status).toBe('partial');
    expect(a1.impactContext.value).toBeUndefined();
  });

  it('MULTIPLE_KILLS_ACROSS_LIFE_SEGMENTS: kills from both lives count toward multi-kill rounds', () => {
    const data = input([{ kills: [['a1', 'b1', 1000], ['b2', 'a1', 2000], ['a1', 'b2', 9000], ['b3', 'a1', 12000], ['a2', 'b3', 13000]] }]);
    const a1 = m(v2, data, 'a1');
    expect(a1.trade.value!.deathsEligibleForTrade).toBe(2);
    const impact = a1.impactContext;
    if (impact.status === 'reconstructed') expect(impact.value!.multiKillRounds).toBe(1);
    else expect(impact.value).toBeUndefined();
  });
});

describe('true ambiguity stays fail-closed', () => {
  it('TRUE_IMPOSSIBLE_EVENT_ORDER: an exact duplicate event makes the match PARTIAL in v2 too', () => {
    const data = input([{ kills: [['a1', 'b1', 1000], ['a1', 'b1', 1000]] }]);
    for (const id of ['a1', 'b1']) {
      expect(m(v2, data, id).kast.status).toBe('partial');
      expect(m(v2, data, id).trade.status).toBe('unavailable');
    }
  });
  it('MISSING_EVENT_REFERENCE: a killer outside the round participants fails closed', () => {
    const data = input([{ kills: [['ghost', 'b1', 1000]] }]);
    expect(m(v2, data, 'a1').kast.status).toBe('partial');
    expect(m(v2, data, 'a1').opening.status).toBe('partial');
  });
  it('AMBIGUOUS_REVIVE: a teammate\'s undecidable life state makes the clutch PARTIAL instead of guessing', () => {
    // a1 dies then is credited with a kill (posthumous or revived — unknown); a2 is then the last certain Blue player.
    const data = input([{ kills: [['b1', 'a1', 1000], ['b1', 'a3', 1500], ['b1', 'a4', 2000], ['b1', 'a5', 2500], ['a1', 'b2', 5000], ['a2', 'b1', 9000]] }]);
    const a2 = m(v2, data, 'a2');
    expect(a2.clutch.status).toBe('partial');
    expect(a2.clutch.value).toBeUndefined();
    expect(a2.kast.status).toBe('reconstructed'); // unrelated metrics stay usable
  });
  it('a missing kill feed is match-global and fails closed', () => {
    const data = input([{ kills: NORMAL[0]! }], { killsStatus: 'missing' });
    expect(m(v2, data, 'a1').kast.status).toBe('partial');
  });
  it('a non-final, alive-count-irrelevant metric never turns unknown into zero', () => {
    const a1 = m(v2, input([{ kills: UNDECIDABLE }]), 'a1');
    expect(a1.impactContext.value?.manDisadvantageKills).toBeUndefined();
    // …but when every interpretation agrees (≤ 3 Blue vs 5 Red), the kill IS decided as a disadvantage kill.
    const decided = m(v2, input([{ kills: [['b1', 'a1', 1000], ['b2', 'a2', 2000], ['b3', 'a3', 3000], ['a1', 'b4', 4000]] }]), 'a1');
    expect(decided.impactContext).toMatchObject({ status: 'reconstructed', value: { manDisadvantageKills: 1, clutchStateKills: 0 } });
  });
});
