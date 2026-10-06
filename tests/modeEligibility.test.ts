import { afterEach, describe, expect, it } from 'vitest';
import { eligibleModesFor, isAbsoluteStrengthMode, isBrowseMode, isSameMatchRelativeMode, MODE_ELIGIBILITY_POLICY_VERSION, requestedModeAllowed } from '../src/analytics/modeEligibility';
import { createPerformanceEntries, defaultAnalysisFilters, selectPerformances } from '../src/analytics/filters';
import { summarizeSelection } from '../src/analytics/summary';
import { populationFromMatches } from '../src/analytics/scope/resolveScope';
import { featureScopePolicies } from '../src/analytics/scope/policies';
import { FEATURE_SCOPE_POLICY_VERSION } from '../src/analytics/scope/versions';
import { resolveProgressWindows } from '../src/analytics/progress/windows';
import { computeImprovementIndex } from '../src/analytics/progress/improvementIndex';
import { buildSynergy, defaultSynergyFilters } from '../src/synergy/analytics';
import { localWeaponAnalytics } from '../src/analytics/weapons/local';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import { normalizeGameMode } from '../src/utils/gameMode';
import type { AnalysisFilters } from '../src/analytics/types';
import type { MatchRecord } from '../src/types/valorant';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types';
import { buildAnalyticsContext, PostgresAnalyticsContextRepository } from '../server/dataset/analyticsContext';
import { ServerAnalysisService, type AnalysisRequest } from '../server/dataset/analysisService';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import { parseHistoryRequest } from '../server/dataset/historyCursor';
import { PostgresDatasetReadRepository } from '../server/dataset/postgresDatasetReadRepository';
import { closeAll, database, seedMatches, seedPlayers, type Spec } from './support/durableFixtures';

afterEach(closeAll);

describe('mode-eligibility-policy-v1 matrix', () => {
  const rows: [string, boolean, boolean][] = [
    ['Competitive', true, true], ['Unrated', false, true], ['Premier', false, false], ['Custom', false, false],
    ['Swiftplay', false, false], ['Team Deathmatch', false, false], ['Deathmatch', false, false], ['Spike Rush', false, false],
    ['Escalation', false, false], ['Future Experimental Mode', false, false], ['', false, false], ['competitive', false, false],
  ];
  it.each(rows)('%s → absolute %s / same-match-relative %s / browse true', (mode, absolute, relative) => {
    expect(isAbsoluteStrengthMode(mode)).toBe(absolute);
    expect(isSameMatchRelativeMode(mode)).toBe(relative);
    expect(isBrowseMode(mode)).toBe(true);
  });
  it('exposes one versioned allow-list per kind and fails closed on requested modes', () => {
    expect(MODE_ELIGIBILITY_POLICY_VERSION).toBe('mode-eligibility-policy-v1');
    expect(eligibleModesFor('ABSOLUTE_STRENGTH')).toEqual(['Competitive']);
    expect(eligibleModesFor('SAME_MATCH_RELATIVE')).toEqual(['Competitive', 'Unrated']);
    expect(eligibleModesFor('BROWSE_HISTORY')).toBe('all');
    expect(requestedModeAllowed('ABSOLUTE_STRENGTH', 'all')).toBe(true);
    expect(requestedModeAllowed('ABSOLUTE_STRENGTH', 'Unrated')).toBe(false);
    expect(requestedModeAllowed('SAME_MATCH_RELATIVE', 'Unrated')).toBe(true);
  });
  it('normalization keeps Competitive, Premier and Unrated distinct (no collapse)', () => {
    expect(normalizeGameMode('competitive', 'Competitive')).toBe('Competitive');
    expect(normalizeGameMode('premier', 'Premier')).toBe('Premier');
    expect(normalizeGameMode('unrated', 'Unrated')).toBe('Unrated');
    expect(normalizeGameMode('swiftplay', 'Swiftplay')).toBe('Swiftplay');
  });
  it('feature-scope-policy-v3: every strength feature is Competitive only; only match history browses all', () => {
    expect(FEATURE_SCOPE_POLICY_VERSION).toBe('feature-scope-policy-v3');
    for (const policy of Object.values(featureScopePolicies)) {
      expect(policy.queues, policy.feature).toEqual(policy.feature === 'matchHistory' ? 'all' : ['Competitive']);
    }
  });
});

