import type { ApiRequest, ApiResponse } from '../../../server/contracts.js';
import { clientKey, readJsonBody, requireMethod, secureJson, sendError } from '../../../server/http.js';
import { enforceRateLimit } from '../../../server/rateLimit.js';
import { createHistoricalSyncService } from '../../../server/sync/runtime.js';
import { parseSyncStartInput } from '../../../server/validation.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'POST');
    enforceRateLimit(`sync-start:${clientKey(request)}`, Date.now(), 6);
    const input = parseSyncStartInput(readJsonBody(request));
    if (input.intent === 'refresh_if_stale') {
      // TASK-DATA-FASTSYNC-01: server-authoritative freshness; at most one bounded chunk.
      response.status(200).json({ ok: true, ...await createHistoricalSyncService().refreshIfStale(input.playerId) });
      return;
    }
    const sync = await createHistoricalSyncService().start(input.playerId, input.kind);
    response.status(200).json({ ok: true, sync });
  } catch (error) {
    sendError(response, error);
  }
}
