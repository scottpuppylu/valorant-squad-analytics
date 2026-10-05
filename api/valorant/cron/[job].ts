import { createCronRouter } from '../../../server/sync/cronHandler.js';
import { createScheduledSyncService } from '../../../server/sync/scheduledRuntime.js';

export default createCronRouter(createScheduledSyncService);
