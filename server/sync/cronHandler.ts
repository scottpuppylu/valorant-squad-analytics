import { timingSafeEqual } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../contracts.js';
import { PublicApiError } from '../errors.js';
import { requireMethod, secureJson, sendError } from '../http.js';
import type { ScheduledJob, ScheduledSyncService } from './scheduledSyncService.js';

/** One deployed function retains both job URLs within the Hobby function limit. */
export function createCronRouter(factory: () => ScheduledSyncService) {
  const handlers = {
    recent: createCronHandler('recent', factory),
    history: createCronHandler('history', factory),
  };
  return async (request: ApiRequest, response: ApiResponse) => {
    const job = request.query?.job;
    if (job !== 'recent' && job !== 'history') {
      secureJson(response);
      sendError(response, new PublicApiError(404, 'BAD_REQUEST', '找不到此同步工作。'));
      return;
    }
    await handlers[job](request, response);
  };
}

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
