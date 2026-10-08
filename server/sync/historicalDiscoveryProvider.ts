import type { ConnectionInput } from '../contracts.js';

/** Raw identifiers and payloads exist only in server invocation memory. */
export interface HistoricalDiscoveryProvider {
  fetchHistoryPage(input: ConnectionInput, start: number, size: number): Promise<unknown>;
  fetchStoredIndexPage(input: ConnectionInput, page: number, size: number): Promise<unknown>;
  fetchMatchDetail(input: ConnectionInput, matchId: string): Promise<unknown>;
}

/**
 * TASK-DATA-STORED-INDEX-01: `deep-history-v2` = deep-history-v1 + `stored-index-efficiency-v1`.
 * The stored-index cursor (storedPage/storedItemIndex) is now expressed in STORED_INDEX_PAGE_SIZE pages,
 * so a v1 cursor that is inside stored_index restarts stored discovery at page 1 (never an offset rebase).
 */
export const DEEP_HISTORY_RULE_VERSION = 'deep-history-v2' as const;
export const LEGACY_DEEP_HISTORY_RULE_VERSION = 'deep-history-v1' as const;
export type DeepHistoryRuleVersion = typeof DEEP_HISTORY_RULE_VERSION | typeof LEGACY_DEEP_HISTORY_RULE_VERSION;
export const STORED_INDEX_EFFICIENCY_VERSION = 'stored-index-efficiency-v1' as const;
/**
 * Stored-match index page size (Henrik `/valorant/v1/stored-matches`: `size` is a documented positive
 * integer; 20 is the value used in the provider's own pagination example). live_v4 keeps its own page size.
 */
export const STORED_INDEX_PAGE_SIZE = 20;
