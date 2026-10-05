import type { ApiRequest, ApiResponse } from '../../server/contracts.js';
import { createAnalyticsContextRepository, createDatasetProjectionService, createServerAnalysisService, datasetReadMode } from '../../server/dataset/runtime.js';
import { parseAnalysisRequest } from '../../server/dataset/analysisService.js';
import { buildAnalyticsContext } from '../../server/dataset/analyticsContext.js';
import { parseDatasetView, parseHistoryRequest } from '../../server/dataset/historyCursor.js';
import { datasetSchemaVersion } from '../../server/dataset/types.js';
import { requireMethod, secureJson, sendError } from '../../server/http.js';
import { enforceRateLimit } from '../../server/rateLimit.js';
import { clientKey } from '../../server/http.js';

/**
 * Absent `view`: unchanged schema 4 newest-300 snapshot.
 * `view=history`: DATA-03B.1 bounded keyset page (browse only).
 * `view=analytics`: DATA-03B.2A aggregate population/evidence facts for scope labels.
 * `view=analysis`: DATA-03B.2B server-resolved feature population over all durable history.
 * All served by this same function to stay within the 12-function Vercel Hobby limit.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  secureJson(response);
  try {
    requireMethod(request, 'GET');
    const view = parseDatasetView(request.query);
    enforceRateLimit(`dataset-${view === 'snapshot' ? 'read' : view}:${clientKey(request)}`, Date.now(), view === 'analysis' ? 60 : 30);
    if (datasetReadMode() !== 'public') {
      response.status(200).json({ ok: true, schemaVersion: datasetSchemaVersion, state: 'disabled', source: 'REAL_SERVER' });
      return;
    }
    if (view === 'analysis') {
      const analysisRequest = parseAnalysisRequest(request.query);
      const { payload, metrics } = await createServerAnalysisService().analyze(analysisRequest);
      // Phase durations only (no identifiers) for production latency diagnosis.
      response.setHeader('Server-Timing', `phase1;dur=${metrics.phase1Ms}, resolve;dur=${metrics.resolveMs}, phase2;dur=${metrics.phase2Ms}, total;dur=${metrics.totalMs}`);
      response.status(200).json(payload);
      return;
    }
    if (view === 'analytics') {
      response.status(200).json(buildAnalyticsContext(await createAnalyticsContextRepository().readContextRows()));
      return;
    }
    if (view === 'history') {
      const historyRequest = parseHistoryRequest(request.query);
      const result = await createDatasetProjectionService().readHistory(historyRequest);
      response.status(200).json(result.payload);
      return;
    }
    const result = await createDatasetProjectionService().read();
    response.status(200).json(result.payload);
  } catch (error) {
    sendError(response, error);
  }
}
