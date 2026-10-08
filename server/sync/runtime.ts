import { getSharedDatabase } from '../db/runtime.js';
import { HenrikDataProvider } from '../henrikDataProvider.js';
import { DurableEvidenceService } from '../persistence/durableEvidenceService.js';
import { HistoricalSyncService } from './historicalSyncService.js';
import { PostgresSyncStore } from './postgresSyncStore.js';

let singleton: HistoricalSyncService | undefined;

export function createHistoricalSyncService(): HistoricalSyncService {
  if (singleton) return singleton;
  const databaseUrl = process.env.DATABASE_URL;
  const hmacKey = process.env.IDENTIFIER_HMAC_KEY;
  const apiKey = process.env.HENRIK_API_KEY;
  if (!databaseUrl || !hmacKey || !apiKey) {
    throw new Error('Historical synchronization requires all server-only production settings.');
  }
  const database = getSharedDatabase();
  if (!database) throw new Error('Historical synchronization database is unavailable.');
  singleton = new HistoricalSyncService(
    new PostgresSyncStore(database),
    new DurableEvidenceService(database, hmacKey),
    new HenrikDataProvider(apiKey, { retries: 0 }),
    hmacKey,
  );
  return singleton;
}
