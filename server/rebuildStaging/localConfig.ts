import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PostgresDatabase } from '../db/postgres.js';

/**
 * Private local configuration for the maintainer-only staging tools (rebuild collector, rank ingestion).
 * Secrets live only in ~/.vsa-rebuild/*.env (directory 700, files 600) and are never printed.
 */
export const REBUILD_HOME = process.env.VSA_REBUILD_HOME ?? join(homedir(), '.vsa-rebuild');

export function privateFile(name: string): string {
  const path = join(REBUILD_HOME, name);
  if (process.platform !== 'win32') {
    if ((statSync(REBUILD_HOME).mode & 0o077) !== 0) throw new Error(`${REBUILD_HOME} must be mode 700.`);
    if ((statSync(path).mode & 0o077) !== 0) throw new Error(`${name} must be mode 600.`);
  }
  return path;
}

export function envValue(name: string, key: string): string {
  for (const line of readFileSync(privateFile(name), 'utf8').split(/\r?\n/u)) {
    const index = line.indexOf('=');
    if (index > 0 && line.slice(0, index).trim() === key) {
      const value = line.slice(index + 1).trim();
      if (value) return value;
    }
  }
  throw new Error(`${key} is missing in ${name}.`);
}

/** Only the loopback private staging database (valorant_rebuild_staging*) can be opened. */
export function openStagingDatabase(options: { port?: number; database?: string; applicationName: string }): PostgresDatabase {
  const password = envValue('staging-db.env', 'POSTGRES_PASSWORD');
  const name = options.database ?? 'valorant_rebuild_staging';
  if (!/^valorant_rebuild_staging[a-z0-9_]*$/u.test(name)) throw new Error('only the private rebuild staging database is allowed.');
  return new PostgresDatabase(`postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${options.port ?? 55903}/${name}`,
    { max: 4, applicationName: options.applicationName });
}
