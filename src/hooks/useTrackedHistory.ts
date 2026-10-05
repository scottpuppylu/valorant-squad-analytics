import { useCallback, useEffect, useRef, useState } from 'react';
import type { DatasetContextValue } from '../contexts/DatasetContext';
import { BackendApiError } from '../dataSources/server/ValorantBackendClient';
import type { DatasetHistoryQuery } from '../dataSources/server/contracts';
import { isDatasetHistoryResponse } from '../dataSources/server/datasetContract';
import { emptyHistoryState, mergeHistoryPage, type TrackedHistoryState } from '../dataSources/server/historyMerge';
import type { MatchRecord } from '../types/valorant';

export const historyPageSize = 50;

export type TrackedHistoryStatus = 'unavailable' | 'loading' | 'ready' | 'error';

export interface TrackedHistory extends TrackedHistoryState {
  status: TrackedHistoryStatus;
  loadMore(): void;
}

interface Options {
  loadHistory?: DatasetContextValue['loadHistory'];
  snapshotMatches: MatchRecord[];
  snapshotVersion?: string;
}

/**
 * TASK-DATA-03B.1 browse-only consumer. Starts strictly older than the bounded snapshot,
 * deduplicates by public match id and keeps everything in memory only.
 */
export function useTrackedHistory({ loadHistory, snapshotMatches, snapshotVersion }: Options): TrackedHistory {
  // State is scoped to the snapshot version it was loaded against; a new snapshot reads as empty
  // until its first history page arrives, so stale pages never mix with a refreshed snapshot.
  const [scoped, setScoped] = useState<{ version?: string; state: TrackedHistoryState; status: TrackedHistoryStatus }>(
    () => ({ version: snapshotVersion, state: emptyHistoryState(), status: 'loading' }),
  );
  const current = scoped.version === snapshotVersion ? scoped : { version: snapshotVersion, state: emptyHistoryState(), status: 'loading' as const };
  const state = current.state;
  const stateRef = useRef(state);
  const snapshotRef = useRef(snapshotMatches);
  const controller = useRef<AbortController | null>(null);
  const versionRef = useRef(snapshotVersion);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { versionRef.current = snapshotVersion; }, [snapshotVersion]);
  useEffect(() => { snapshotRef.current = snapshotMatches; }, [snapshotMatches]);

  const fetchPage = useCallback(async (query: DatasetHistoryQuery, reset: boolean) => {
    if (!loadHistory) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const version = versionRef.current;
    const base = reset ? emptyHistoryState() : stateRef.current;
    setScoped({ version, state: base, status: 'loading' });
    const request = async (pageQuery: DatasetHistoryQuery) => {
      const response = await loadHistory({ ...pageQuery, limit: historyPageSize }, abort.signal);
      if (!isDatasetHistoryResponse(response)) throw new Error('Unsupported history response.');
      return response;
    };
    try {
      let page;
      try {
        page = await request(query);
      } catch (error) {
        // The snapshot's oldest match may have become invisible since load; restart from the
        // newest page instead. Deduplication absorbs the overlap with the snapshot.
        if (!query.before || !(error instanceof BackendApiError) || error.code !== 'BAD_REQUEST') throw error;
        page = await request({});
      }
      if (abort.signal.aborted) return;
      const next = mergeHistoryPage(base, page, { matches: snapshotRef.current });
      stateRef.current = next;
      setScoped({ version, state: next, status: 'ready' });
    } catch {
      if (!abort.signal.aborted) setScoped({ version, state: base, status: 'error' });
    }
  }, [loadHistory]);

  useEffect(() => {
    if (!loadHistory) return undefined;
    stateRef.current = emptyHistoryState();
    // Server order is (started_at DESC, public_id DESC): within a tie the smallest id is oldest.
    const oldest = snapshotRef.current.reduce<MatchRecord | undefined>((current, match) => (
      !current || match.playedAt < current.playedAt || (match.playedAt === current.playedAt && match.id < current.id) ? match : current
    ), undefined);
    void fetchPage(oldest ? { before: oldest.id } : {}, true);
    return () => controller.current?.abort();
  }, [fetchPage, loadHistory, snapshotVersion]);

  const loadMore = useCallback(() => {
    const cursor = stateRef.current.nextCursor;
    if (cursor && stateRef.current.hasMore) void fetchPage({ cursor }, false);
  }, [fetchPage]);

  return { ...state, status: loadHistory ? current.status : 'unavailable', loadMore };
}
