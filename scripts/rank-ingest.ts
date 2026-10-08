import { createRebuildProvider, type RequestRecord } from '../server/rebuildStaging/providerGateway.js';
import { envValue, openStagingDatabase } from '../server/rebuildStaging/localConfig.js';
import { RollingWindowLimiter } from '../server/rebuildStaging/rateLimiter.js';
import { RebuildStagingStore } from '../server/rebuildStaging/stagingStore.js';
import { ingestMatchSnapshots, ingestProviderRank } from '../server/rankEvidence/rankIngestion.js';
import { buildRankReport } from '../server/rankEvidence/rankReport.js';
import { RankStagingStore } from '../server/rankEvidence/rankStagingStore.js';

/**
 * `npm run rank:ingest -- <command>` — TASK-DATA-RANK-01 PRIVATE rank evidence ingestion (local maintainer tool).
 *
 *   snapshots                     match-time tiers from the already-hydrated private v4 documents (0 provider requests)
 *   fetch --max-task-requests N   v3 MMR + v2 stored MMR history per account (resumable; N ≤ 30 task-wide)
 *         [--accounts K] [--history-size S]
 *   report                        identifier-free rank coverage report (community names only)
 *
 * Writes only rank_staging in the private staging database. Logs carry community names and counts only.
 */
const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name: string) => { const index = argv.indexOf(name); return index === -1 ? undefined : argv[index + 1]; };
const TASK_REQUEST_CEILING = 30;
const emit = (event: string, fields: Record<string, string | number | boolean | null> = {}) =>
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...fields })}\n`);

const database = openStagingDatabase({ applicationName: 'vsa-rank-ingest' });
try {
  const rebuild = new RebuildStagingStore(database, envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY'));
  await rebuild.initialize(); // refuses any application database; ensures the private staging schema
  const rank = new RankStagingStore(database);
  await rank.initialize();
  const rankRequests = async () => Number((await database.query<{ n: string }>(
    `SELECT count(*) AS n FROM rebuild_staging.provider_requests WHERE category='mmr'`)).rows[0]?.n ?? 0);

  if (command === 'snapshots') {
    emit('rank_snapshots', await ingestMatchSnapshots(database, rebuild, rank));
  } else if (command === 'fetch') {
    const maxTaskRequests = Number(flag('--max-task-requests'));
    if (!Number.isSafeInteger(maxTaskRequests) || maxTaskRequests < 1 || maxTaskRequests > TASK_REQUEST_CEILING) {
      throw new Error(`--max-task-requests must be 1..${TASK_REQUEST_CEILING}.`);
    }
    const limiter = new RollingWindowLimiter();
    limiter.seed(await rebuild.recentRequestStarts(limiter.windowMs * 2));
    let last: RequestRecord | undefined;
    const provider = createRebuildProvider({ apiKey: envValue('provider.env', 'HENRIK_API_KEY'), limiter,
      record: async (request) => { last = request; await rebuild.recordRequest(request); } });
    const result = await ingestProviderRank({ provider, rebuild, rank, requestsUsed: rankRequests, maxTaskRequests,
      historySize: Number(flag('--history-size') ?? 100), lastRequest: () => last, onEvent: emit,
      ...(flag('--accounts') ? { accountLimit: Number(flag('--accounts')) } : {}) });
    emit('rank_fetch_end', { stop_reason: result.stopReason, created: result.created, attempted_accounts: result.attemptedAccounts,
      task_requests: await rankRequests(), max_window: limiter.maxObservedInWindow() });
  } else if (command === 'report') {
    process.stdout.write(`${JSON.stringify(await buildRankReport(database, rank), null, 2)}\n`);
  } else {
    throw new Error('usage: rank:ingest -- snapshots | fetch --max-task-requests N | report');
  }
} finally {
  await database.close();
}
