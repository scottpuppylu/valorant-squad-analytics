import { valorantBackendClient } from './ValorantBackendClient';
import type { DatasetResponse } from './contracts';

export interface DatasetApiClient {
  load(signal?: AbortSignal): Promise<DatasetResponse>;
}

export class ServerDatasetApiClient implements DatasetApiClient {
  load(signal?: AbortSignal): Promise<DatasetResponse> {
    return valorantBackendClient.dataset(signal);
  }
}

export const serverDatasetApiClient = new ServerDatasetApiClient();
