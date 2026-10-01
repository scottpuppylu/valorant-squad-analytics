import { createContext } from 'react';
import type { DatasetAnalytics } from '../data/analytics';
import type { DatasetCoverageContract, DatasetEvidenceContract, DatasetSnapshotContract } from '../dataSources/server/contracts';
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
  refresh(): Promise<void>;
}

export const DatasetContext = createContext<DatasetContextValue | null>(null);
