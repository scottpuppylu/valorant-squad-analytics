import { createHash } from 'node:crypto';
import type { ApiRequest, ApiResponse, ProviderEvidenceAuditResult, ProviderPerformanceScoreAudit } from '../../../server/contracts.js';
import { createHenrikDataProvider } from '../../../server/henrikDataProvider.js';
import { PublicApiError } from '../../../server/errors.js';
import { clientKey, readJsonBody, requireMethod, secureJson, sendError } from '../../../server/http.js';
import { withImportLock } from '../../../server/importLock.js';
import { enforceRateLimit } from '../../../server/rateLimit.js';
import { parseMatchImportInput } from '../../../server/validation.js';
import { assertProviderAuditAllowed } from '../../../server/providerAuditAccess.js';

function auditLockKey(client: string, gameName: string, tag: string): string {
  return createHash('sha256').update(`audit|${client}|${gameName.toLowerCase()}|${tag.toLowerCase()}`).digest('hex');
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'POST');
    assertProviderAuditAllowed();
    const client = clientKey(request);
    enforceRateLimit(`audit:${client}`, Date.now(), 1);
    const body = readJsonBody(request);
    const mode = typeof body === 'object' && body !== null && 'mode' in body ? (body as { mode?: unknown }).mode : undefined;
    if (mode !== undefined && mode !== 'performance-score') throw new PublicApiError(400, 'BAD_REQUEST', '稽核模式不正確。');
    const input = parseMatchImportInput(body);
    if (input.limit !== 3) throw new PublicApiError(400, 'BAD_REQUEST', '證據稽核固定使用三場受控樣本。');
    const provider = createHenrikDataProvider();
    // TASK-DATA-PERFORMANCE-SCORE-01: shape-only mode (≤ 2 logical requests) beside the generic audit.
    const audit = await withImportLock<ProviderEvidenceAuditResult | ProviderPerformanceScoreAudit>(auditLockKey(client, input.gameName, input.tag), () => (
      mode === 'performance-score' ? provider.auditPerformanceScoreShape(input) : provider.auditEvidence(input)
    ));
    response.status(200).json({ ok: true, audit });
  } catch (error) {
    sendError(response, error);
  }
}
