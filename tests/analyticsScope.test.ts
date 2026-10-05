import { describe, expect, it } from 'vitest';
import { calculateRecentForm } from '../src/analytics/analysis';
import { createPerformanceEntries, defaultAnalysisFilters, selectPerformances } from '../src/analytics/filters';
import { aggregateSelection } from '../src/analytics/rankings';
import { resolveAdaptiveWindow } from '../src/analytics/scope/adaptiveWindow';
import { policyFor, featureScopePolicies } from '../src/analytics/scope/policies';
import { populationFromMatches, resolveScopeSelection } from '../src/analytics/scope/resolveScope';
import { compareSeasonKeysDesc, normalizeSeasonKey, seasonLabel } from '../src/analytics/scope/season';
import type { ScopePopulation } from '../src/analytics/scope/types';
import type { PerformanceEntry } from '../src/analytics/types';
import { buildAnalytics } from '../src/data/analytics';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import { mergeHistoryPage, emptyHistoryState } from '../src/dataSources/server/historyMerge';
import type { DatasetHistoryResponse } from '../src/dataSources/server/contracts';
import { selectSynergyMatches, defaultSynergyFilters } from '../src/synergy/analytics';
import type { MatchRecord, Player } from '../src/types/valorant';

const day = 86_400_000;
const anchorMs = Date.UTC(2026, 9, 1, 20);

function player(id: string): Player {
  return { id, handle: `${id}#T`, displayName: id, role: 'Duelist', agents: ['Jett'], accent: '#fff', tagline: '', playstyle: '', defaultEmoji: '🐺' };
}

interface Spec { daysAgo: number; rounds?: number; minutes?: number; mode?: string; season?: string; map?: string; agent?: string; evidence?: 'reconstructed' | 'partial' }

/** One player's matches; index 0 is the newest. Rounds are split 13:x like a real scoreline. */
function matchesFor(playerId: string, specs: Spec[], idPrefix = playerId): MatchRecord[] {
  return specs.map((spec, index) => {
    const rounds = spec.rounds ?? 24;
    const scoreFor = Math.min(13, rounds);
    return {
      id: `${idPrefix}-${String(index).padStart(5, '0')}`,
      playedAt: new Date(anchorMs - spec.daysAgo * day).toISOString(),
      map: spec.map ?? 'Ascent', gameMode: spec.mode ?? 'Competitive', opponent: 'x',
      scoreFor, scoreAgainst: rounds - scoreFor, won: true, durationMinutes: spec.minutes ?? Math.round(rounds * 1.6),
      ...(spec.season ? { seasonKey: spec.season } : {}),
      performances: [{ playerId, agent: spec.agent ?? 'Jett', kills: 18, deaths: 14, assists: 5, acs: 230, adr: 150, kast: 0.72,
        eventEvidence: { kast: spec.evidence ?? 'reconstructed', opening: spec.evidence ?? 'reconstructed' },
        ...(spec.evidence === 'partial' ? { kast: undefined } : {}), firstKills: 3, firstDeaths: 2 }],
    } satisfies MatchRecord;
  });
}

function entriesFor(playerId: string, specs: Spec[]): PerformanceEntry[] {
  return createPerformanceEntries({ players: [player(playerId)], matches: matchesFor(playerId, specs), sourceId: 't', isDemo: false, mode: 'REAL' });
}

const population = (overrides: Partial<ScopePopulation> = {}): ScopePopulation => ({
  anchor: new Date(anchorMs).toISOString(), complete: true, seasonKeys: [], seasonStatus: 'unavailable', rankStatus: 'unavailable', ...overrides,
});

const spread = (count: number, spanDays: number, extra: Partial<Spec> = {}): Spec[] =>
  Array.from({ length: count }, (_, index) => ({ daysAgo: count === 1 ? 0 : (index * spanDays) / (count - 1), ...extra }));

const current = (entries: PerformanceEntry[], pop = population()) => resolveAdaptiveWindow(entries, policyFor('currentStrength'), { population: pop });

