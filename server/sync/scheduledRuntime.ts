import { createNeonDatabase } from '../db/neon.js';
import { PostgresSyncStore } from './postgresSyncStore.js';
import { createHistoricalSyncService } from './runtime.js';
import { ScheduledSyncService } from './scheduledSyncService.js';

let singleton: ScheduledSyncService | undefined;
export function createScheduledSyncService() {
  if (singleton) return singleton;
  const database = createNeonDatabase();
  if (!database) throw new Error('Scheduled synchronization database is unavailable.');
  singleton = new ScheduledSyncService(new PostgresSyncStore(database), createHistoricalSyncService());
  return singleton;
}
