import { createCronHandler } from '../../../server/sync/cronHandler.js';
import { createScheduledSyncService } from '../../../server/sync/scheduledRuntime.js';

export default createCronHandler('recent', createScheduledSyncService);
