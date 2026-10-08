import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { hydrateAnalysisFacts } from '../server/dataset/analysisFactHydration';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import { CRITICAL_TABLES, parityDifferences, paritySummaryUtc } from '../server/db/parity';
import { BenchDatabase, benchDatabase, seedBenchAccounts, seedBenchMatches } from './support/analysisBenchFixture';

/**
 * TASK-INFRA-DATABASE-PORTABILITY-01 local migration-rehearsal of the PARITY GATE (PGlite, CI):
 * A = all migrations + representative realistic data + analysis facts; B = a byte copy of A's cluster
 * (PGlite data-dir dump/load — the pg_dump/pg_restore path itself needs real PostgreSQL and runs in
 * infra/rehearsal/rehearse-migration.sh). The gate must report IDENTICAL for a faithful copy and must detect
 * every kind of drift the cutover has to abort on.
 */
async function seeded() {
  const db = await benchDatabase();
  await seedBenchAccounts(db, { matches: 120, accounts: 7, linkAccounts: [[6, 1]] });
  await seedBenchMatches(db, { matches: 120, accounts: 7, seed: 9 });
  await hydrateAnalysisFacts(db);
  return db;
}

describe('database parity gate', () => {
  it('a faithful copy is identical across every critical table, constraint, index and the tracked count', async () => {
    const a = await seeded();
    const summaryA = await paritySummaryUtc(a);
    const copy = new BenchDatabase(new PGlite({ loadDataDir: await a.pg.dumpDataDir('none') }));
    const summaryB = await paritySummaryUtc(copy);
    expect(parityDifferences(summaryA, summaryB)).toEqual([]);
    expect(Object.keys(summaryA.contentHashes)).toEqual(CRITICAL_TABLES.filter((t) => summaryA.tables.includes(t)));
    expect(summaryA.latestMigration).toBe('0012');
    expect(summaryA.rowCounts.analysis_participant_facts).toBeGreaterThan(0);
    expect(summaryA.trackedMatches).toBeGreaterThan(0);
    // Summary is counts + digests only.
    expect(JSON.stringify(summaryA)).not.toMatch(/BenchPlayer|[0-9a-f]{8}-[0-9a-f]{4}-/u);
    await a.close(); await copy.close();
  }, 120_000);

  it('detects row loss, content drift, a missing migration and schema drift (cutover must abort)', async () => {
    const a = await seeded();
    const base = await paritySummaryUtc(a);
    const mutate = async (sql: string) => { const copy = new BenchDatabase(new PGlite({ loadDataDir: await a.pg.dumpDataDir('none') })); await copy.query(sql); const s = await paritySummaryUtc(copy); await copy.close(); return parityDifferences(base, s); };
    expect(await mutate("DELETE FROM kill_assistants WHERE ctid IN (SELECT ctid FROM kill_assistants LIMIT 1)")).toEqual(['rowCount:kill_assistants', 'content:kill_assistants']);
    expect(await mutate("UPDATE sync_cursors SET next_start = next_start + 1 WHERE false")).toEqual([]);
    expect(await mutate("UPDATE match_participants SET kills = kills + 1 WHERE id = (SELECT id FROM match_participants ORDER BY id LIMIT 1)")).toEqual(['content:match_participants']);
    expect(await mutate("DELETE FROM schema_migrations WHERE version='0011'")).toEqual(['migrations', 'rowCount:schema_migrations', 'content:schema_migrations']);
    expect(await mutate('CREATE INDEX drift_idx ON source_matches (map_name)')).toEqual(['indexes']);
    expect(await mutate('ALTER TABLE source_matches ALTER COLUMN affinity DROP NOT NULL')).toEqual(['constraints']);
    expect(await mutate('ALTER TABLE source_matches ADD CONSTRAINT drift_check CHECK (true)')).toEqual(['constraints']);
    await a.close();
  }, 120_000);

  // Regression (TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01): a real pg_restore recreates every table under new OIDs.
  // The constraint list must not depend on OIDs (PostgreSQL's synthesized '<oid>_<oid>_<n>_not_null' names did).
  it('the same schema built under different table OIDs and re-parsed CHECK expressions (as after pg_restore) has identical constraints', async () => {
    const a = await benchDatabase();
    const shifted = new BenchDatabase(new PGlite());
    await shifted.query('CREATE TABLE oid_shift (id int NOT NULL)');
    await shifted.query('DROP TABLE oid_shift');
    await applyMigrations(shifted, await loadMigrations(resolve('migrations')));
    // pg_restore re-creates every CHECK from its deparsed text; equivalent expressions may deparse differently.
    const checks = (await shifted.query<{ t: string; n: string; d: string }>(`SELECT rel.relname AS t, con.conname AS n, pg_get_constraintdef(con.oid) AS d
      FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public' AND con.contype = 'c'`)).rows;
    expect(checks.length).toBeGreaterThan(0);
    for (const { t, n, d } of checks) await shifted.query(`ALTER TABLE "${t}" DROP CONSTRAINT "${n}", ADD CONSTRAINT "${n}" ${d}`);
    const [summaryA, summaryB] = [await paritySummaryUtc(a), await paritySummaryUtc(shifted)];
    expect(parityDifferences(summaryA, summaryB)).toEqual([]);
    expect(summaryA.constraints.some((c) => c.startsWith('source_matches:NOT NULL:'))).toBe(true);
    expect(summaryA.constraints.join('\n')).not.toMatch(/\d+_\d+_\d+_not_null/u);
    await a.close(); await shifted.close();
  }, 120_000);
});