// ---- deterministic mixed fixture: identical Competitive evidence + extreme excluded-mode evidence
const demo = demoDataSource.snapshot();
const base: NormalizedAnalyticsDataset = { ...demo, matches: demo.matches.filter((m) => m.gameMode === 'Competitive') };
const newest = base.matches.reduce((a, m) => (m.playedAt > a ? m.playedAt : a), '');
function extreme(mode: string, offsetHours: number, template: MatchRecord, index: number): MatchRecord {
  const at = new Date(Date.parse(template.playedAt) + offsetHours * 3_600_000).toISOString();
  return { ...template, id: `${mode}-${index}-${template.id}`, gameMode: mode as MatchRecord['gameMode'], playedAt: at,
    performances: template.performances.map((p) => ({ ...p, kills: 60, deaths: 1, assists: 20, acs: 900, adr: 600, kast: 1, headshotPercentage: 0.9, firstKills: 15, firstDeaths: 0 })) };
}
const excludedModes = ['Unrated', 'Swiftplay', 'Team Deathmatch', 'Deathmatch', 'Premier', 'Custom', 'Future Experimental Mode'];
// Interleave (between Competitive windows) AND add newer-than-everything excluded matches.
const mixed: NormalizedAnalyticsDataset = { ...base, matches: [...base.matches,
  ...base.matches.slice(0, 40).flatMap((m, i) => excludedModes.map((mode, k) => extreme(mode, 0.5 + k * 0.01, m, i))),
  ...excludedModes.map((mode, k) => extreme(mode, (Date.parse(newest) - Date.parse(base.matches[0]!.playedAt)) / 3_600_000 + 24 + k, base.matches[0]!, 999)),
] };
const local = (dataset: NormalizedAnalyticsDataset, filters: Partial<AnalysisFilters>, lifetimeFeature?: 'mapStats' | 'agentStats' | 'lifetimeTotals') => {
  const entries = createPerformanceEntries(dataset);
  const population = populationFromMatches(dataset.matches, true);
  return summarizeSelection(selectPerformances(entries, { ...defaultAnalysisFilters, ...filters }, { population, ...(lifetimeFeature ? { lifetimeFeature } : {}) }));
};
const json = (value: unknown) => JSON.stringify(value);

