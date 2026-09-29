import { describe, expect, it } from 'vitest';
import { calculateRecentForm, comparePlayers, computeBadges, groupByAgent, groupByMap, groupByRole, mapExtremes, mostUsedAgent, resolveWinners } from '../src/analytics/analysis';
import { defaultAnalysisFilters, matchesForSelection, resetAnalysisFilters, selectPerformances } from '../src/analytics/filters';
import { aggregateSelection, rankPlayers } from '../src/analytics/rankings';
import { activeDataset, performanceEntries } from '../src/data/analytics';

describe('analytics selection pipeline', () => {
  it('selects all normalized player performances by default', () => {
    const selection = selectPerformances(performanceEntries, defaultAnalysisFilters);
    expect(selection.entries).toHaveLength(160);
    expect(selection.byPlayer.size).toBe(8);
  });

  it('applies map, agent, role, mode and player filters to actual performance rows', () => {
    const sample = performanceEntries[0]!;
    const selection = selectPerformances(performanceEntries, {
      ...defaultAnalysisFilters,
      playerId: sample.playerId,
      map: sample.match.map,
      agent: sample.performance.agent,
      role: sample.player.role,
      gameMode: sample.match.gameMode,
    });
    expect(selection.entries.length).toBeGreaterThan(0);
    expect(selection.entries.every((entry) => entry.playerId === sample.playerId
      && entry.match.map === sample.match.map
      && entry.performance.agent === sample.performance.agent
      && entry.player.role === sample.player.role
      && entry.match.gameMode === sample.match.gameMode)).toBe(true);
  });

  it('uses inclusive custom dates and returns a safe empty result', () => {
    const day = performanceEntries[0]!.match.playedAt.slice(0, 10);
    const onDay = selectPerformances(performanceEntries, { ...defaultAnalysisFilters, period: 'custom', dateFrom: day, dateTo: day });
    expect(onDay.entries.length).toBeGreaterThan(0);
    expect(onDay.entries.every((entry) => entry.match.playedAt.startsWith(day))).toBe(true);
    expect(selectPerformances(performanceEntries, { ...defaultAnalysisFilters, period: 'custom', dateFrom: '2099-01-01' }).entries).toHaveLength(0);
  });

  it('defines recent windows per player after contextual filters', () => {
    const recent = selectPerformances(performanceEntries, { ...defaultAnalysisFilters, period: 'recent10' });
    expect(recent.byPlayer.size).toBe(8);
    expect([...recent.byPlayer.values()].every((entries) => entries.length === 10)).toBe(true);
    expect(recent.entries).toHaveLength(80);
  });

  it('keeps recent 30 capped per player without dropping smaller eligible histories', () => {
    const recent = selectPerformances(performanceEntries, { ...defaultAnalysisFilters, period: 'recent30' });
    expect(recent.entries).toHaveLength(160);
    expect([...recent.byPlayer.values()].every((entries) => entries.length <= 30)).toBe(true);
  });

  it('combines filters on one analytical population', () => {
    const selection = selectPerformances(performanceEntries, { ...defaultAnalysisFilters, map: 'Ascent', role: 'Controller', period: 'recent10', gameMode: 'Competitive' });
    expect(selection.entries.every((entry) => entry.match.map === 'Ascent' && entry.player.role === 'Controller' && entry.match.gameMode === 'Competitive')).toBe(true);
    expect([...selection.byPlayer.values()].every((entries) => entries.length <= 10)).toBe(true);
  });

  it('returns a new default filter object on reset', () => {
    expect(resetAnalysisFilters()).toEqual(defaultAnalysisFilters);
    expect(resetAnalysisFilters()).not.toBe(defaultAnalysisFilters);
  });
});

