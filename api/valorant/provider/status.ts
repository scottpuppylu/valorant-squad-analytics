import { createHenrikDataProvider } from '../../../server/henrikDataProvider.js';
import { requireMethod, secureJson, sendError } from '../../../server/http.js';
import type { ApiRequest, ApiResponse } from '../../../server/contracts.js';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'GET');
    response.status(200).json({ ok: true, provider: createHenrikDataProvider().status() });
  } catch (error) {
    sendError(response, error);
  }
}
