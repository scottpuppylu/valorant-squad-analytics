import { createHash } from 'node:crypto';
import type { SqlDatabase, SqlExecutor } from './types.js';

/**
 * TASK-INFRA-DATABASE-PORTABILITY-01 deterministic database parity summary, used by restore validation, the
 * migration rehearsal and the future cutover gate (source vs target must be IDENTICAL, otherwise abort).
 * It reads metadata, exact row counts and order-independent canonical content hashes of critical tables.
 * Output contains no row values, identifiers or secrets — only counts and SHA-256 digests.
 */
export const PARITY_VERSION = 'database-parity-v2' as const;

/** Tables whose full content must survive a dump/restore bit-for-bit (canonical hash compared). */
export const CRITICAL_TABLES = [
  'schema_migrations', 'squads', 'members', 'players', 'provider_identities', 'consents', 'squad_memberships',
  'source_matches', 'match_teams', 'match_participants', 'rounds', 'round_participants', 'kill_events',
  'kill_assistants', 'event_player_locations', 'rank_observations', 'sync_runs', 'sync_cursors', 'deletion_jobs',
  'analysis_participant_facts',
] as const;

export interface ParitySummary {
  parityVersion: typeof PARITY_VERSION;
  latestMigration: string | null;
  migrations: string[];
  tables: string[];
  constraints: string[];
  indexes: string[];
  rowCounts: Record<string, number>;
  contentHashes: Record<string, string>;
  /** Tracked durable matches with a consenting participant (same definition as the public tracked count). */
  trackedMatches: number;
}

const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/u.test(name)) throw new Error('Unsafe table identifier.');
  return `"${name}"`;
};

export async function paritySummary(db: SqlExecutor): Promise<ParitySummary> {
  const tables = (await db.query<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)).rows.map((r) => r.t);
  // Declared constraints, and NOT NULL columns by column name. Never use information_schema.table_constraints
  // names: PostgreSQL synthesizes NOT NULL entries as '<namespace oid>_<table oid>_<attnum>_not_null', which
  // differ on every faithful pg_restore. PK/UNIQUE/FK/EXCLUDE compare by full definition; CHECK compares by
  // name and constrained columns, because pg_restore re-parses the deparsed expression and the deparsed text
  // of an equivalent CHECK can differ (e.g. flattened AND parentheses).
  const constraints = (await db.query<{ c: string }>(`SELECT c FROM (
      SELECT rel.relname::text || ':' || con.contype::text || ':' || con.conname || ':' || CASE WHEN con.contype = 'c'
        THEN coalesce((SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)), '')
        ELSE pg_get_constraintdef(con.oid) END AS c
      FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public' AND con.contype <> 'n'
      UNION ALL
      SELECT rel.relname::text || ':NOT NULL:' || att.attname::text AS c
      FROM pg_attribute att JOIN pg_class rel ON rel.oid = att.attrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public' AND rel.relkind = 'r' AND att.attnum > 0 AND NOT att.attisdropped AND att.attnotnull
    ) x ORDER BY 1`)).rows.map((r) => r.c);
  const indexes = (await db.query<{ i: string }>(`SELECT tablename || ':' || indexname AS i FROM pg_indexes WHERE schemaname='public' ORDER BY 1`)).rows.map((r) => r.i);
  const migrations = tables.includes('schema_migrations')
    ? (await db.query<{ v: string }>('SELECT version AS v FROM schema_migrations ORDER BY version')).rows.map((r) => r.v) : [];
  const rowCounts: Record<string, number> = {};
  const contentHashes: Record<string, string> = {};
  for (const table of CRITICAL_TABLES) {
    if (!tables.includes(table)) continue;
    rowCounts[table] = Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${identifier(table)}`)).rows[0]!.n);
    // Order-independent canonical hash: each row's JSON text (column order fixed by the schema) hashed, then
    // the sorted row digests hashed together. schema_migrations.applied_at differs per environment by design.
    const projection = table === 'schema_migrations' ? `json_build_object('version', version, 'name', name)::text` : `row_to_json(t)::text`;
    const digests = (await db.query<{ d: string }>(`SELECT md5(${projection}) AS d FROM ${identifier(table)} t ORDER BY 1`)).rows.map((r) => r.d);
    contentHashes[table] = createHash('sha256').update(digests.join('\n')).digest('hex');
  }
  const trackedMatches = tables.includes('source_matches') && tables.includes('match_participants')
    ? Number((await db.query<{ n: string }>(`SELECT count(DISTINCT sm.id)::text AS n FROM source_matches sm
        JOIN match_participants mp ON mp.source_match_id=sm.id WHERE mp.player_id IS NOT NULL AND sm.started_at IS NOT NULL`)).rows[0]!.n)
    : 0;
  return { parityVersion: PARITY_VERSION, latestMigration: migrations.at(-1) ?? null, migrations, tables, constraints, indexes, rowCounts, contentHashes, trackedMatches };
}

/** Every difference between two summaries (empty = identical). The cutover gate aborts on any entry. */
export function parityDifferences(source: ParitySummary, target: ParitySummary): string[] {
  const differences: string[] = [];
  const compareList = (name: keyof ParitySummary) => {
    const a = JSON.stringify(source[name]); const b = JSON.stringify(target[name]);
    if (a !== b) differences.push(name);
  };
  for (const name of ['migrations', 'tables', 'constraints', 'indexes'] as const) compareList(name);
  for (const table of new Set([...Object.keys(source.rowCounts), ...Object.keys(target.rowCounts)])) {
    if (source.rowCounts[table] !== target.rowCounts[table]) differences.push(`rowCount:${table}`);
    if (source.contentHashes[table] !== target.contentHashes[table]) differences.push(`content:${table}`);
  }
  if (source.trackedMatches !== target.trackedMatches) differences.push('trackedMatches');
  return differences;
}

/** Canonical summary in one read transaction with UTC rendering (timestamps hash identically on any server). */
export function paritySummaryUtc(db: SqlDatabase): Promise<ParitySummary> {
  return db.transaction(async (transaction) => {
    await transaction.query("SET LOCAL TIME ZONE 'UTC'");
    return paritySummary(transaction);
  });
}
