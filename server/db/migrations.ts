import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { SqlDatabase, SqlExecutor } from './types.js';

export interface Migration {
  version: string;
  name: string;
  statements: string[];
}

const migrationPattern = /^(\d{4})_([a-z0-9_]+)\.sql$/u;

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => migrationPattern.test(name)).sort();
  const migrations = await Promise.all(names.map(async (name) => {
    const match = migrationPattern.exec(name);
    if (!match) throw new Error(`Invalid migration filename: ${name}`);
    const source = await readFile(join(directory, name), 'utf8');
    const statements = source.split(/^\s*-- statement-breakpoint\s*$/gmu).map((statement) => statement.trim()).filter(Boolean);
    return { version: match[1]!, name: basename(name), statements };
  }));
  const versions = new Set(migrations.map((migration) => migration.version));
  if (versions.size !== migrations.length) throw new Error('Migration versions must be unique.');
  return migrations;
}

async function ensureMigrationTable(database: SqlExecutor): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function applyMigrations(database: SqlDatabase, migrations: Migration[]): Promise<string[]> {
  await ensureMigrationTable(database);
  const applied = await database.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.rows.map((row) => row.version));
  const newlyApplied: string[] = [];

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    await database.transaction(async (transaction) => {
      for (const statement of migration.statements) await transaction.query(statement);
      await transaction.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name],
      );
    });
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}
