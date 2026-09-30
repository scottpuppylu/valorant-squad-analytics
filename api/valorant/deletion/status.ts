import type { ApiRequest, ApiResponse } from '../../../server/contracts.js';
import { createRevocationDeletionService } from '../../../server/deletion/runtime.js';
import { clientKey, readJsonBody, requireMethod, secureJson, sendError } from '../../../server/http.js';
import { enforceRateLimit } from '../../../server/rateLimit.js';
import { parseDeletionInput } from '../../../server/validation.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'POST');
    enforceRateLimit(`deletion-status:${clientKey(request)}`, Date.now(), 20);
    const input = parseDeletionInput(readJsonBody(request));
    const deletion = await createRevocationDeletionService().status(input.jobId, input.managementCredential);
    response.status(200).json({ ok: true, deletion });
  } catch (error) {
    sendError(response, error);
  }
}
