import { timingSafeEqual } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../contracts.js';
import { PublicApiError } from '../errors.js';
import { requireMethod, secureJson, sendError } from '../http.js';
import type { ScheduledJob, ScheduledSyncService } from './scheduledSyncService.js';

export function createCronHandler(job: ScheduledJob, factory: () => ScheduledSyncService) {
  return async (request: ApiRequest, response: ApiResponse) => {
    secureJson(response);
    try {
      requireMethod(request, 'GET');
      const secret = process.env.CRON_SECRET;
      if (!secret) throw new PublicApiError(503, 'CRON_UNCONFIGURED', '自動同步尚未啟用。');
      const supplied = request.headers.authorization;
      const expected = Buffer.from(`Bearer ${secret}`);
      const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new PublicApiError(401, 'UNAUTHORIZED', '此操作需要排程授權。');
      }
      const result = await factory().run(job);
      response.status(200).json({ ok: true, ...result });
    } catch (error) { sendError(response, error); }
  };
}
