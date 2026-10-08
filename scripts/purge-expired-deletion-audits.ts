import { createDatabase } from '../server/db/runtime.js';
import { DeletionRetentionService } from '../server/deletion/retentionService.js';

const database = createDatabase();
if (!database) throw new Error('DATABASE_URL is required for deletion retention cleanup.');
try {
  const result = await new DeletionRetentionService(database).purgeExpired();
  process.stdout.write(`${JSON.stringify({ event: 'deletion_retention_cleanup', ...result })}\n`);
} finally {
  await database.close();
}
