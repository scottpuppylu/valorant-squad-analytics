import { resolve } from 'node:path';
import { applyMigrations, loadMigrations } from '../server/db/migrations.js';
import { createDatabase } from '../server/db/runtime.js';

if (process.env.VERCEL_ENV !== 'production') {
  process.stdout.write('Skipping database migrations outside Vercel Production.\n');
} else {
  const database = createDatabase();
  if (!database) throw new Error('DATABASE_URL is required for Vercel Production migrations.');

  try {
    const migrations = await loadMigrations(resolve('migrations'));
    const applied = await applyMigrations(database, migrations);
    process.stdout.write(applied.length > 0
      ? `Applied production migrations: ${applied.join(', ')}\n`
      : 'Production database is already up to date.\n');
  } finally {
    await database.close();
  }
}
