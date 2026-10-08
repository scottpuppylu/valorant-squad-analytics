import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';

/**
 * TASK-INFRA-DATABASE-PORTABILITY-01. The SqlDatabase contract the application relies on, exercised as a
 * shared suite against:
 *  - PGlite (real PostgreSQL compiled to WASM) — always, in CI;
 *  - a real PostgreSQL server through the Production adapter (`PostgresDatabase` / `pg`) — `requires-real-postgres`:
 *    runs only when TEST_DATABASE_URL points at a disposable database (e.g. the Docker rehearsal stack).
 * The Production adapter's transaction/release/error discipline is additionally unit-tested with a mocked `pg`.
 */
class PGliteDatabase implements SqlDatabase {
  constructor(readonly pg: PGlite) {}
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.pg.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.pg.exec('BEGIN');
    try { const value = await work(this); await this.pg.exec('COMMIT'); return value; }
    catch (error) { await this.pg.exec('ROLLBACK'); throw error; }
  }
  async close() { await this.pg.close(); }
}

function contractSuite(name: string, open: () => Promise<SqlDatabase>, enabled = true) {
  describe.skipIf(!enabled)(`SqlDatabase contract — ${name}`, () => {
    let db: SqlDatabase;
    beforeEach(async () => {
      db = await open();
      await db.query('DROP TABLE IF EXISTS portability_probe');
      await db.query(`CREATE TABLE portability_probe (id integer PRIMARY KEY, label text NOT NULL UNIQUE, payload json, doc jsonb, at timestamptz, amount numeric)`);
    });
    afterEach(async () => { await db.query('DROP TABLE IF EXISTS portability_probe'); await db.close(); });

    it('parameterized query, rowCount and typed values (json, jsonb, timestamptz, numeric)', async () => {
      const inserted = await db.query('INSERT INTO portability_probe VALUES ($1,$2,$3::json,$4::jsonb,$5,$6),($7,$8,$9::json,$10::jsonb,$11,$12)',
        [1, 'a', JSON.stringify({ b: 2, a: 1 }), JSON.stringify({ k: [1, 2] }), '2026-10-07T01:02:03.456Z', '3900.5', 2, 'b', null, null, null, null]);
      expect(inserted.rowCount).toBe(2);
      const row = (await db.query<{ payload: unknown; doc: unknown; at: Date | string; amount: string | number; later: Date | string }>(
        `SELECT payload, doc, at, amount, at + interval '1 day' AS later FROM portability_probe WHERE id=$1`, [1])).rows[0]!;
      // json keeps key order; jsonb is normalized; numeric is text-faithful.
      expect(JSON.stringify(row.payload)).toBe('{"b":2,"a":1}');
      expect(row.doc).toEqual({ k: [1, 2] });
      expect(new Date(row.at).toISOString()).toBe('2026-10-07T01:02:03.456Z');
      expect(new Date(row.later).toISOString()).toBe('2026-10-08T01:02:03.456Z');
      expect(Number(row.amount)).toBe(3900.5);
    });

    it('ON CONFLICT upsert and unique-constraint errors propagate with their SQLSTATE', async () => {
      await db.query(`INSERT INTO portability_probe (id,label) VALUES (1,'a')`);
      await db.query(`INSERT INTO portability_probe (id,label) VALUES (1,'a2') ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label`);
      expect((await db.query<{ label: string }>('SELECT label FROM portability_probe')).rows).toEqual([{ label: 'a2' }]);
      await expect(db.query(`INSERT INTO portability_probe (id,label) VALUES (2,'a2')`)).rejects.toMatchObject({ code: '23505' });
    });

    it('transaction commits as a unit and rolls back completely on error', async () => {
      await db.transaction(async (tx) => { await tx.query(`INSERT INTO portability_probe (id,label) VALUES (1,'x')`); await tx.query(`INSERT INTO portability_probe (id,label) VALUES (2,'y')`); });
      await expect(db.transaction(async (tx) => {
        await tx.query(`INSERT INTO portability_probe (id,label) VALUES (3,'z')`);
        await tx.query(`INSERT INTO portability_probe (id,label) VALUES (4,'x')`); // unique violation
      })).rejects.toMatchObject({ code: '23505' });
      expect((await db.query<{ n: string }>('SELECT count(*)::text AS n FROM portability_probe')).rows[0]!.n).toBe('2');
      // The handle is still usable after a rolled-back transaction.
      expect((await db.query<{ one: number }>('SELECT 1 AS one')).rows[0]!.one).toBe(1);
    });

    it('transaction-scoped advisory lock is acquired inside a transaction and released at its end', async () => {
      const first = await db.transaction(async (tx) => (await tx.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(50501,1) AS acquired')).rows[0]!.acquired);
      expect(first).toBe(true);
      const again = await db.transaction(async (tx) => (await tx.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(50501,1) AS acquired')).rows[0]!.acquired);
      expect(again).toBe(true);
    });

    it('applies every repository migration and records each version exactly once', async () => {
      const migrations = await loadMigrations(resolve('migrations'));
      const applied = await applyMigrations(db, migrations);
      const versions = (await db.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')).rows.map((r) => r.version);
      expect(versions).toEqual(migrations.map((m) => m.version));
      expect(applied.length === 0 || applied.length === migrations.length).toBe(true);
      expect(await applyMigrations(db, migrations)).toEqual([]);
    });
  });
}

contractSuite('PGlite (CI)', async () => new PGliteDatabase(new PGlite()));
// requires-real-postgres: a disposable database only (never Production).
contractSuite('PostgresDatabase over real PostgreSQL (requires-real-postgres)', async () => {
  const { PostgresDatabase } = await import('../server/db/postgres');
  return new PostgresDatabase(process.env.TEST_DATABASE_URL!, { max: 2 });
}, Boolean(process.env.TEST_DATABASE_URL));

describe('PostgresDatabase (Production adapter) discipline with a mocked pg driver', () => {
  const calls: string[] = [];
  let poolOptions: Record<string, unknown> = {};
  let failOn: string | undefined;
  let releasedWith: unknown[] = [];
  beforeEach(() => {
    calls.length = 0; failOn = undefined; releasedWith = [];
    vi.resetModules();
    vi.doMock('pg', () => {
      class Pool {
        totalCount = 1; idleCount = 1; waitingCount = 0;
        constructor(options: Record<string, unknown>) { poolOptions = options; }
        on() { return this; }
        async query(sql: string) { calls.push(`pool:${sql}`); if (failOn === sql) throw Object.assign(new Error('boom'), { code: '57P01' }); return { rows: [{ one: 1 }], rowCount: 1, command: 'SELECT' }; }
        async connect() {
          return {
            query: async (sql: string) => { calls.push(`client:${sql}`); if (failOn === sql) throw Object.assign(new Error('boom'), { code: '23505' }); return { rows: [], rowCount: 2, command: 'INSERT' }; },
            release: (error?: unknown) => { releasedWith.push(error); },
          };
        }
        async end() { calls.push('end'); }
      }
      return { default: { Pool } };
    });
  });
  afterEach(() => { vi.doUnmock('pg'); });

  it('configures a small bounded pool with timeouts', async () => {
    const { PostgresDatabase, DEFAULT_POOL_OPTIONS } = await import('../server/db/postgres');
    new PostgresDatabase('postgres://user:pass@db:5432/app');
    expect(poolOptions).toMatchObject({ max: DEFAULT_POOL_OPTIONS.max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, statement_timeout: 55_000 });
    expect(DEFAULT_POOL_OPTIONS.max).toBeLessThanOrEqual(10);
  });

  it('BEGIN/COMMIT on success, ROLLBACK + error propagation on failure, client always released once', async () => {
    const { PostgresDatabase } = await import('../server/db/postgres');
    const db = new PostgresDatabase('postgres://x');
    await db.transaction(async (tx) => { await tx.query('INSERT 1'); });
    expect(calls).toEqual(['client:BEGIN', 'client:INSERT 1', 'client:COMMIT']);
    calls.length = 0; failOn = 'INSERT 2';
    await expect(db.transaction(async (tx) => { await tx.query('INSERT 2'); })).rejects.toMatchObject({ code: '23505' });
    expect(calls).toEqual(['client:BEGIN', 'client:INSERT 2', 'client:ROLLBACK']);
    expect(releasedWith).toEqual([undefined, undefined]);
    expect(db.stats()).toMatchObject({ transactions: 2, rollbacks: 1, rowsAffected: 2 });
  });

  it('a failed ROLLBACK destroys the client instead of returning it to the pool', async () => {
    const { PostgresDatabase } = await import('../server/db/postgres');
    const db = new PostgresDatabase('postgres://x');
    failOn = 'ROLLBACK';
    await expect(db.transaction(async () => { throw new Error('work failed'); })).rejects.toThrow('work failed');
    expect(releasedWith).toHaveLength(1);
    expect(releasedWith[0]).toBeInstanceOf(Error);
  });

  it('pool query errors propagate unchanged and are counted; close ends the pool', async () => {
    const { PostgresDatabase } = await import('../server/db/postgres');
    const db = new PostgresDatabase('postgres://x');
    failOn = 'SELECT 1';
    await expect(db.query('SELECT 1')).rejects.toMatchObject({ code: '57P01' });
    expect(db.stats().errors).toBe(1);
    await db.close();
    expect(calls.at(-1)).toBe('end');
  });

  it('createDatabase reads only DATABASE_URL and bounds DATABASE_POOL_MAX', async () => {
    const previous = { url: process.env.DATABASE_URL, max: process.env.DATABASE_POOL_MAX };
    try {
      delete process.env.DATABASE_URL;
      const runtime = await import('../server/db/runtime');
      expect(runtime.createDatabase()).toBeUndefined();
      process.env.DATABASE_URL = 'postgres://user:pass@db:5432/app';
      process.env.DATABASE_POOL_MAX = '50';
      expect(() => runtime.createDatabase()).toThrow(/must not exceed 20/u);
      process.env.DATABASE_POOL_MAX = '4';
      runtime.createDatabase();
      expect(poolOptions.max).toBe(4);
    } finally {
      if (previous.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.url;
      if (previous.max === undefined) delete process.env.DATABASE_POOL_MAX; else process.env.DATABASE_POOL_MAX = previous.max;
    }
  });
});
