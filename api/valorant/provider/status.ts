import { createHenrikDataProvider } from '../../../server/henrikDataProvider';
import { requireMethod, secureJson, sendError } from '../../../server/http';
import type { ApiRequest, ApiResponse } from '../../../server/contracts';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'GET');
    response.status(200).json({ ok: true, provider: createHenrikDataProvider().status() });
  } catch (error) {
    sendError(response, error);
  }
}
