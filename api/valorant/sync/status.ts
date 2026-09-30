import type { ApiRequest, ApiResponse } from '../../../server/contracts.js';
import { clientKey, requireMethod, secureJson, sendError } from '../../../server/http.js';
import { enforceRateLimit } from '../../../server/rateLimit.js';
import { createHistoricalSyncService } from '../../../server/sync/runtime.js';
import { parseSyncStatusQuery } from '../../../server/validation.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'GET');
    enforceRateLimit(`sync-status:${clientKey(request)}`, Date.now(), 30);
    const sync = await createHistoricalSyncService().status(parseSyncStatusQuery(request.query?.runId));
    response.status(200).json({ ok: true, sync });
  } catch (error) {
    sendError(response, error);
  }
}
