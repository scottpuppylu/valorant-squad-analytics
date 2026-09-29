import { createHash } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../../../server/contracts.js';
import { createHenrikDataProvider } from '../../../server/henrikDataProvider.js';
import { PublicApiError } from '../../../server/errors.js';
import { clientKey, readJsonBody, requireMethod, secureJson, sendError } from '../../../server/http.js';
import { withImportLock } from '../../../server/importLock.js';
import { enforceRateLimit } from '../../../server/rateLimit.js';
import { parseMatchImportInput } from '../../../server/validation.js';

function auditLockKey(client: string, gameName: string, tag: string): string {
  return createHash('sha256').update(`audit|${client}|${gameName.toLowerCase()}|${tag.toLowerCase()}`).digest('hex');
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'POST');
    const client = clientKey(request);
    enforceRateLimit(`audit:${client}`, Date.now(), 1);
    const input = parseMatchImportInput(readJsonBody(request));
    if (input.limit !== 3) throw new PublicApiError(400, 'BAD_REQUEST', '證據稽核固定使用三場受控樣本。');
    const audit = await withImportLock(auditLockKey(client, input.gameName, input.tag), () => (
      createHenrikDataProvider().auditEvidence(input)
    ));
    response.status(200).json({ ok: true, audit });
  } catch (error) {
    sendError(response, error);
  }
}
