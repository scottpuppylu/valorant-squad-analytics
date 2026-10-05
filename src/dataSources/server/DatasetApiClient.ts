import { valorantBackendClient } from './ValorantBackendClient';
import type { DatasetDisabledResponse, DatasetHistoryQuery, DatasetHistoryResponse, DatasetResponse } from './contracts';

export interface DatasetApiClient {
  load(signal?: AbortSignal): Promise<DatasetResponse>;
  /** Optional DATA-03B.1 bounded history page; absent clients never request history. */
  loadHistory?(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse | DatasetDisabledResponse>;
}

export class ServerDatasetApiClient implements DatasetApiClient {
  load(signal?: AbortSignal): Promise<DatasetResponse> {
    return valorantBackendClient.dataset(signal);
  }

  loadHistory(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse | DatasetDisabledResponse> {
    return valorantBackendClient.datasetHistory(query, signal);
  }
}

export const serverDatasetApiClient = new ServerDatasetApiClient();
