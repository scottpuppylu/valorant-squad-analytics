import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RebuildCollector } from '../server/rebuildStaging/collector.js';
import { envValue, openStagingDatabase, privateFile, REBUILD_HOME } from '../server/rebuildStaging/localConfig.js';
import { buildMemberCache, type MemberCache } from '../server/rebuildStaging/memberCache.js';
import { createRebuildProvider, type RequestRecord } from '../server/rebuildStaging/providerGateway.js';
import { RollingWindowLimiter } from '../server/rebuildStaging/rateLimiter.js';
import { buildCoverageReport } from '../server/rebuildStaging/report.js';
import { sanitizedEvent, stdoutSink } from '../server/rebuildStaging/safeLog.js';
import { RebuildStagingStore } from '../server/rebuildStaging/stagingStore.js';

/**
 * `npm run rebuild:collect -- <command>` — TASK-DATA-LOCAL-REBUILD-COLLECT-01 PRIVATE collector (local maintainer
 * tool; never deployed, never imported by api/, src/ or the application runtime).
 *
 *   init-members                 build ~/.vsa-rebuild/members.json from the cached public dataset (no network)
 *   init-key                     create ~/.vsa-rebuild/rebuild-hmac.env once (never printed)
 *   load                         create the private schema + load the 9 cached accounts (no network)
 *   resolve [--first-only]       v2 account lookups (affinity + provider id); --first-only validates the key
 *   discover | hydrate | run     provider collection (requires --max-provider-requests N; optional --max-minutes M)
 *   status | report              identifier-free counters / coverage + integrity report
 *
 * All secrets come from ~/.vsa-rebuild/*.env (each must be mode 600; the directory 700) and are never printed.
 * The database must be the loopback private staging database; application databases are refused.
 */
const HOME = REBUILD_HOME;
const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name: string) => { const index = argv.indexOf(name); return index === -1 ? undefined : argv[index + 1]; };
const has = (name: string) => argv.includes(name);
const openDatabase = () => openStagingDatabase({ port: Number(flag('--port') ?? 55903), database: flag('--database') ?? 'valorant_rebuild_staging',
  applicationName: 'vsa-rebuild-collector' });
const log = (event: string, fields: Parameters<typeof sanitizedEvent>[1] = {}) => stdoutSink(sanitizedEvent(event, fields));

async function main() {
  if (command === 'init-members') {
    const out = join(HOME, 'members.json');
    const cache = buildMemberCache(JSON.parse(readFileSync(privateFile('public-dataset.json'), 'utf8')),
      JSON.parse(readFileSync(resolve('ops/community-names-2026-10-06.json'), 'utf8')));
    writeFileSync(out, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    log('members_cached', { members: cache.members.length, accounts: cache.members.reduce((n, m) => n + m.accounts.length, 0) });
    return;
  }
  if (command === 'init-key') {
    const path = join(HOME, 'rebuild-hmac.env');
    const created = !existsSync(path);
    if (created) writeFileSync(path, `REBUILD_HMAC_KEY=${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    privateFile('rebuild-hmac.env');
    log('rebuild_hmac_key', { created, present: true });
    return;
  }
  const database = openDatabase();
  try {
    const store = new RebuildStagingStore(database, envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY'));
    await store.initialize();
    if (command === 'load') {
      const cache = JSON.parse(readFileSync(privateFile('members.json'), 'utf8')) as MemberCache;
      const accounts = cache.members.flatMap((member) => member.accounts.map((account) => ({
        accountPublicId: account.accountPublicId, memberPublicId: member.memberPublicId, communityName: member.communityName,
        gameName: account.gameName, tag: account.tag, isPrimary: account.isPrimary })));
      log('accounts_loaded', { accounts: await store.upsertAccounts(accounts) });
      return;
    }
    if (command === 'status') { log('collector_status', await store.counts()); return; }
    if (command === 'report') { process.stdout.write(`${JSON.stringify(await buildCoverageReport(database), null, 2)}\n`); return; }

    // --provider-rpm may only LOWER the rate (the limiter refuses > 6); earlier processes' starts are seeded so
    // the rolling-window ceiling also holds across restarts.
    const limiter = new RollingWindowLimiter({ maxRequests: Number(flag('--provider-rpm') ?? 6) });
    limiter.seed(await store.recentRequestStarts(limiter.windowMs * 2));
    const observer: { collector?: RebuildCollector } = {};
    const provider = createRebuildProvider({
      apiKey: envValue('provider.env', 'HENRIK_API_KEY'), limiter,
      record: async (request: RequestRecord) => { observer.collector?.observe(request); await store.recordRequest(request); },
    });
    const maxProviderRequests = Number(flag('--max-provider-requests') ?? (command === 'resolve' ? 9 : Number.NaN));
    const maxMinutes = flag('--max-minutes');
    const collector = new RebuildCollector({ store, provider, limiter, sink: stdoutSink, maxProviderRequests,
      ...(maxMinutes ? { deadlineMs: Number(maxMinutes) * 60_000 } : {}), lanes: Number(flag('--lanes') ?? 2) });
    observer.collector = collector;
    const run = await store.startRun(command ?? 'unknown');
    let failure: unknown;
    try {
      if (command === 'resolve') log('resolve_result', await collector.resolve(has('--first-only')));
      else if (command === 'discover') await collector.discover();
      else if (command === 'hydrate') await collector.hydrate();
      else if (command === 'run') { await collector.resolve(); if (!collector.result().stopReason) await collector.discover(); if (!collector.result().stopReason) await collector.hydrate(); }
      else throw new Error('unknown command');
    } catch (error) { failure = error; }
    const result = collector.result();
    await store.finishRun(run, failure ? 'failed' : result.stopReason ? 'stopped' : 'complete', failure ? 'exception' : result.stopReason,
      { requests: result.requests, avoidedDetailFetches: result.avoidedDetailFetches, maxWindow: limiter.maxObservedInWindow() });
    log('collector_run_end', { status: failure ? 'failed' : result.stopReason ? 'stopped' : 'complete', stop_reason: result.stopReason ?? null,
      requests: result.requests, max_window: limiter.maxObservedInWindow(), avoided_detail_fetches: result.avoidedDetailFetches, ...(await store.counts()) });
    if (failure) {
      // Name + SQLSTATE only: messages can carry provider values, so they are never printed.
      const code = (failure as { code?: unknown }).code;
      process.stderr.write(`collector failed: ${failure instanceof Error ? failure.name : 'Error'}${typeof code === 'string' && /^[A-Z0-9_]{1,40}$/u.test(code) ? ` (${code})` : ''}\n`);
      process.exitCode = 1;
    }
  } finally {
    await database.close();
  }
}

await main();