describe('absolute analytics never change when non-Competitive evidence is added', () => {
  const filters: [string, Partial<AnalysisFilters>, ('mapStats' | 'agentStats' | 'lifetimeTotals')?][] = [
    ['lifetime (全部已追蹤排位)', { period: 'all' }], ['current strength', { period: 'current' }], ['recent 10 排位', { period: 'recent10' }],
    ['recent 30 排位', { period: 'recent30' }], ['map Ascent', { period: 'all', map: 'Ascent' }, 'mapStats'], ['agent Jett', { period: 'all', agent: 'Jett' }, 'agentStats'],
    ['custom dates', { period: 'custom', dateFrom: base.matches.at(-1)!.playedAt.slice(0, 10) }],
  ];
  it.each(filters)('%s: community-score-v2 summary byte-identical', (_label, f, feature) => {
    expect(json(local(mixed, f, feature))).toBe(json(local(base, f, feature)));
  });
  it('an explicit ineligible mode (legacy ?mode=Unrated) computes nothing for absolute features', () => {
    for (const period of ['all', 'current', 'recent10', 'custom'] as const) {
      const entries = createPerformanceEntries(mixed);
      const selection = selectPerformances(entries, { ...defaultAnalysisFilters, period, gameMode: 'Unrated' }, { population: populationFromMatches(mixed.matches, true) });
      expect(selection.entries).toHaveLength(0);
      expect(selection.scope!.status).toBe('unavailable');
      expect(selection.scope!.reasons).toContain('queue_excluded_by_policy');
    }
  });
  it('recent N selects the latest N Competitive matches, never the latest N of any mode', () => {
    const entries = createPerformanceEntries(mixed);
    const recent = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'recent10' }, { population: populationFromMatches(mixed.matches, true) });
    for (const [playerId, list] of recent.byPlayer) {
      const expected = entries.filter((e) => e.playerId === playerId && e.match.gameMode === 'Competitive')
        .sort((a, b) => b.match.playedAt.localeCompare(a.match.playedAt) || a.match.id.localeCompare(b.match.id)).slice(0, 10).map((e) => e.match.id);
      expect(list.map((e) => e.match.id)).toEqual(expected);
    }
  });
  it('Act analytics include only Competitive rows of that Act', () => {
    const act = 'e9a3';
    const withAct = (d: NormalizedAnalyticsDataset) => ({ ...d, matches: d.matches.map((m, i) => ({ ...m, seasonKey: i % 2 ? act : 'e9a2' })) });
    const a = withAct(base); const b = { ...a, matches: [...a.matches, ...mixed.matches.filter((m) => m.gameMode !== 'Competitive').map((m) => ({ ...m, seasonKey: act }))] };
    expect(json(local(b, { period: 'act', act }))).toBe(json(local(a, { period: 'act', act })));
    expect(local(b, { period: 'act', act }).entryCount).toBeGreaterThan(0);
  });
  it('Improvement Index (improvement-index-v1) is identical with extreme Unrated between and after its windows', () => {
    for (const player of base.players) {
      const run = (d: NormalizedAnalyticsDataset) => {
        const entries = createPerformanceEntries(d).filter((e) => e.playerId === player.id);
        const result = computeImprovementIndex(player, resolveProgressWindows(entries, populationFromMatches(d.matches, true)));
        // Values, windows and confidence must be identical; only the truthful disclosure reason may be added.
        return json({ ...result, reasons: result.reasons.filter((reason) => reason !== 'queue_restricted_by_policy') });
      };
      expect(run(mixed), player.id).toBe(run(base));
    }
  });
  it('current duo-synergy-v1 is Competitive only: Unrated/entertainment shared matches change nothing', () => {
    expect(json(buildSynergy(mixed, defaultSynergyFilters))).toBe(json(buildSynergy(base, defaultSynergyFilters)));
    expect(buildSynergy(mixed, { ...defaultSynergyFilters, gameMode: 'Unrated' })).toEqual([]);
  });
  it('weapon-analytics-v2 (Demo engine) only counts Competitive weapon evidence', () => {
    const run = (d: NormalizedAnalyticsDataset, scope: 'all' | 'current', mode = 'all') => {
      const entries = createPerformanceEntries(d);
      return localWeaponAnalytics(d, entries, populationFromMatches(d.matches, true), { player: 'all', scope, map: 'all', agent: 'all', mode });
    };
    expect(json(run(mixed, 'all'))).toBe(json(run(base, 'all')));
    expect(json(run(mixed, 'current'))).toBe(json(run(base, 'current')));
    expect(run(mixed, 'all', 'Unrated').scope.reasons).toContain('queue_excluded_by_policy');
  });
  it('match history still browses every mode (storage/browse is never filtered)', () => {
    const entries = createPerformanceEntries(mixed);
    const history = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'all' }, { lifetimeFeature: 'matchHistory', population: populationFromMatches(mixed.matches, true) });
    expect(new Set(history.entries.map((e) => e.match.gameMode))).toEqual(new Set(['Competitive', ...excludedModes]));
    const recent = selectPerformances(entries, { ...defaultAnalysisFilters, period: 'recent10' }, { lifetimeFeature: 'matchHistory', population: populationFromMatches(mixed.matches, true) });
    expect(recent.entries.some((e) => e.match.gameMode !== 'Competitive')).toBe(true);
  });
});

// ---- server (REAL) enforcement over durable evidence
const request = (partial: Partial<AnalysisRequest>): AnalysisRequest => ({ feature: 'currentStrength', map: 'all', agent: 'all', role: 'all', mode: 'all', player: 'all', form: false, ...partial });
function competitiveSpecs(): Spec[] {
  return Array.from({ length: 60 }, (_, i) => ({ n: i + 1, hoursAgo: i * 9, map: i % 2 ? 'Bind' : 'Ascent', season: 'e11a5', queue: 'competitive',
    seats: i % 3 === 0 ? [{ player: 1, agent: 'Jett' }, { player: 2, agent: 'Sova' }] : [{ player: 1 + (i % 2), agent: i % 2 ? 'Sova' : 'Jett' }] }));
}
function excludedSpecs(): Spec[] {
  const queues = ['unrated', 'swiftplay', 'premier', 'deathmatch', 'teamdeathmatch'];
  return Array.from({ length: 40 }, (_, i) => ({ n: 500 + i, hoursAgo: i * 9 + 4 - (i === 0 ? 10 : 0), map: 'Ascent', season: 'e11a5', queue: queues[i % queues.length],
    seats: [{ player: 1, agent: 'Jett', kills: 60 }, { player: 2, agent: 'Sova', kills: 55 }] }));
}
const strip = (payload: { summary?: unknown; synergy?: unknown; scope?: unknown }) => json({ summary: payload.summary ?? null, synergy: payload.synergy ?? null });