describe('rankings, comparisons and summaries', () => {
  const selection = selectPerformances(performanceEntries, defaultAnalysisFilters);

  it('ranks every eligible player deterministically in both directions', () => {
    const descending = rankPlayers(selection, defaultAnalysisFilters, 'overall', 'desc');
    const ascending = rankPlayers(selection, defaultAnalysisFilters, 'overall', 'asc');
    expect(descending).toHaveLength(8);
    expect(descending.map(({ analytics }) => analytics.player.id)).toEqual(rankPlayers(selection, defaultAnalysisFilters, 'overall', 'desc').map(({ analytics }) => analytics.player.id));
    expect(descending.every((row, index) => index === 0 || descending[index - 1]!.value >= row.value)).toBe(true);
    expect(ascending.every((row, index) => index === 0 || ascending[index - 1]!.value <= row.value)).toBe(true);
    expect(descending.every(({ value }) => Number.isFinite(value) && value >= 0 && value <= 100)).toBe(true);
    expect(rankPlayers(selection, defaultAnalysisFilters, 'acs')[0]!.value).toBe(rankPlayers(selection, defaultAnalysisFilters, 'acs')[0]!.analytics.stats.acs);
  });

  it('excludes players below explicit sample thresholds', () => {
    expect(rankPlayers(selection, { ...defaultAnalysisFilters, minMatches: 21 }, 'overall')).toHaveLength(0);
    expect(rankPlayers(selection, { ...defaultAnalysisFilters, minRounds: 10_000 }, 'acs')).toHaveLength(0);
  });

  it('does not rank zero-match or zero-round selections and never emits non-finite values', () => {
    const empty = selectPerformances(performanceEntries, { ...defaultAnalysisFilters, period: 'custom', dateFrom: '2099-01-01' });
    expect(rankPlayers(empty, defaultAnalysisFilters, 'overall')).toEqual([]);
    const entry = performanceEntries[0]!;
    const zeroRoundEntry = { ...entry, match: { ...entry.match, scoreFor: 0, scoreAgainst: 0 } };
    const zeroRounds = { entries: [zeroRoundEntry], byPlayer: new Map([[entry.playerId, [zeroRoundEntry]]]) };
    expect(rankPlayers(zeroRounds, defaultAnalysisFilters, 'kd')).toEqual([]);
  });

  it('requires two to four players for comparison', () => {
    const analytics = aggregateSelection(selection);
    expect(comparePlayers(analytics, analytics.slice(0, 2).map(({ player }) => player.id))).toHaveLength(2);
    expect(() => comparePlayers(analytics, [analytics[0]!.player.id])).toThrow('2 到 4');
    expect(() => comparePlayers(analytics, analytics.slice(0, 5).map(({ player }) => player.id))).toThrow('2 到 4');
  });

  it('groups the same selected rows by map, actual agent and player role', () => {
    expect(groupByMap(selection.entries).reduce((sum, group) => sum + group.appearances, 0)).toBe(selection.entries.length);
    expect(groupByAgent(selection.entries).reduce((sum, group) => sum + group.appearances, 0)).toBe(selection.entries.length);
    expect(groupByRole(selection.entries).reduce((sum, group) => sum + group.appearances, 0)).toBe(selection.entries.length);
    expect(groupByAgent(selection.entries).every((group) => selection.entries.some((entry) => entry.performance.agent === group.id))).toBe(true);
  });

  it('filters match history from selected performance rows', () => {
    const player = activeDataset.players[0]!;
    const selected = selectPerformances(performanceEntries, { ...defaultAnalysisFilters, playerId: player.id, map: 'Ascent' });
    const matches = matchesForSelection(activeDataset.matches, selected);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((match) => match.map === 'Ascent' && match.performances.some((performance) => performance.playerId === player.id))).toBe(true);
  });
});

describe('recent form, profile summaries and badges', () => {
  const selection = selectPerformances(performanceEntries, defaultAnalysisFilters);
  const player = activeDataset.players[0]!;
  const entries = selection.byPlayer.get(player.id)!;

  it('compares the latest five matches with the preceding eligible baseline', () => {
    const form = calculateRecentForm(player, entries);
    expect(form.recentMatches).toBe(5);
    expect(form.baselineMatches).toBe(15);
    expect(form.status).not.toBe('insufficient');
    expect(Number.isFinite(form.delta)).toBe(true);
  });

  it('returns insufficient rather than fabricating a trend for tiny samples', () => {
    expect(calculateRecentForm(player, entries.slice(0, 4)).status).toBe('insufficient');
  });

  it('applies explicit map minimums and detects the most used actual agent', () => {
    const extremes = mapExtremes(player, entries, 2);
    expect(extremes.strongest).toBeDefined();
    expect(mapExtremes(player, entries, 99)).toEqual({ strongest: undefined, weakest: undefined });
    expect(mostUsedAgent(entries)).toBeDefined();
  });

  it('only awards badges when stated sample policies are met', () => {
    const badges = computeBadges(selection);
    expect(badges.length).toBeGreaterThanOrEqual(6);
    expect(badges.every((badge) => badge.playerIds.length > 0 && Number.isFinite(badge.value))).toBe(true);
    expect(computeBadges(selection, 99, 99_999)).toHaveLength(2);
  });

  it('uses a documented 0.1 tie tolerance for badge winners', () => {
    expect(resolveWinners([{ playerId: 'b', value: 90 }, { playerId: 'a', value: 90.1 }, { playerId: 'c', value: 89.99 }])).toEqual({ value: 90.1, playerIds: ['a', 'b'] });
  });
});
