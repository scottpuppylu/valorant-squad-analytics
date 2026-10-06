import { valorantBackendClient } from './ValorantBackendClient';
import type { AnalysisQuery, DatasetAnalysisResponse } from './analysisResult';
import type { WeaponQuery } from '../../analytics/weapons/local';
import type { WeaponAnalyticsResponse } from './weaponContract';
import type { DatasetAnalyticsContextResponse, DatasetDisabledResponse, DatasetHistoryQuery, DatasetHistoryResponse, DatasetResponse, RecentRefreshResponse } from './contracts';

export interface DatasetApiClient {
  load(signal?: AbortSignal): Promise<DatasetResponse>;
  /** Optional DATA-03B.1 bounded history page; absent clients never request history. */
  loadHistory?(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse | DatasetDisabledResponse>;
  /** Optional DATA-03B.2A aggregate facts; absent clients keep population coverage 'unverified'. */
  loadAnalyticsContext?(signal?: AbortSignal): Promise<DatasetAnalyticsContextResponse | DatasetDisabledResponse>;
  /** Optional DATA-03B.2B server analysis; absent clients (Demo, tests) analyse the local dataset. */
  loadAnalysis?(query: AnalysisQuery, signal?: AbortSignal): Promise<DatasetAnalysisResponse | DatasetDisabledResponse>;
  /** Optional TASK-WEAPON-01 server weapon analytics; absent clients (Demo, tests) compute locally. */
  loadWeaponAnalytics?(query: WeaponQuery, signal?: AbortSignal): Promise<WeaponAnalyticsResponse | DatasetDisabledResponse>;
  /** Optional TASK-DATA-FASTSYNC-01 refresh-if-stale for one public ACCOUNT id; absent in Demo/tests. */
  refreshRecent?(accountId: string): Promise<RecentRefreshResponse>;
}

export class ServerDatasetApiClient implements DatasetApiClient {
  load(signal?: AbortSignal): Promise<DatasetResponse> {
    return valorantBackendClient.dataset(signal);
  }

  loadAnalysis(query: AnalysisQuery, signal?: AbortSignal): Promise<DatasetAnalysisResponse | DatasetDisabledResponse> {
    return valorantBackendClient.datasetAnalysis(query, signal);
  }

  loadAnalyticsContext(signal?: AbortSignal): Promise<DatasetAnalyticsContextResponse | DatasetDisabledResponse> {
    return valorantBackendClient.datasetAnalyticsContext(signal);
  }

  loadWeaponAnalytics(query: WeaponQuery, signal?: AbortSignal): Promise<WeaponAnalyticsResponse | DatasetDisabledResponse> {
    return valorantBackendClient.weaponAnalytics(query, signal);
  }

  refreshRecent(accountId: string): Promise<RecentRefreshResponse> {
    return valorantBackendClient.refreshRecent(accountId);
  }

  loadHistory(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse | DatasetDisabledResponse> {
    return valorantBackendClient.datasetHistory(query, signal);
  }
}

export const serverDatasetApiClient = new ServerDatasetApiClient();
