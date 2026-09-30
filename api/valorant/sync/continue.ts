import type { ApiRequest, ApiResponse } from '../../../server/contracts.js';
import { clientKey, readJsonBody, requireMethod, secureJson, sendError } from '../../../server/http.js';
import { enforceRateLimit } from '../../../server/rateLimit.js';
import { createHistoricalSyncService } from '../../../server/sync/runtime.js';
import { parseSyncContinueInput } from '../../../server/validation.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'POST');
    enforceRateLimit(`sync-continue:${clientKey(request)}`, Date.now(), 10);
    const input = parseSyncContinueInput(readJsonBody(request));
    const sync = await createHistoricalSyncService().continue(input.runId);
    response.status(200).json({ ok: true, sync });
  } catch (error) {
    sendError(response, error);
  }
}
