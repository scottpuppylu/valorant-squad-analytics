/**
 * bulk-history-v1 CLI helpers (pure; tested): argument parsing, public dataset contract gate,
 * account selection, HTTP transport over the existing public sync routes, and local state
 * validation. No secrets, no database, no provider SDK. Never imported by src/ or api/.
 */
import { BULK_HISTORY_VERSION, type BulkAccount, type BulkTransport, type PersistedBulkState, type SyncCallResult } from './controller.js';

export interface CliOptions {
  baseUrl: string;
  all: boolean;
  members: string[];
  accounts: string[];
  execute: boolean;
  lanes: number;
  providerRpm: number;
  maxMinutes?: number;
  maxProviderRequests?: number;
  maxHttpRequests?: number;
  statePath: string;
  json: boolean;
  stopOnRateLimit: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { baseUrl: '', all: false, members: [], accounts: [], execute: false, lanes: 1, providerRpm: 8, statePath: '.local/bulk-history-state.json', json: false, stopOnRateLimit: false };
  const value = (index: number, flag: string) => { const next = argv[index + 1]; if (next === undefined || next.startsWith('--')) throw new Error(`${flag} requires a value.`); return next; };
  const positive = (raw: string, flag: string) => { const n = Number(raw); if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number.`); return n; };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    switch (flag) {
      case '--base-url': options.baseUrl = value(i, flag); i += 1; break;
      case '--all': options.all = true; break;
      case '--member': options.members.push(value(i, flag)); i += 1; break;
      case '--account': options.accounts.push(value(i, flag)); i += 1; break;
      case '--execute': options.execute = true; break;
      case '--lanes': options.lanes = positive(value(i, flag), flag); i += 1; break;
      case '--provider-rpm': options.providerRpm = positive(value(i, flag), flag); i += 1; break;
      case '--max-minutes': options.maxMinutes = positive(value(i, flag), flag); i += 1; break;
      case '--max-provider-requests': options.maxProviderRequests = positive(value(i, flag), flag); i += 1; break;
      case '--max-http-requests': options.maxHttpRequests = positive(value(i, flag), flag); i += 1; break;
      case '--state': options.statePath = value(i, flag); i += 1; break;
      case '--json': options.json = true; break;
      case '--stop-on-rate-limit': options.stopOnRateLimit = true; break;
      default: throw new Error(`Unknown option ${flag}. There is no unbounded/forever mode in bulk-history-v1.`);
    }
  }
  if (!options.baseUrl) throw new Error('--base-url is required.');
  const url = new URL(options.baseUrl);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('--base-url must be https (or http://localhost).');
  options.baseUrl = url.origin;
  for (const id of [...options.members, ...options.accounts]) if (!uuid.test(id)) throw new Error(`Not a public UUID: ${id}`);
  if (!Number.isInteger(options.lanes) || options.lanes < 1 || options.lanes > 2) throw new Error('--lanes must be 1 or 2.');
  if (options.providerRpm > 8) throw new Error('--provider-rpm cannot exceed 8 (accepted provider pressure).');
  if (options.execute) {
    if (!options.all && options.members.length === 0 && options.accounts.length === 0) throw new Error('--execute requires --all, --member or --account.');
    if (options.maxProviderRequests === undefined) throw new Error('--execute requires a finite --max-provider-requests (no unbounded mode).');
  }
  return options;
}

export interface PublicAccountsResult { accounts: BulkAccount[]; schemaVersion: number; identityVersion: string; members: number }

/** Fail closed unless the canonical REAL dataset with member-identity-v2 public accounts is served. */
export function accountsFromDataset(body: unknown): PublicAccountsResult {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!record(body) || body.ok !== true || body.schemaVersion !== 6 || body.state !== 'ready') throw new Error('Dataset contract mismatch: expected a ready schema 6 REAL dataset.');
  const snapshot = body.snapshot; const dataset = body.dataset;
  if (!record(snapshot) || snapshot.identityVersion !== 'member-identity-v2') throw new Error('Dataset contract mismatch: expected member-identity-v2.');
  if (!record(dataset) || dataset.mode !== 'REAL' || dataset.isDemo !== false || !Array.isArray(dataset.players) || dataset.players.length === 0) throw new Error('Dataset contract mismatch: REAL players required (Demo is rejected).');
  const accounts: BulkAccount[] = [];
  for (const player of dataset.players as unknown[]) {
    if (!record(player) || typeof player.id !== 'string' || typeof player.handle !== 'string' || !Array.isArray(player.accounts) || player.accounts.length === 0) throw new Error('Dataset contract mismatch: every member needs public accounts.');
    for (const account of player.accounts as unknown[]) {
      if (!record(account) || typeof account.id !== 'string' || !uuid.test(account.id) || typeof account.gameName !== 'string' || typeof account.tag !== 'string') throw new Error('Dataset contract mismatch: invalid public account.');
      accounts.push({ accountId: account.id, memberId: player.id, memberName: typeof player.displayName === 'string' ? player.displayName : player.handle, riotId: `${account.gameName}#${account.tag}`, isPrimary: account.isPrimary === true,
        ...(typeof account.label === 'string' ? { label: account.label } : {}) });
    }
  }
  return { accounts, schemaVersion: body.schemaVersion as number, identityVersion: snapshot.identityVersion as string, members: dataset.players.length };
}

