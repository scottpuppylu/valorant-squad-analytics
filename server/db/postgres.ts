import pg from 'pg';
import type { SqlDatabase, SqlExecutor, SqlResult } from './types.js';

/**
 * TASK-INFRA-DATABASE-PORTABILITY-01: the Production SqlDatabase over standard PostgreSQL (`pg`, node-postgres).
 * PostgreSQL itself is the persistence contract; no provider SDK is involved. Pool sizes are deliberately small
 * (9-account private community + bounded background jobs), never hyperscale defaults.
 */
export interface PostgresPoolOptions {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  /** Per-statement server-side cap; protects against a runaway query holding the pool. */
  statementTimeoutMillis?: number;
  applicationName?: string;
}

export const DEFAULT_POOL_OPTIONS: Required<PostgresPoolOptions> = {
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statementTimeoutMillis: 55_000,
  applicationName: 'valorant-squad-analytics',
};

/** Cumulative, identifier-free usage counters (health/telemetry). Rows are exact driver counts. */
export interface DatabaseUsage { queries: number; transactions: number; rollbacks: number; rowsReturned: number; rowsAffected: number; errors: number }

function result<Row extends Record<string, unknown>>(value: { rows: Row[]; rowCount: number | null; command?: string }, usage: DatabaseUsage): SqlResult<Row> {
  usage.queries += 1;
  usage.rowsReturned += value.rows.length;
  if (value.command && value.command !== 'SELECT') usage.rowsAffected += value.rowCount ?? 0;
  return { rows: value.rows, rowCount: value.rowCount ?? value.rows.length };
}

export class PostgresDatabase implements SqlDatabase {
  private readonly pool: pg.Pool;
  readonly usage: DatabaseUsage = { queries: 0, transactions: 0, rollbacks: 0, rowsReturned: 0, rowsAffected: 0, errors: 0 };

  constructor(connectionString: string, options: PostgresPoolOptions = {}) {
    const settings = { ...DEFAULT_POOL_OPTIONS, ...options };
    this.pool = new pg.Pool({
      connectionString,
      max: settings.max,
      idleTimeoutMillis: settings.idleTimeoutMillis,
      connectionTimeoutMillis: settings.connectionTimeoutMillis,
      statement_timeout: settings.statementTimeoutMillis,
      application_name: settings.applicationName,
    });
    // An idle client error (e.g. server restart) must not crash the process; the next query reconnects.
    this.pool.on('error', () => { this.usage.errors += 1; });
  }

  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    try { return result(await this.pool.query<Row>(sql, params), this.usage); }
    catch (error) { this.usage.errors += 1; throw error; }
  }

  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    this.usage.transactions += 1;
    let released = false;
    try {
      await client.query('BEGIN');
      const transaction: SqlExecutor = {
        query: async <Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) => result(await client.query<Row>(sql, params), this.usage),
      };
      const value = await work(transaction);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      this.usage.rollbacks += 1;
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { client.release(rollbackError as Error); released = true; }
      throw error;
    } finally {
      if (!released) client.release();
    }
  }

  /** Lightweight pool stats for health (no identifiers). */
  stats() {
    return { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount, ...this.usage };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
