// bulk-history-v1 maintainer CLI (TASK-DATA-BULK-01). READ-ONLY by default:
//   npm run history:bulk -- --base-url https://valorant-squad-analytics.vercel.app --all
// Execution needs --execute, a selector and a finite --max-provider-requests:
//   npm run history:bulk -- --base-url <url> --account <publicAccountId> --execute --max-provider-requests 4 --lanes 1
// Calls ONLY the existing public routes (dataset, sync/start, sync/continue, sync/status). Needs no server
// secret (no database, provider or cron credential) and never calls the provider directly.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BulkController, type AccountTelemetry, type BulkClock, type BulkSummary } from './bulk/controller.js';
import { accountsFromDataset, httpTransport, parseArgs, parseState, selectAccounts } from './bulk/cli.js';

const options = (() => { try { return parseArgs(process.argv.slice(2)); } catch (error) { process.stderr.write(`${(error as Error).message}\n`); process.exit(2); } })();
const read = (path: string) => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } };
const save = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 1)); renameSync(`${path}.tmp`, path); };
const label = (a: { memberName: string; riotId: string; isPrimary: boolean; label?: string }) => `${a.memberName} / ${a.riotId} (${a.label ?? (a.isPrimary ? '主帳' : '小帳')})`;
const day = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

let publicState: ReturnType<typeof accountsFromDataset>;
try {
  const datasetResponse = await fetch(`${options.baseUrl}/api/valorant/dataset`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  publicState = accountsFromDataset(await datasetResponse.json());
} catch (error) { process.stderr.write(`FAIL CLOSED (no POST requests): ${(error as Error).message}\n`); process.exit(3); }
const selected = (() => { try { return selectAccounts(publicState.accounts, options); } catch (error) { process.stderr.write(`${(error as Error).message}\n`); process.exit(2); } })();
const { state: restored, warning } = parseState(read(options.statePath), options.baseUrl);
if (warning) process.stderr.write(`${warning}\n`);

process.stdout.write(`bulk-history-v1 · ${options.baseUrl} · schema ${publicState.schemaVersion} · ${publicState.identityVersion} · ${publicState.members} members / ${publicState.accounts.length} public accounts\n`);
process.stdout.write(`Selected ${selected.length} account(s); lanes ${options.lanes}; provider ≤ ${options.providerRpm}/min; max provider requests ${options.maxProviderRequests ?? '—'}; max minutes ${options.maxMinutes ?? '—'}\n`);
for (const account of selected) {
  const saved = restored?.accounts[account.accountId];
  process.stdout.write(`  · ${label(account)} — local state: ${saved?.runId ? `run known (${saved.state ?? '?'}, ${saved.phase ?? '?'})` : 'none (server start/resume decides)'}\n`);
}
if (!options.execute) {
  process.stdout.write('PLAN ONLY: 0 POST requests, 0 provider requests. Add --execute with --max-provider-requests to run.\n');
  process.exit(0);
}

const clock: BulkClock = {
  now: () => Date.now(),
  wait: (ms) => { let timer: ReturnType<typeof setTimeout> | undefined; let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; timer = setTimeout(r, ms); }); return { promise, cancel: () => { if (timer) clearTimeout(timer); resolve(); } }; },
};
const started = Date.now();
const controller: BulkController = new BulkController(selected, httpTransport(options.baseUrl, fetch as never), clock, {
  lanes: options.lanes, providerRpm: options.providerRpm, maxProviderRequests: options.maxProviderRequests!,
  ...(options.maxMinutes ? { maxMinutes: options.maxMinutes } : {}), ...(options.maxHttpRequests ? { maxHttpRequests: options.maxHttpRequests } : {}),
  stopOnRateLimit: options.stopOnRateLimit,
}, restored, (event) => {
  const account = controller?.accounts.find((a) => a.accountId === event.accountId);
  const t = `${((event.at - started) / 1000).toFixed(1)}s`;
  if (event.type === 'launch') process.stdout.write(`[${t}] → ${event.route} ${account ? label(account) : ''} (reserve ${event.cost})\n`);
  if (event.type === 'error') process.stdout.write(`[${t}] ✗ ${event.code} ${account ? label(account) : ''}\n`);
  if (event.type === 'result' && account) {
    process.stdout.write(`[${t}] ✓ ${label(account)} · ${account.phase ?? '?'} · ${account.state} · session seen ${account.session.seen} / persisted ${account.session.persisted} / overlap ${account.session.overlaps} · provider ${account.session.providerRequests}${account.session.unmeasuredProviderRequests ? ` (${account.session.unmeasuredProviderRequests} unmeasured)` : ''} · coverage ${day(account.coverageFrom)}→${day(account.coverageTo)}${account.nextAttemptAt ? ` · next ${account.nextAttemptAt}` : ''}\n`);
    save(options.statePath, controller.snapshot(options.baseUrl));
  }
});
process.on('SIGINT', () => { process.stdout.write('\nSIGINT: no new requests; waiting for in-flight work, then saving state.\n'); controller.stop('interrupted'); });

const summary: BulkSummary = await controller.run();
save(options.statePath, controller.snapshot(options.baseUrl));
const minutes = summary.elapsedMs / 60_000;
const line = (a: AccountTelemetry) => `  ${label(a)}: ${a.state}${a.sourceExhausted ? ' (source exhausted)' : ''} · ${a.phase ?? '?'} · chunks ${a.session.chunks} · seen ${a.session.seen} · persisted ${a.session.persisted} · overlap ${a.session.overlaps} · provider ${a.session.providerRequests} · max chunk ${a.session.maxChunkMs} ms${a.lastErrorCategory ? ` · last error ${a.lastErrorCategory}` : ''}`;
process.stdout.write(`\nStopped: ${summary.stopReason} · elapsed ${(summary.elapsedMs / 1000).toFixed(1)} s · provider ${summary.providerRequests} (${summary.unmeasuredProviderRequests} conservatively charged) · HTTP start ${summary.httpRequests.start} / continue ${summary.httpRequests.continue} / status ${summary.httpRequests.status}\n`);
process.stdout.write(`Seen ${summary.matchesSeen} · persisted observations ${summary.persistedObservations} · overlaps ${summary.overlaps} · ${minutes > 0 ? (summary.matchesSeen / minutes).toFixed(1) : '—'} matches/min · ${minutes > 0 ? (summary.providerRequests / minutes).toFixed(1) : '—'} provider/min · provider fetch ${summary.providerFetchMs} ms · DB ${summary.databaseMs} ms\n`);
process.stdout.write('ETA: unknown (live history depth is not published by the provider). Never lifetime-complete.\n');
for (const account of summary.accounts) process.stdout.write(`${line(account)}\n`);
if (options.json) process.stdout.write(`${JSON.stringify({ ...summary, accounts: summary.accounts.map((a) => ({ memberName: a.memberName, riotId: a.riotId, accountId: a.accountId, state: a.state, phase: a.phase, sourceExhausted: a.sourceExhausted, nextAttemptAt: a.nextAttemptAt, lastErrorCategory: a.lastErrorCategory, coverageFrom: a.coverageFrom, coverageTo: a.coverageTo, session: a.session })) })}\n`);
process.exitCode = ['database_error', 'unexpected_response', 'rate_limited', 'chunk_latency', 'repeated_provider_errors'].includes(summary.stopReason) ? 1 : 0;