export function selectAccounts(all: BulkAccount[], options: Pick<CliOptions, 'all' | 'members' | 'accounts'>): BulkAccount[] {
  for (const id of options.members) if (!all.some((a) => a.memberId === id)) throw new Error(`Unknown public member ${id}.`);
  for (const id of options.accounts) if (!all.some((a) => a.accountId === id)) throw new Error(`Unknown public account ${id}.`);
  if (options.all) return [...all];
  return all.filter((a) => options.members.includes(a.memberId) || options.accounts.includes(a.accountId));
}

/** Validated local resume state (public ids only); anything else is discarded, never trusted. */
export function parseState(raw: string | undefined, baseUrl: string): { state?: PersistedBulkState; warning?: string } {
  if (raw === undefined) return {};
  try {
    const value = JSON.parse(raw) as PersistedBulkState;
    if (value.version !== BULK_HISTORY_VERSION || value.baseUrl !== baseUrl || typeof value.accounts !== 'object' || value.accounts === null) return { warning: 'Local state ignored (version/base URL mismatch).' };
    const accounts: PersistedBulkState['accounts'] = {};
    for (const [id, entry] of Object.entries(value.accounts)) {
      if (!uuid.test(id) || typeof entry !== 'object' || entry === null) continue;
      accounts[id] = { ...(typeof entry.runId === 'string' && uuid.test(entry.runId) ? { runId: entry.runId } : {}),
        ...(typeof entry.state === 'string' ? { state: entry.state } : {}), ...(typeof entry.phase === 'string' ? { phase: entry.phase } : {}),
        ...(typeof entry.observedAt === 'string' ? { observedAt: entry.observedAt } : {}) };
    }
    return { state: { version: BULK_HISTORY_VERSION, baseUrl, savedAt: String(value.savedAt), accounts } };
  } catch {
    return { warning: 'Local state was corrupt and is ignored; the plan is rebuilt from public state.' };
  }
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/** The existing public routes only (no new endpoint, no secret, no provider call). */
export function httpTransport(baseUrl: string, fetcher: Fetch, timeoutMs = 90_000): BulkTransport {
  const call = async (path: string, body?: unknown): Promise<SyncCallResult> => {
    let status = 0;
    let text = '';
    try {
      const response = await fetcher(`${baseUrl}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) });
      status = response.status;
      text = await response.text();
    } catch {
      return { ok: false, httpStatus: 0, code: 'NETWORK_ERROR' };
    }
    try {
      const parsed = JSON.parse(text) as { ok?: boolean; sync?: unknown; error?: { code?: unknown } };
      if (status === 200 && parsed.ok === true && typeof parsed.sync === 'object' && parsed.sync !== null) return { ok: true, sync: parsed.sync as never };
      return { ok: false, httpStatus: status, code: typeof parsed.error?.code === 'string' ? parsed.error.code : `HTTP_${status}` };
    } catch {
      return { ok: false, httpStatus: status, code: 'UNEXPECTED_RESPONSE' };
    }
  };
  return {
    start: (accountId) => call('/api/valorant/sync/start', { accountId, kind: 'deep_backfill' }),
    continue: (runId) => call('/api/valorant/sync/continue', { runId }),
    status: (runId) => call(`/api/valorant/sync/status?runId=${encodeURIComponent(runId)}`),
  };
}
