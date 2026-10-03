import type { ConnectionInput } from '../contracts.js';

/** Raw identifiers and payloads exist only in server invocation memory. */
export interface HistoricalDiscoveryProvider {
  fetchHistoryPage(input: ConnectionInput, start: number, size: number): Promise<unknown>;
  fetchStoredIndexPage(input: ConnectionInput, page: number, size: number): Promise<unknown>;
  fetchMatchDetail(input: ConnectionInput, matchId: string): Promise<unknown>;
}

export const DEEP_HISTORY_RULE_VERSION = 'deep-history-v1' as const;
