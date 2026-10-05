import { createContext } from 'react';
import type { DatasetAnalytics } from '../data/analytics';
import type { DatasetAnalyticsContextResponse, DatasetCoverageContract, DatasetEvidenceContract, DatasetSnapshotContract, RecentRefreshOutcome } from '../dataSources/server/contracts';
import type { DatasetApiClient } from '../dataSources/server/DatasetApiClient';
import type { NormalizedAnalyticsDataset } from '../dataSources/types';

export type DatasetRuntimeStatus = 'loading' | 'ready' | 'stale' | 'empty' | 'error' | 'demo';
export type DatasetRuntimeSource = 'DEMO' | 'REAL_SERVER';

export interface DatasetContextValue {
  status: DatasetRuntimeStatus;
  source: DatasetRuntimeSource;
  dataset: NormalizedAnalyticsDataset;
  analytics: DatasetAnalytics;
  snapshot?: DatasetSnapshotContract;
  coverage?: DatasetCoverageContract;
  evidence?: DatasetEvidenceContract;
  message?: string;
  /** Present only for the PUBLIC REAL server runtime; Demo/Pages never request history. */
  loadHistory?: NonNullable<DatasetApiClient['loadHistory']>;
  /** DATA-03B.2A aggregate facts for the current REAL snapshot, when loaded. */
  analyticsContext?: DatasetAnalyticsContextResponse;
  /** DATA-03B.2B server analysis loader; present only for PUBLIC REAL. */
  loadAnalysis?: NonNullable<DatasetApiClient['loadAnalysis']>;
  /**
   * TASK-DATA-FASTSYNC-01, PUBLIC REAL only. 'auto' runs at most once per player per tab; 'manual'
   * asks again. Both obey the server freshness gate; new durable matches reload the snapshot,
   * which also clears the per-tab analysis cache.
   */
  refreshRecent?(playerId: string, mode: 'auto' | 'manual'): Promise<RecentRefreshOutcome>;
  refresh(): Promise<void>;
}

export const DatasetContext = createContext<DatasetContextValue | null>(null);
