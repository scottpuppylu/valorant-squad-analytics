import { dimensions } from '../scoring/versions.js';
import type { PlayerAnalytics } from '../types/valorant.js';
import { analyticsFromEntries, groupByAgent, groupByMap, groupByRole, groupEntries } from './analysis.js';
import { aggregateSelection } from './rankings.js';
import type { GroupSummary, PerformanceEntry, SelectionResult } from './types.js';
import { last } from '../utils/last.js';

/**
 * TASK-DATA-03B.2C `selection-summary-v1`: everything a page derives from a selected population,
 * computed ONCE by the same functions the pages used before (aggregateSelection, groupBy*, the
 * per-map Overall used by map extremes / 地圖王, the Maps page top category).
 *
 * The browser runs it for Demo/local selections; the server runs it over the full tracked population
 * so the response scales with members × maps × agents, never with the number of matches.
 * No formula lives here — only composition of the existing analytics/scoring functions.
 */
export const SELECTION_SUMMARY_VERSION = 'selection-summary-v1' as const;

export type ScoreDimension = (typeof dimensions)[number];

export interface PlayerMapSummary extends GroupSummary {
  /** Overall (community-score-v2) of this player's entries on this map; undefined when not numeric. */
  overall?: number;
}

export interface PlayerContextSummary {
  playerId: string;
  maps: PlayerMapSummary[];
  agents: GroupSummary[];
  /** Appearances per public account (only multi-account members carry accountId; else empty). */
  accounts: { accountId: string; appearances: number }[];
}

/** 'none' = no player analytics on the map (無資料); 'insufficient' = no numeric dimension (資料不足). */
export type MapTopDimension = ScoreDimension | 'none' | 'insufficient';

export interface SelectionSummary {
  summaryVersion: typeof SELECTION_SUMMARY_VERSION;
  /** Selected performance entries (player appearances) in the population. */
  entryCount: number;
  /** aggregateSelection(selection) in its original order. */
  analytics: PlayerAnalytics[];
  groups: { maps: GroupSummary[]; agents: GroupSummary[]; roles: GroupSummary[] };
  /** Maps page 最高分類: highest mean dimension across the map's players. */
  mapTopDimension: Record<string, MapTopDimension>;
  players: PlayerContextSummary[];
}

function byPlayerOf(entries: PerformanceEntry[]): SelectionResult {
  const selection: SelectionResult = { entries, byPlayer: new Map<string, PerformanceEntry[]>() };
  for (const entry of entries) selection.byPlayer.set(entry.playerId, [...(selection.byPlayer.get(entry.playerId) ?? []), entry]);
  return selection;
}

/** Formerly MapsPage `topCategory` (moved out of the component; unchanged logic). */
export function topDimension(entries: PerformanceEntry[]): MapTopDimension {
  const analytics = aggregateSelection(byPlayerOf(entries));
  if (!analytics.length) return 'none';
  const averages = dimensions.flatMap((key) => {
    const values = analytics.flatMap((item) => item.scores[key].value === undefined ? [] : [item.scores[key].value!]);
    return values.length ? [{ key, value: values.reduce((sum, value) => sum + value, 0) / values.length }] : [];
  });
  return averages.length ? averages.sort((a, b) => b.value - a.value)[0]!.key : 'insufficient';
}

export function summarizeSelection(selection: SelectionResult): SelectionSummary {
  const analytics = aggregateSelection(selection);
  const maps = groupByMap(selection.entries);
  const mapTopDimension: Record<string, MapTopDimension> = {};
  for (const map of maps) mapTopDimension[map.id] = topDimension(selection.entries.filter((entry) => entry.match.map === map.id));
  const players = [...selection.byPlayer].flatMap(([playerId, entries]): PlayerContextSummary[] => {
    const player = entries[0]?.player;
    if (!player) return [];
    const perMap = groupEntries(entries, (entry) => entry.match.map);
    return [{
      playerId,
      maps: groupByMap(entries).map((summary) => {
        const overall = analyticsFromEntries(player, perMap.get(summary.id) ?? [])?.scores.overall.value;
        return overall === undefined ? summary : { ...summary, overall };
      }),
      agents: groupByAgent(entries),
      accounts: [...entries.reduce((counts, entry) => (entry.performance.accountId ? counts.set(entry.performance.accountId, (counts.get(entry.performance.accountId) ?? 0) + 1) : counts), new Map<string, number>())]
        .sort((a, b) => a[0].localeCompare(b[0])).map(([accountId, appearances]) => ({ accountId, appearances })),
    }];
  });
  return {
    summaryVersion: SELECTION_SUMMARY_VERSION,
    entryCount: selection.entries.length,
    analytics,
    groups: { maps, agents: groupByAgent(selection.entries), roles: groupByRole(selection.entries) },
    mapTopDimension,
    players,
  };
}

export function playerSummary(summary: SelectionSummary, playerId: string): PlayerContextSummary | undefined {
  return summary.players.find((item) => item.playerId === playerId);
}

/** Same rule as mapExtremes(player, entries, minimum) using the summary's per-map Overall. */
export function mapExtremesFromSummary(context: PlayerContextSummary | undefined, minimum = 2): { strongest?: string; weakest?: string } {
  const candidates = (context?.maps ?? [])
    .filter((map) => map.appearances >= minimum && map.overall !== undefined)
    .map((map) => ({ map: map.id, score: map.overall! }))
    .sort((a, b) => b.score - a.score || a.map.localeCompare(b.map));
  return { strongest: candidates[0]?.map, weakest: candidates.length > 1 ? last(candidates)?.map : undefined };
}
