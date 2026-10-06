import { describe, expect, it } from 'vitest';
import { assertProviderAuditAllowed } from '../server/providerAuditAccess';
import { HenrikDataProvider } from '../server/henrikDataProvider';
import { inspectShape, PROVIDER_SHAPE_INSPECTOR_VERSION } from '../server/evidence/shapeInspector';

/** Fictional v4-like payload carrying identifiers that must never be echoed. */
function payload(withPerformanceScore: boolean[]) {
  return {
    status: 200,
    data: [{
      metadata: { match_id: 'aaaaaaaa-1111-4222-8333-444444444444', started_at: '2026-10-05T12:34:56.000Z', map: { name: 'Ascent' } },
      players: withPerformanceScore.map((has, index) => ({
        puuid: `puuid-secret-${index}`, name: `HiddenName${index}`, tag: `TAG${index}`,
        stats: { score: 4000 + index * 100, kills: 20 + index, ...(has ? { performance_score: 300 + index * 50 } : {}) },
      })),
      kills: [{ location: { x: 1234, y: -5678 }, killer: { puuid: 'puuid-secret-0' } }],
      // A dynamic id-keyed map, as some provider objects use.
      by_player: { 'bbbbbbbb-1111-4222-8333-444444444444': { rating: 1.2 }, 'HiddenName0#TAG0': { rating: 0.9 } },
      api_key: 'HDEV-not-a-real-secret-value',
    }],
  };
}

describe('provider-shape-inspector-v1', () => {
  it('discovers a newly added unknown score-like field with presence counts and an unassociated range', () => {
    const shape = inspectShape([payload([true, true, false, true])]);
    expect(shape.inspectorVersion).toBe(PROVIDER_SHAPE_INSPECTOR_VERSION);
    const ps = shape.paths.find((p) => p.path === 'data[].players[].stats.performance_score')!;
    expect(ps).toMatchObject({ present: 3, absent: 1, nullCount: 0, candidate: true, types: { number: 3 }, numeric: { count: 3, min: 300, max: 450, integers: true } });
    const score = shape.candidates.find((p) => p.path === 'data[].players[].stats.score')!;
    expect(score.numeric).toEqual({ count: 4, min: 4000, max: 4300, integers: true });
    // Non-candidate numbers never get aggregates.
    expect(shape.paths.find((p) => p.path === 'data[].players[].stats.kills')!.numeric).toBeUndefined();
    expect(shape.paths.find((p) => p.path === 'data[].kills[].location.x')!.numeric).toBeUndefined();
  });

  it('never outputs values, names, tags, PUUIDs, match ids, coordinates, timestamps or secrets', () => {
    const text = JSON.stringify(inspectShape([payload([true, false, true])]));
    for (const forbidden of ['HiddenName', 'TAG0', 'puuid-secret', 'aaaaaaaa-1111', 'bbbbbbbb-1111', '2026-10-05', '1234', '-5678', 'HDEV-', 'Ascent', '#']) {
      expect(text).not.toContain(forbidden);
    }
    // Dynamic keys collapse; their candidate children are still discoverable without the key.
    expect(text).toContain('data[].by_player.{key}.rating');
  });

  it('withholds numeric aggregates below the minimum sample and collapses arrays', () => {
    const shape = inspectShape([payload([true, false])]);
    const ps = shape.paths.find((p) => p.path === 'data[].players[].stats.performance_score')!;
    expect(ps).toMatchObject({ present: 1, absent: 1 });
    expect(ps.numeric).toBeUndefined();
    expect(shape.paths.every((p) => !/\[\d+\]/u.test(p.path))).toBe(true);
  });
});

describe('performance-score audit mode (provider boundary unchanged)', () => {
  it('uses at most 2 logical provider requests and returns shape only', async () => {
    const urls: string[] = [];
    const provider = new HenrikDataProvider('fictional-test-credential', {
      retries: 0,
      fetchImpl: async (url) => {
        urls.push(String(url));
        const body = String(url).includes('/v4/match/') ? { status: 200, data: payload([true, true, true]).data[0] } : payload([true, true, true]);
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const audit = await provider.auditPerformanceScoreShape({ gameName: 'Fictional', tag: 'TW', affinity: 'ap', consent: true, privacyVersion: 'x', playerId: 'cccccccc-1111-4222-8333-444444444444', limit: 3 } as never);
    expect(urls).toHaveLength(2);
    expect(audit.logicalProviderRequests).toBe(2);
    expect(audit.matchHistory.candidates.map((c) => c.path)).toContain('data[].players[].stats.performance_score');
    expect(audit.matchDetail.candidates!.map((c) => c.path)).toContain('data.players[].stats.performance_score');
    const text = JSON.stringify(audit);
    for (const forbidden of ['HiddenName', 'puuid-secret', 'aaaaaaaa-1111', 'fictional-test-credential', 'Fictional']) expect(text).not.toContain(forbidden);
  });

  it('stays unavailable in production', () => {
    expect(() => assertProviderAuditAllowed('production')).toThrow();
    expect(() => assertProviderAuditAllowed('preview')).not.toThrow();
  });
});
