import type { MatchRecord, Player } from '../../types/valorant';
import type { NormalizedAnalyticsDataset } from '../types';
import type { DatasetHistoryResponse, DatasetTrackedHistoryContract } from './contracts';

/**
 * TASK-DATA-03B.1 in-memory history browse state. Never persisted to browser storage.
 * `matches` holds only history matches that are NOT already in the bounded snapshot;
 * they are browse-only and are never passed to buildAnalytics().
 */
export interface TrackedHistoryState {
  matches: MatchRecord[];
  players: Player[];
  nextCursor: string | null;
  hasMore: boolean;
  pagesLoaded: number;
  traversedMatchCount: number;
  withheldMatchCount: number;
  duplicateMatchesIgnored: number;
  oldestLoadedAt?: string;
  tracked?: DatasetTrackedHistoryContract;
}

export function emptyHistoryState(): TrackedHistoryState {
  return { matches: [], players: [], nextCursor: null, hasMore: true, pagesLoaded: 0, traversedMatchCount: 0, withheldMatchCount: 0, duplicateMatchesIgnored: 0 };
}

/**
 * Deduplicates by public match id against the snapshot and every earlier page. Keyset pages
 * arrive newest -> oldest, so appending preserves the server's deterministic order.
 */
export function mergeHistoryPage(
  state: TrackedHistoryState,
  page: DatasetHistoryResponse,
  snapshot: Pick<NormalizedAnalyticsDataset, 'matches'>,
): TrackedHistoryState {
  const seen = new Set<string>([...snapshot.matches.map((match) => match.id), ...state.matches.map((match) => match.id)]);
  const added: MatchRecord[] = [];
  let duplicates = 0;
  for (const match of page.dataset.matches) {
    if (seen.has(match.id)) { duplicates += 1; continue; }
    seen.add(match.id);
    added.push(match);
  }
  // Latest page wins for player display data; a player revoked since an earlier page is no
  // longer re-added, but already loaded rows stay until reload (same as the snapshot).
  const players = new Map(state.players.map((player) => [player.id, player]));
  for (const player of page.dataset.players) players.set(player.id, player);
  const matches = [...state.matches, ...added];
  const pageOldest = page.page.from;
  return {
    matches,
    players: [...players.values()],
    nextCursor: page.page.nextCursor,
    hasMore: page.page.hasMore,
    pagesLoaded: state.pagesLoaded + 1,
    traversedMatchCount: state.traversedMatchCount + page.page.traversedMatchCount,
    withheldMatchCount: state.withheldMatchCount + page.page.withheldMatchCount,
    duplicateMatchesIgnored: state.duplicateMatchesIgnored + duplicates,
    oldestLoadedAt: pageOldest && (!state.oldestLoadedAt || pageOldest < state.oldestLoadedAt) ? pageOldest : state.oldestLoadedAt,
    tracked: page.tracked,
  };
}
