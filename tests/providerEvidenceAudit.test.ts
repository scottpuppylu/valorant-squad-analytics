import { describe, expect, it } from 'vitest';
import { summarizeHenrikV4Fields } from '../src/dataSources/thirdParty/henrikV4';

function observation(summary: ReturnType<typeof summarizeHenrikV4Fields>, path: string) {
  return summary.fields.find((field) => field.path === path);
}

describe('Henrik capability summarizer', () => {
  const payload = {
    status: 200,
    data: [{
      metadata: { match_id: 'private-match-value', map: { id: 'map', name: 'Map' }, queue: { id: 'queue', name: 'Mode' } },
      players: [{
        name: 'private-player-name', tag: 'private-tag', puuid: 'private-player-identifier', team_id: 'Blue',
        agent: { id: 'agent', name: 'Agent' },
        stats: { kills: 1, deaths: 2, assists: 3, score: 400, damage: { dealt: 500, received: 300 }, headshots: 1, bodyshots: 2, legshots: 0 },
        ability_casts: { ability1: null },
      }],
      teams: [],
      rounds: [],
      kills: [],
    }],
  };

  it('records field paths, types, missingness and explicit nulls', () => {
    const summary = summarizeHenrikV4Fields(payload);
    expect(summary.sampleCount).toBe(1);
    expect(observation(summary, 'metadata.match_id')).toMatchObject({ present: true, presentCount: 1, absentCount: 0, types: ['string'] });
    expect(observation(summary, 'metadata.cluster')).toMatchObject({ present: false, presentCount: 0, absentCount: 1, nullCount: 0 });
    expect(observation(summary, 'players[].ability_casts.ability1')).toMatchObject({ present: true, nullCount: 1, nullFrequency: 1, types: ['null'] });
    expect(observation(summary, 'players[].ability_casts.ability2')).toMatchObject({ present: false, absentCount: 1 });
  });

  it('never copies provider values into the capability report', () => {
    const serialized = JSON.stringify(summarizeHenrikV4Fields(payload));
    expect(serialized).not.toContain('private-match-value');
    expect(serialized).not.toContain('private-player-name');
    expect(serialized).not.toContain('private-tag');
    expect(serialized).not.toContain('private-player-identifier');
  });
});
