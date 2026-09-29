import { describe, expect, it } from 'vitest';
import { summarizeHenrikV4Matches } from '../src/dataSources/thirdParty/henrikV4';

const providerShapedMatch = {
  status: 200,
  data: [{
    metadata: { match_id: 'redacted', map: { id: 'map', name: 'Ascent' } },
    players: [{
      stats: {
        score: 4200,
        kills: 18,
        deaths: 14,
        assists: 7,
        headshots: 11,
        bodyshots: 42,
        legshots: 3,
        damage: { dealt: 3450, received: 2800 },
      },
      ability_casts: { ability1: 8, ability2: 5, grenade: 6, ultimate: 2 },
    }],
    teams: [{ team_id: 'Blue', rounds: { won: 13, lost: 9 }, won: true }],
    rounds: [{
      id: 1,
      result: 'Eliminated',
      winning_team: 'Blue',
      plant: { round_time_in_ms: 42000 },
      defuse: null,
      stats: [{
        player: { puuid: 'redacted' },
        stats: { score: 280, kills: 1, headshots: 1, bodyshots: 2, legshots: 0 },
        economy: { loadout_value: 3900, remaining: 100 },
      }],
    }],
    kills: [{ round: 1, time_in_round_in_ms: 31000 }],
  }],
};

describe('HenrikDev v4 spike boundary', () => {
  it('summarizes analytics evidence without retaining player identifiers', () => {
    expect(summarizeHenrikV4Matches(providerShapedMatch)).toEqual({
      matchCount: 1,
      playerRows: 1,
      teamRows: 1,
      rounds: 1,
      kills: 1,
      coverage: {
        playerCombatTotals: true,
        playerDamageTotals: true,
        hitLocations: true,
        roundPlayerStats: true,
        killTimeline: true,
        roundEconomy: true,
        objectiveEvents: true,
        abilityCasts: true,
      },
    });
  });

  it('rejects malformed envelopes and match structures', () => {
    expect(() => summarizeHenrikV4Matches({ data: [] })).toThrow('envelope');
    expect(() => summarizeHenrikV4Matches({ status: 200, data: [{}] })).toThrow('metadata');
  });
});
