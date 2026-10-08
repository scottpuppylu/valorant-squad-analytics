import { resolve } from 'node:path';
import { applyMigrations, loadMigrations } from '../server/db/migrations.js';
import { createDatabase } from '../server/db/runtime.js';

const database = createDatabase();
if (!database) throw new Error('DATABASE_URL is required to run migrations.');

try {
  const migrations = await loadMigrations(resolve('migrations'));
  const applied = await applyMigrations(database, migrations);
  process.stdout.write(applied.length > 0 ? `Applied migrations: ${applied.join(', ')}\n` : 'Database is already up to date.\n');
} finally {
  await database.close();
}