describe('adaptive-window-v1 required cases', () => {
  it('A/B: 30 matches in 9 days and 30 matches over 180 days select different semantic windows', () => {
    const dense = current(entriesFor('a', spread(30, 9)));
    const sparse = current(entriesFor('b', spread(30, 180)));
    expect(dense.status).toBe('available');
    expect(dense.reasons).toContain('target_rounds_reached');
    expect(dense.current.rounds).toBeGreaterThanOrEqual(600);
    expect(sparse.status).toBe('partial');
    expect(sparse.reasons).toContain('time_span_cap_reached');
    expect(sparse.current.spanDays).toBeLessThanOrEqual(60);
    expect(sparse.current.matches).toBeLessThan(dense.current.matches);
    expect(sparse.confidence.overall).toBeLessThan(dense.confidence.overall);
  });

  it('C: a high-volume player (100 matches in 30 days) stops at the round target, not at all evidence', () => {
    const window = current(entriesFor('c', spread(100, 30)));
    expect(window.status).toBe('available');
    expect(window.current.matches).toBe(25);
    expect(window.current.matches).toBeLessThan(policyFor('currentStrength').window!.maxMatches);
  });

  it('D: a low-volume player (15 matches in 90 days) extends within bounds and stays partial', () => {
    const window = current(entriesFor('d', spread(15, 90)));
    expect(window.status).toBe('partial');
    expect(window.current.matches).toBeGreaterThanOrEqual(5);
    expect(window.current.spanDays).toBeLessThanOrEqual(60);
    expect(window.reasons).toContain('time_span_cap_reached');
  });

  it('E: an Act boundary after 12 recent matches is respected', () => {
    const specs = [...spread(12, 10, { season: 'e9a3' }), ...spread(20, 10, { season: 'e9a2' }).map((spec) => ({ ...spec, daysAgo: spec.daysAgo + 11 }))];
    const window = current(entriesFor('e', specs));
    expect(window.current.matches).toBe(12);
    expect(window.current.seasons).toEqual(['e9a3']);
    expect(window.reasons).toContain('act_boundary_respected');
    expect(window.boundaries).toMatchObject({ seasonCrossed: false, seasonEvidence: 'available' });
  });

  it('F/G: no season and no rank evidence keep the resolver working with explicit reasons', () => {
    const window = current(entriesFor('f', spread(20, 20)));
    expect(window.status).not.toBe('unavailable');
    expect(window.reasons).toEqual(expect.arrayContaining(['season_evidence_unavailable', 'rank_evidence_unavailable']));
    expect(window.boundaries).toEqual({ seasonCrossed: false, seasonEvidence: 'unavailable', rankBoundaryUsed: false, rankEvidence: 'unavailable' });
  });

  it('H: real rank evidence (fixture) can bound the window at a rank-regime change once the minimum is met', () => {
    const entries = entriesFor('h', spread(30, 29));
    const changeAt = new Date(anchorMs - 8.5 * day).toISOString();
    const window = resolveAdaptiveWindow(entries, policyFor('currentStrength'), { population: population(), rank: { status: 'available', tierChanges: [changeAt] } });
    expect(window.boundaries.rankBoundaryUsed).toBe(true);
    expect(window.reasons).toContain('rank_boundary_respected');
    expect(window.currentEntries.every((entry) => entry.match.playedAt >= changeAt)).toBe(true);
  });

  it('I/J: long overtime games reach the sample with fewer matches than short games', () => {
    const long = current(entriesFor('i', spread(60, 25, { rounds: 30 })));
    const short = current(entriesFor('j', spread(60, 25, { rounds: 13 })));
    expect(long.current.matches).toBe(20);
    expect(short.current.matches).toBe(47);
    const formLong = resolveAdaptiveWindow(entriesFor('i2', spread(10, 9, { rounds: 40 })), policyFor('recentForm'), { population: population() });
    const formShort = resolveAdaptiveWindow(entriesFor('j2', spread(10, 9, { rounds: 13 })), policyFor('recentForm'), { population: population() });
    expect(formLong.current.matches).toBeLessThan(formShort.current.matches);
  });

  it('K: current and baseline never overlap, even with identical timestamps', () => {
    const specs = Array.from({ length: 20 }, (_, index) => ({ daysAgo: Math.floor(index / 4) * 2 }));
    const window = resolveAdaptiveWindow(entriesFor('k', specs), policyFor('recentForm'), { population: population() });
    const ids = new Set(window.currentEntries.map((entry) => entry.match.id));
    expect(window.baselineEntries.length).toBeGreaterThan(0);
    expect(window.baselineEntries.some((entry) => ids.has(entry.match.id))).toBe(false);
  });

  it('L: an insufficient sample is unavailable and excluded from the community ranking population', () => {
    const entries = entriesFor('l', spread(3, 2));
    expect(current(entries)).toMatchObject({ status: 'unavailable' });
    expect(current(entries).reasons).toContain('insufficient_sample');
    const selection = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'current' }, { population: population() });
    expect(selection.byPlayer.has('l')).toBe(false);
    expect(selection.scope!.players.get('l')!.status).toBe('unavailable');
  });

  it('M: missing advanced evidence lowers evidence confidence without blocking or fabricating values', () => {
    const complete = current(entriesFor('m1', spread(10, 10)));
    const partial = current(entriesFor('m2', spread(10, 10, { evidence: 'partial' })));
    expect(partial.current.matches).toBe(complete.current.matches);
    expect(partial.confidence.evidence).toBe(0);
    expect(complete.confidence.evidence).toBe(1);
    // Missing advanced evidence halves window confidence; it never collapses a real sample to zero.
    expect(partial.confidence.overall).toBeCloseTo(complete.confidence.overall / 2, 10);
    expect(partial.confidence.overall).toBeGreaterThan(0);
    expect(partial.currentEntries.every((entry) => entry.performance.kast === undefined)).toBe(true);
  });

  it('N: a revoked player disappears from the next analytics population; nothing is cached', () => {
    const dataset = demoDataSource.snapshot();
    const before = buildAnalytics(dataset);
    const revoked = dataset.players[0]!.id;
    const after = buildAnalytics({ ...dataset, players: dataset.players.slice(1), matches: dataset.matches.map((match) => ({ ...match, performances: match.performances.filter((p) => p.playerId !== revoked) })) });
    expect(before.currentStrength.selection.scope!.players.has(revoked)).toBe(true);
    expect(after.currentStrength.selection.scope!.players.has(revoked)).toBe(false);
    expect(after.currentStrength.analytics.some((item) => item.player.id === revoked)).toBe(false);
  });

  it('O: a new cron match moves the deterministic anchor; older evidence outside the window changes nothing', () => {
    const base = spread(40, 20);
    const window = current(entriesFor('o', base));
    const withOld = current(entriesFor('o', [...base, { daysAgo: 400 }]));
    expect(withOld.currentEntries.map((entry) => entry.match.id)).toEqual(window.currentEntries.map((entry) => entry.match.id));
    const withNew = current(entriesFor('o', [{ daysAgo: -1 }, ...base]), population({ anchor: new Date(anchorMs + day).toISOString() }));
    expect(withNew.currentEntries[0]!.match.playedAt > window.currentEntries[0]!.match.playedAt).toBe(true);
  });

  it('is deterministic regardless of input order and never uses wall-clock time', () => {
    const entries = entriesFor('z', spread(50, 40));
    const shuffled = [...entries].sort((a, b) => a.match.id.localeCompare(b.match.id) * (a.match.id.endsWith('3') ? -1 : 1));
    const first = current(entries);
    const second = current(shuffled.reverse());
    expect(second.currentEntries.map((entry) => entry.match.id)).toEqual(first.currentEntries.map((entry) => entry.match.id));
    expect(second.reasons).toEqual(first.reasons);
    expect(second.confidence).toEqual(first.confidence);
  });

  it('reports a truncated transport snapshot instead of pretending to hold all history', () => {
    // Six matches over 20 days exhaust the browser population before the target; the snapshot floor
    // (20 days) is inside the 120-day lookback, so older durable evidence may exist server-side.
    const entries = entriesFor('t', spread(6, 20));
    const window = current(entries, population({ complete: false, floor: new Date(anchorMs - 20 * day).toISOString() }));
    expect(window.reasons).toEqual(expect.arrayContaining(['lookback_exhausted', 'transport_window_truncated']));
    expect(window.status).toBe('partial');
    // A policy stop (span cap) is not truncation.
    const capped = current(entriesFor('t2', spread(8, 100)), population({ complete: false, floor: new Date(anchorMs - 100 * day).toISOString() }));
    expect(capped.reasons).not.toContain('transport_window_truncated');
    expect(current(entries, population({ complete: true, floor: new Date(anchorMs - 20 * day).toISOString() })).reasons).not.toContain('transport_window_truncated');
  });

  it('volume affects selection and confidence, never the score formula itself', () => {
    const few = entriesFor('v', spread(10, 10));
    const many = entriesFor('v', spread(40, 10).map((spec) => ({ ...spec })));
    const scoreFew = aggregateSelection(selectPerformances(few, { ...defaultAnalysisFilters, period: 'all' }))[0]!;
    const scoreMany = aggregateSelection(selectPerformances(many, { ...defaultAnalysisFilters, period: 'all' }))[0]!;
    // Identical per-match performances: more games raise confidence, not the performance score.
    expect(scoreMany.scores.firepower.value).toBeCloseTo(scoreFew.scores.firepower.value!, 10);
    expect(scoreMany.scores.confidence).toBeGreaterThan(scoreFew.scores.confidence);
  });
});

