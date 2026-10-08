import { getSharedDatabase } from '../db/runtime.js';
import { createApiServer, type HealthReport } from './httpServer.js';

/**
 * Standalone Node production entrypoint (VPS). Listens on an internal port only; Caddy is the public edge.
 * Health is deliberately cheap: one `SELECT` of the latest applied migration (never an analytics query).
 */
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

async function health(): Promise<HealthReport> {
  const database = getSharedDatabase();
  if (!database) return { ok: false, database: 'unavailable' };
  const started = performance.now();
  try {
    const row = (await database.query<{ version: string | null }>('SELECT max(version) AS version FROM schema_migrations')).rows[0];
    const stats = database.stats();
    return { ok: true, database: 'ok', ...(row?.version ? { schemaVersion: row.version } : {}), dbLatencyMs: Math.round(performance.now() - started),
      pool: { total: stats.total, idle: stats.idle, waiting: stats.waiting } };
  } catch {
    return { ok: false, database: 'error', dbLatencyMs: Math.round(performance.now() - started) };
  }
}

const server = createApiServer({ health });
server.requestTimeout = 65_000;
server.headersTimeout = 15_000;
server.listen(port, host, () => process.stdout.write(`${JSON.stringify({ event: 'api_listening', port })}\n`));

const shutdown = (signal: string) => {
  process.stdout.write(`${JSON.stringify({ event: 'api_shutdown', signal })}\n`);
  server.close(() => {
    const database = getSharedDatabase();
    void (database ? database.close() : Promise.resolve()).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 30_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
