import type { ApiRequest, ApiResponse } from '../../../server/contracts.js';
import { createRevocationDeletionService } from '../../../server/deletion/runtime.js';
import { clientKey, readJsonBody, requireMethod, secureJson, sendError } from '../../../server/http.js';
import { enforceRateLimit } from '../../../server/rateLimit.js';
import { parseRevocationInput } from '../../../server/validation.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'POST');
    enforceRateLimit(`consent-revoke:${clientKey(request)}`, Date.now(), 4);
    const input = parseRevocationInput(readJsonBody(request));
    const service = createRevocationDeletionService();
    const pending = await service.revoke(input.playerId, input.managementCredential);
    const deletion = pending.status === 'complete'
      ? pending
      : await service.continue(pending.jobId, input.managementCredential);
    response.status(200).json({ ok: true, deletion });
  } catch (error) {
    sendError(response, error);
  }
}
