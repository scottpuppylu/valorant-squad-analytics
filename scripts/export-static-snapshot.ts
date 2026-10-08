import { resolve } from 'node:path';
import { createDatabase } from '../server/db/runtime.js';
import { exportStaticSnapshot } from '../server/staticExport/exporter.js';
import { postgresExportSources, withConsistentReadSnapshot } from '../server/staticExport/sources.js';
import { isLocalDatabaseHost } from '../server/staticExport/locality.js';

/**
 * `npm run data:export -- --out <dir> [--tier facts|common|core|extended]` (TASK-INFRA-STATIC-DATA-PUBLISH-01).
 *
 * Reads ONE consistent READ ONLY snapshot of the LOCAL PostgreSQL (`DATABASE_URL`) and writes a finalized,
 * privacy-gated, immutable version directory to <dir>/versions/<snapshotId>/. It never publishes, never
 * writes manifest.json, never calls a provider and never writes the database.
 *
 * Locality guard: the database host must be loopback, a private (RFC 1918 / ULA) address, or a single-label
 * container name (e.g. `postgres` on the Compose network). Managed / public hosts (e.g. Neon) are refused.
 */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const out = argument('--out');
const tier = (argument('--tier') ?? 'common') as 'facts' | 'common' | 'core' | 'extended';
if (!out) throw new Error('Usage: data:export -- --out <dir> [--tier facts|common|core|extended]');
if (!['facts', 'common', 'core', 'extended'].includes(tier)) throw new Error('--tier must be facts, common, core or extended.');
const host = (() => { try { return new URL(process.env.DATABASE_URL ?? '').hostname; } catch { return ''; } })();
if (!host || !isLocalDatabaseHost(host)) throw new Error('data:export only reads a LOCAL PostgreSQL (loopback, private address or Compose service name).');

const database = createDatabase({ max: 1 });
if (!database) throw new Error('DATABASE_URL is required.');
const secretValues = ['DATABASE_URL', 'HENRIK_API_KEY', 'IDENTIFIER_HMAC_KEY', 'CRON_SECRET', 'POSTGRES_PASSWORD']
  .map((name) => process.env[name]).filter((value): value is string => typeof value === 'string' && value.length >= 8);
const started = Date.now();
try {
  const result = await withConsistentReadSnapshot(database, (snapshot) => exportStaticSnapshot({
    sources: postgresExportSources(snapshot), database: snapshot, outputRoot: resolve(out), tier, secretValues,
    onProgress: (event) => process.stderr.write(`${JSON.stringify({ event: 'static_export_progress', ...event })}
`),
  }));
  process.stdout.write(`${JSON.stringify({
    event: 'static_export', result: 'PASS', snapshotId: result.snapshotId, dataVersion: result.dataVersion, created: result.created, tier,
    files: result.files.length, totalBytes: result.totalBytes, largestFile: result.largestFile, overTargetFiles: result.overTargetFiles,
    counts: result.counts, durationMs: Date.now() - started,
  })}\n`);
} finally {
  await database.close();
}
