import { valorantBackendClient } from './ValorantBackendClient';
import type { AnalysisQuery, DatasetAnalysisResponse } from './analysisResult';
import type { DatasetAnalyticsContextResponse, DatasetDisabledResponse, DatasetHistoryQuery, DatasetHistoryResponse, DatasetResponse } from './contracts';

export interface DatasetApiClient {
  load(signal?: AbortSignal): Promise<DatasetResponse>;
  /** Optional DATA-03B.1 bounded history page; absent clients never request history. */
  loadHistory?(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse | DatasetDisabledResponse>;
  /** Optional DATA-03B.2A aggregate facts; absent clients keep population coverage 'unverified'. */
  loadAnalyticsContext?(signal?: AbortSignal): Promise<DatasetAnalyticsContextResponse | DatasetDisabledResponse>;
  /** Optional DATA-03B.2B server analysis; absent clients (Demo, tests) analyse the local dataset. */
  loadAnalysis?(query: AnalysisQuery, signal?: AbortSignal): Promise<DatasetAnalysisResponse | DatasetDisabledResponse>;
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

  loadHistory(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse | DatasetDisabledResponse> {
    return valorantBackendClient.datasetHistory(query, signal);
  }
}

export const serverDatasetApiClient = new ServerDatasetApiClient();
