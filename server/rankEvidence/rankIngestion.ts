import { PublicApiError } from '../errors.js';
import type { SqlDatabase } from '../db/types.js';
import type { ProviderAccountRef } from '../henrikDataProvider.js';
import type { RequestRecord } from '../rebuildStaging/providerGateway.js';
import type { RebuildStagingStore, StagingAccount } from '../rebuildStaging/stagingStore.js';
import { matchSnapshot, parseMmrV3, parseStoredMmrHistory, RankPayloadError } from './henrikRankParser.js';
import type { RankStagingStore } from './rankStagingStore.js';

/**
 * TASK-DATA-RANK-01 ingestion. Two sources:
 *   1. match-time snapshots from the already-hydrated private v4 match documents (0 provider requests);
 *   2. per account, ONE v3 MMR request (current + peak + seasonal) and ONE v2 stored-MMR-history request.
 * Provider calls go through the private rebuild gateway (shared ≤ 6 / 60 s limiter seeded from the persisted
 * request log, weighted-budget pause, sanitized accounting). Each (account, endpoint) that succeeded is never
 * requested again (resume without redundant calls).
 */
export interface RankProvider {
  fetchMmrV3(input: ProviderAccountRef): Promise<unknown>;
  fetchStoredMmrHistory(input: ProviderAccountRef, size: number): Promise<unknown>;
}

export async function ingestMatchSnapshots(database: SqlDatabase, rebuild: RebuildStagingStore, rank: RankStagingStore): Promise<{ links: number; snapshots: number; created: number; withoutTier: number }> {
  const accounts = (await rebuild.accounts()).filter((account) => account.providerPuuid);
  let links = 0; let snapshots = 0; let created = 0; let withoutTier = 0;
  for (const account of accounts) {
    const result = await database.query<{ match_ref: string; payload: unknown }>(
      `SELECT m.match_ref, p.payload FROM rebuild_staging.account_matches am
       JOIN rebuild_staging.matches m ON m.provider_match_id=am.provider_match_id
       JOIN rebuild_staging.match_payloads p ON p.provider_match_id=am.provider_match_id
       WHERE am.account_public_id=$1 ORDER BY m.started_at`, [account.accountPublicId]);
    const ingestedAt = new Date().toISOString();
    const rows = [];
    for (const row of result.rows) {
      links += 1;
      const snapshot = matchSnapshot(row.payload, account.providerPuuid!, { accountId: account.accountPublicId, ingestedAt, matchRef: row.match_ref });
      if (snapshot) rows.push(snapshot); else withoutTier += 1;
    }
    snapshots += rows.length;
    created += await rank.upsert(rows);
    await rank.recordState({ accountId: account.accountPublicId, endpoint: 'v4_match_snapshots', status: 'ok', rowsParsed: rows.length });
  }
  return { links, snapshots, created, withoutTier };
}

export type RankStopReason = 'budget_reached' | 'provider_429' | 'credential_rejected' | 'repeated_provider_errors' | 'malformed_payload';

export interface ProviderIngestOptions {
  provider: RankProvider;
  rebuild: RebuildStagingStore;
  rank: RankStagingStore;
  /** Requests already used by this task (persisted accounting) and the task-wide ceiling. */
  requestsUsed: () => Promise<number>;
  maxTaskRequests: number;
  historySize: number;
  lastRequest: () => RequestRecord | undefined;
  onEvent: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  accountLimit?: number;
}

export async function ingestProviderRank(options: ProviderIngestOptions): Promise<{ stopReason: RankStopReason | null; created: number; attemptedAccounts: number }> {
  const accounts = (await options.rebuild.accounts()).filter((account): account is StagingAccount & { affinity: NonNullable<StagingAccount['affinity']> } => Boolean(account.affinity && account.providerPuuid));
  let created = 0; let consecutiveErrors = 0; let attempted = 0;
  const selected = accounts.slice(0, options.accountLimit ?? accounts.length);
  for (const account of selected) {
    const ref: ProviderAccountRef = { gameName: account.gameName, tag: account.tag, affinity: account.affinity };
    let touched = false;
    for (const endpoint of ['v3_mmr', 'v2_stored_mmr_history'] as const) {
      if (await options.rank.attempted(account.accountPublicId, endpoint) === 'ok') continue;
      if (await options.requestsUsed() >= options.maxTaskRequests) return { stopReason: 'budget_reached', created, attemptedAccounts: attempted };
      touched = true;
      const observedAt = new Date().toISOString();
      try {
        const payload = endpoint === 'v3_mmr' ? await options.provider.fetchMmrV3(ref) : await options.provider.fetchStoredMmrHistory(ref, options.historySize);
        const base = { accountId: account.accountPublicId, observedAt, ingestedAt: observedAt };
        if (endpoint === 'v3_mmr') {
          const rows = parseMmrV3(payload, base);
          created += await options.rank.upsert(rows);
          await options.rank.recordState({ accountId: account.accountPublicId, endpoint, status: 'ok', rowsParsed: rows.length });
        } else {
          const parsed = parseStoredMmrHistory(payload, base, (id) => options.rebuild.matchRef(id));
          created += await options.rank.upsert(parsed.rows);
          await options.rank.recordState({ accountId: account.accountPublicId, endpoint, status: 'ok', rowsParsed: parsed.rows.length, total: parsed.total, returned: parsed.returned });
        }
        consecutiveErrors = 0;
      } catch (error) {
        const status = options.lastRequest()?.httpStatus ?? null;
        if (error instanceof RankPayloadError) {
          await options.rank.recordState({ accountId: account.accountPublicId, endpoint, status: 'malformed', rowsParsed: 0 });
          return { stopReason: 'malformed_payload', created, attemptedAccounts: attempted + 1 };
        }
        if (!(error instanceof PublicApiError)) throw error;
        if (error.code === 'RATE_LIMITED') return { stopReason: 'provider_429', created, attemptedAccounts: attempted + 1 };
        if (status === 401 || status === 403) return { stopReason: 'credential_rejected', created, attemptedAccounts: attempted + 1 };
        await options.rank.recordState({ accountId: account.accountPublicId, endpoint, status: error.code === 'ACCOUNT_NOT_FOUND' ? 'not_found' : 'error', rowsParsed: 0 });
        if (error.code !== 'ACCOUNT_NOT_FOUND') {
          consecutiveErrors += 1;
          if (consecutiveErrors >= 2) return { stopReason: 'repeated_provider_errors', created, attemptedAccounts: attempted + 1 };
        }
      }
      options.onEvent('rank_endpoint_done', { endpoint, member: account.communityName, requests_used: await options.requestsUsed() });
    }
    if (touched) attempted += 1;
  }
  return { stopReason: null, created, attemptedAccounts: attempted };
}