describe('feature-scope-policy-v2', () => {
  const players = [player('p1'), player('p2')];
  const matches = [
    ...matchesFor('p1', [...spread(10, 9, { season: 'e9a3', map: 'Bind' }), ...spread(10, 9, { season: 'e9a2' }).map((s) => ({ ...s, daysAgo: s.daysAgo + 30 }))]),
    ...matchesFor('p2', spread(12, 20, { mode: 'Unrated' })),
  ];
  const dataset = { players, matches, sourceId: 't', isDemo: false as const, mode: 'REAL' as const };
  const entries = createPerformanceEntries(dataset);
  const pop = populationFromMatches(matches, true);

  it('declares every reviewed feature with versioned horizon, queue and fallback semantics', () => {
    expect(Object.keys(featureScopePolicies).sort()).toEqual(['actOverview', 'agentStats', 'currentStrength', 'fixedRecent', 'improvementIndex', 'lifetimeTotals', 'mapStats', 'matchHistory', 'recentForm', 'synergy', 'trends']);
    expect(policyFor('currentStrength')).toMatchObject({ horizon: 'ADAPTIVE', queues: ['Competitive'], crossSeason: false, weighting: 'uniform' });
    expect(policyFor('improvementIndex').implementation).toBe('wired');
    expect(Object.values(featureScopePolicies).every((policy) => policy.fallback !== ('lifetime' as never))).toBe(true);
  });

  it('lifetime statistics use all eligible tracked evidence in all modes', () => {
    const selection = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'all' }, { population: pop });
    expect(selection.entries).toHaveLength(32);
    expect(selection.scope).toMatchObject({ kind: 'LIFETIME', status: 'available', fallbackUsed: false });
  });

  it('Act statistics never cross the Act boundary and never fall back to lifetime', () => {
    const act = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'act', act: 'e9a2' }, { population: pop });
    expect(act.entries.every((entry) => entry.match.seasonKey === 'e9a2')).toBe(true);
    expect(act.entries).toHaveLength(10);
    const none = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'act', act: 'e1a1' }, { population: pop });
    expect(none.entries).toHaveLength(0);
    expect(none.scope).toMatchObject({ kind: 'ACT', status: 'unavailable', reasons: ['season_evidence_unavailable'] });
    const noSeasons = populationFromMatches(matches.map((match) => ({ ...match, seasonKey: undefined })), true);
    expect(selectPerformances(entries, { ...defaultAnalysisFilters, period: 'act', act: 'e9a2' }, { population: noSeasons }).entries).toHaveLength(0);
  });

  it('recent fixed windows keep their explicit legacy semantics', () => {
    const recent = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'recent10' }, { population: pop });
    expect(recent.byPlayer.get('p1')).toHaveLength(10);
    expect(recent.scope).toMatchObject({ kind: 'RECENT', feature: 'fixedRecent' });
  });

  it('adaptive current strength uses the resolver result and the Competitive policy', () => {
    const selection = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'current' }, { population: pop });
    const window = selection.scope!.players.get('p1')!.window!;
    expect(selection.byPlayer.get('p1')!.map((entry) => entry.match.id)).toEqual(window.currentEntries.map((entry) => entry.match.id));
    expect(selection.byPlayer.has('p2')).toBe(false);
    expect(selection.scope!.players.get('p2')!.reasons).toContain('queue_restricted_by_policy');
    const unrated = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'current', gameMode: 'Unrated' }, { population: pop });
    expect(unrated.entries).toHaveLength(0);
    expect(unrated.scope!.reasons).toContain('queue_excluded_by_policy');
  });

  it('map and agent filters compose with the time horizon through the same selector', () => {
    const bindCurrent = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'current', map: 'Bind' }, { population: pop });
    expect(bindCurrent.entries.length).toBeGreaterThan(0);
    expect(bindCurrent.entries.every((entry) => entry.match.map === 'Bind')).toBe(true);
    const bindAct = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'act', act: 'e9a2', map: 'Bind' }, { population: pop });
    expect(bindAct.entries).toHaveLength(0);
  });

  it('Synergy uses the shared PAIR context, including an explicit Act', () => {
    expect(selectSynergyMatches(dataset, { ...defaultSynergyFilters, act: 'e9a3' }).every((match) => match.seasonKey === 'e9a3')).toBe(true);
    expect(selectSynergyMatches(dataset, defaultSynergyFilters)).toHaveLength(32);
  });

  it('loading history pages in the browser never changes analytics results', () => {
    const demo = demoDataSource.snapshot();
    const snapshot = { ...demo, matches: demo.matches.slice(0, 20) };
    const before = buildAnalytics(snapshot);
    const page = { ok: true, schemaVersion: 5, view: 'history', historyVersion: 'dataset-history-v1', projectionVersion: 'evidence-decoupled-projection-v1', state: 'ready',
      page: { limit: 50, traversedMatchCount: 12, withheldMatchCount: 0, hasMore: false, nextCursor: null },
      tracked: { trackedMatchCount: 32, lifetimeComplete: false }, evidence: {} as DatasetHistoryResponse['evidence'],
      dataset: { ...demo, matches: demo.matches.slice(20), mode: 'REAL', isDemo: false } } as DatasetHistoryResponse;
    const history = mergeHistoryPage(emptyHistoryState(), page, snapshot);
    expect(history.matches).toHaveLength(12);
    const after = buildAnalytics(snapshot);
    const summarize = (analytics: ReturnType<typeof buildAnalytics>) => analytics.currentStrength.analytics.map((item) => [item.player.id, item.scores.overall.value, item.stats.matches]);
    expect(summarize(after)).toEqual(summarize(before));
  });

  it('normalizes only recognized public Act codes and labels unknown as 未分類', () => {
    expect(normalizeSeasonKey(' E9A3 ')).toBe('e9a3');
    expect(normalizeSeasonKey('v26a1')).toBe('v26a1');
    expect(normalizeSeasonKey('03a2f1c0-0000-4000-8000-000000000000')).toBeUndefined();
    expect(seasonLabel('v26a1')).toBe('V26:A1');
    expect(seasonLabel(undefined)).toBe('未知 Act／未分類');
    expect(['e9a2', 'e10a1', 'e9a3'].sort(compareSeasonKeysDesc)).toEqual(['e10a1', 'e9a3', 'e9a2']);
  });
});

