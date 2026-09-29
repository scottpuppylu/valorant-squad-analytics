import { createHash } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../../../server/contracts.js';
import { createHenrikDataProvider } from '../../../server/henrikDataProvider.js';
import { clientKey, readJsonBody, requireMethod, secureJson, sendError } from '../../../server/http.js';
import { withImportLock } from '../../../server/importLock.js';
import { enforceRateLimit } from '../../../server/rateLimit.js';
import { parseMatchImportInput } from '../../../server/validation.js';

function lockKey(client: string, gameName: string, tag: string): string {
  return createHash('sha256').update(`${client}|${gameName.toLowerCase()}|${tag.toLowerCase()}`).digest('hex');
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'POST');
    const client = clientKey(request);
    enforceRateLimit(`import:${client}`);
    const input = parseMatchImportInput(readJsonBody(request));
    const result = await withImportLock(lockKey(client, input.gameName, input.tag), () => (
      createHenrikDataProvider().importMatches(input)
    ));
    response.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendError(response, error);
  }
}