describe('server-side enforcement (REAL)', () => {
  it('absolute populations are Competitive only; inventory, history and context still count every mode', async () => {
    const a = await database(); await seedPlayers(a, 2); await seedMatches(a, competitiveSpecs());
    const b = await database(); await seedPlayers(b, 2); await seedMatches(b, [...competitiveSpecs(), ...excludedSpecs()]);
    const sa = new ServerAnalysisService(a, new DatasetProjectionService(new PostgresDatasetReadRepository(a)));
    const sb = new ServerAnalysisService(b, new DatasetProjectionService(new PostgresDatasetReadRepository(b)));
    for (const r of [request({ feature: 'lifetimeTotals' }), request({ feature: 'mapStats', map: 'Ascent' }), request({ feature: 'agentStats', agent: 'Jett' }),
      request({ feature: 'actOverview', act: 'e11a5' }), request({ feature: 'fixedRecent', recent: 10 }), request({ form: true }), request({ feature: 'synergy' })]) {
      const left = (await sa.analyze(r)).payload; const right = (await sb.analyze(r)).payload;
      expect(strip(right), JSON.stringify(r)).toBe(strip(left));
      expect(right.coverage.populationMatches, JSON.stringify(r)).toBe(left.coverage.populationMatches);
      expect(right.modeEligibilityPolicyVersion).toBe('mode-eligibility-policy-v1');
      expect(right.featurePolicyVersion).toBe('feature-scope-policy-v3');
      expect(right.coverage.trackedMatchCount).toBe(100);
    }
    const improvementA = (await sa.analyze(request({ feature: 'improvementIndex' }))).payload;
    const improvementB = (await sb.analyze(request({ feature: 'improvementIndex' }))).payload;
    expect(json(improvementB.progress)).toBe(json(improvementA.progress));
    // Legacy/manipulated ?mode=Unrated never computes an absolute result server-side.
    const unrated = (await sb.analyze(request({ feature: 'lifetimeTotals', mode: 'Unrated' }))).payload;
    expect(unrated.summary!.analytics).toHaveLength(0);
    expect(unrated.scope!.reasons).toContain('queue_excluded_by_policy');
    expect((await sb.analyze(request({ feature: 'synergy', mode: 'Unrated' }))).payload.synergy).toEqual([]);
    // Explicit mode=Competitive equals the default.
    expect(strip((await sb.analyze(request({ feature: 'lifetimeTotals', mode: 'Competitive' }))).payload)).toBe(strip((await sb.analyze(request({ feature: 'lifetimeTotals' }))).payload));
    // Inventory facts and browsing keep every mode.
    const context = buildAnalyticsContext(await new PostgresAnalyticsContextRepository(b).readContextRows());
    expect(context.modeEligibility).toEqual({ policyVersion: 'mode-eligibility-policy-v1', competitiveMatches: 60, unratedMatches: 8, otherMatches: 32 });
    expect(context.facets!.competitiveTeamOutcome!.matches).toBe(60);
    expect(context.facets!.teamOutcome.matches).toBe(100);
    const history = (await new DatasetProjectionService(new PostgresDatasetReadRepository(b), 'mode-policy-cursor-key-material-32-bytes').readHistory(parseHistoryRequest({ limit: '100' }, 'mode-policy-cursor-key-material-32-bytes'))).payload;
    expect(history.dataset.matches).toHaveLength(100);
    expect(new Set(history.dataset.matches.map((m) => m.gameMode)).size).toBeGreaterThan(1);
  }, 120_000);
});
