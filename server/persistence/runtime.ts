import { createNeonDatabase } from '../db/neon.js';
import { DurableEvidenceService } from './durableEvidenceService.js';

let singleton: DurableEvidenceService | undefined;

export function createDurableEvidenceWriter(): DurableEvidenceService | undefined {
  const hasDatabase = Boolean(process.env.DATABASE_URL);
  const hasHmacKey = Boolean(process.env.IDENTIFIER_HMAC_KEY);
  if (!hasDatabase && !hasHmacKey) return undefined;
  if (!hasDatabase || !hasHmacKey) throw new Error('Durable evidence persistence requires both server-only database settings.');
  if (singleton) return singleton;
  const database = createNeonDatabase();
  if (!database) throw new Error('Durable evidence database is unavailable.');
  singleton = new DurableEvidenceService(database, process.env.IDENTIFIER_HMAC_KEY!);
  return singleton;
}
