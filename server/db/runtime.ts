import { PostgresDatabase, type PostgresPoolOptions } from './postgres.js';

/**
 * TASK-INFRA-DATABASE-PORTABILITY-01 database runtime factory. The only configuration is the standard
 * PostgreSQL connection string `DATABASE_URL`; no provider-specific settings exist.
 *
 * - `createDatabase()`  — a NEW database handle owned by the caller (scripts); the caller must `close()` it.
 * - `getSharedDatabase()` — ONE bounded pool per process for request-serving runtime factories.
 */
function poolOptionsFromEnv(): PostgresPoolOptions {
  const integer = (name: string) => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return undefined;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
    return value;
  };
  const max = integer('DATABASE_POOL_MAX');
  if (max !== undefined && max > 20) throw new Error('DATABASE_POOL_MAX must not exceed 20 for this workload.');
  return {
    ...(max !== undefined ? { max } : {}),
    ...(integer('DATABASE_STATEMENT_TIMEOUT_MS') !== undefined ? { statementTimeoutMillis: integer('DATABASE_STATEMENT_TIMEOUT_MS') } : {}),
  };
}

export function createDatabase(options?: PostgresPoolOptions): PostgresDatabase | undefined {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  return new PostgresDatabase(connectionString, { ...poolOptionsFromEnv(), ...options });
}

let shared: PostgresDatabase | undefined;
export function getSharedDatabase(): PostgresDatabase | undefined {
  shared ??= createDatabase();
  return shared;
}

/** Tests only: drop the process-wide handle (does not close it). */
export function resetSharedDatabaseForTests(): void {
  shared = undefined;
}
