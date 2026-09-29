import type { ApiRequest, ApiResponse } from '../../../server/contracts';
import { createHenrikDataProvider } from '../../../server/henrikDataProvider';
import { clientKey, readJsonBody, requireMethod, secureJson, sendError } from '../../../server/http';
import { enforceRateLimit } from '../../../server/rateLimit';
import { parseConnectionInput } from '../../../server/validation';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'POST');
    enforceRateLimit(`resolve:${clientKey(request)}`);
    const input = parseConnectionInput(readJsonBody(request));
    const result = await createHenrikDataProvider().resolveAccount(input);
    response.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendError(response, error);
  }
}
