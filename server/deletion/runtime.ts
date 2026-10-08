import { getSharedDatabase } from '../db/runtime.js';
import { RevocationDeletionService } from './revocationDeletionService.js';

let singleton: RevocationDeletionService | undefined;

export function createRevocationDeletionService(): RevocationDeletionService {
  if (singleton) return singleton;
  const databaseUrl = process.env.DATABASE_URL;
  const hmacKey = process.env.IDENTIFIER_HMAC_KEY;
  if (!databaseUrl || !hmacKey) throw new Error('Consent revocation requires both server-only database settings.');
  const database = getSharedDatabase();
  if (!database) throw new Error('Consent revocation database is unavailable.');
  singleton = new RevocationDeletionService(database, hmacKey);
  return singleton;
}
