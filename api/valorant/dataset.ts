import type { ApiRequest, ApiResponse } from '../../server/contracts.js';
import { createDatasetProjectionService, datasetReadMode } from '../../server/dataset/runtime.js';
import { datasetSchemaVersion } from '../../server/dataset/types.js';
import { requireMethod, secureJson, sendError } from '../../server/http.js';
import { enforceRateLimit } from '../../server/rateLimit.js';
import { clientKey } from '../../server/http.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'GET');
    enforceRateLimit(`dataset-read:${clientKey(request)}`, Date.now(), 30);
    if (datasetReadMode() !== 'public') {
      response.status(200).json({ ok: true, schemaVersion: datasetSchemaVersion, state: 'disabled', source: 'REAL_SERVER' });
      return;
    }
    const result = await createDatasetProjectionService().read();
    response.status(200).json(result.payload);
  } catch (error) {
    sendError(response, error);
  }
}
