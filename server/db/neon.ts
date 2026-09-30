import { Pool } from '@neondatabase/serverless';
import type { SqlDatabase, SqlExecutor, SqlResult } from './types.js';

function result<Row extends Record<string, unknown>>(value: { rows: Row[]; rowCount: number | null }): SqlResult<Row> {
  return { rows: value.rows, rowCount: value.rowCount ?? value.rows.length };
}

export class NeonDatabase implements SqlDatabase {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    return result(await this.pool.query<Row>(sql, params));
  }

  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const transaction: SqlExecutor = {
        query: async <Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (
          result(await client.query<Row>(sql, params))
        ),
      };
      const value = await work(transaction);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createNeonDatabase(): NeonDatabase | undefined {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  return new NeonDatabase(connectionString);
}