describe('analysis-scope-v1 performance', () => {
  it.each([20, 100, 300, 1000, 10_000])('resolves every scope over %i lightweight observations without the full history payload', (count) => {
    const players = ['s1', 's2', 's3', 's4'];
    const all = players.flatMap((id) => entriesFor(id, spread(Math.ceil(count / players.length), Math.max(9, count / 10))));
    const pop = populationFromMatches([...new Set(all.map((entry) => entry.match))], true);
    const timings: Record<string, number> = {};
    for (const period of ['current', 'all', 'recent30'] as const) {
      const started = performance.now();
      const result = resolveScopeSelection(all, { choice: period, gameMode: 'all' }, pop);
      timings[period] = Math.round((performance.now() - started) * 100) / 100;
      expect(result.summary.players.size).toBe(players.length);
    }
    const started = performance.now();
    const form = calculateRecentForm(all[0]!.player, all.filter((entry) => entry.playerId === 's1'), pop);
    timings.recentForm = Math.round((performance.now() - started) * 100) / 100;
    expect(form.window?.ruleVersion).toBe('adaptive-window-v1');
    expect(timings.current).toBeLessThan(5_000);
    process.stdout.write(`SCOPE_PERFORMANCE ${count} ${JSON.stringify(timings)}\n`);
  }, 60_000);
});
