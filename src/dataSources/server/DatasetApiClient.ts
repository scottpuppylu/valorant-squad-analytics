import { valorantBackendClient } from './ValorantBackendClient';
import type { DatasetAnalyticsContextResponse, DatasetDisabledResponse, DatasetHistoryQuery, DatasetHistoryResponse, DatasetResponse } from './contracts';

export interface DatasetApiClient {
  load(signal?: AbortSignal): Promise<DatasetResponse>;
  /** Optional DATA-03B.1 bounded history page; absent clients never request history. */
  loadHistory?(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse | DatasetDisabledResponse>;
  /** Optional DATA-03B.2A aggregate facts; absent clients keep population coverage 'unverified'. */
  loadAnalyticsContext?(signal?: AbortSignal): Promise<DatasetAnalyticsContextResponse | DatasetDisabledResponse>;
}

export class ServerDatasetApiClient implements DatasetApiClient {
  load(signal?: AbortSignal): Promise<DatasetResponse> {
    return valorantBackendClient.dataset(signal);
  }

  loadAnalyticsContext(signal?: AbortSignal): Promise<DatasetAnalyticsContextResponse | DatasetDisabledResponse> {
    return valorantBackendClient.datasetAnalyticsContext(signal);
  }

  loadHistory(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse | DatasetDisabledResponse> {
    return valorantBackendClient.datasetHistory(query, signal);
  }
}

export const serverDatasetApiClient = new ServerDatasetApiClient();
