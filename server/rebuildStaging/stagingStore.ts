import { createHash } from 'node:crypto';
import type { SqlDatabase, SqlExecutor } from '../db/types.js';
import { lookupHmac } from '../identityProtection.js';
import type { RequestRecord } from './providerGateway.js';
import { REBUILD_STAGING_SCHEMA_VERSION, STAGING_DDL } from './schema.js';

/** Private staging persistence (rebuild-staging-v1). Writes ONLY to the `rebuild_staging` schema. */
export type DiscoverySource = 'live_v4' | 'stored_index';
export type Affinity = 'ap' | 'eu' | 'na' | 'kr' | 'latam' | 'br';

export interface StagingAccount {
  accountPublicId: string;
  memberPublicId: string;
  communityName: string;
  gameName: string;
  tag: string;
  isPrimary: boolean;
  affinity: Affinity | null;
  providerPuuid: string | null;
}

export interface CursorState {
  nextPosition: number;
  exhausted: boolean;
  termination: string | null;
  lastFingerprint: string | null;
  repeatCount: number;
  providerTotal: number | null;
  pagesRead: number;
  entriesSeen: number;
}

export interface DiscoveredEntry {
  providerMatchId: string;
  startedAt: string | null;
  mode: string | null;
  mapName: string | null;
  seasonShort: string | null;
  /** live_v4 entries carry the full match document (hydrated for free); stored_index rows keep their row. */
  payload?: unknown;
  storedRow?: unknown;
}

export class StagingIsolationError extends Error {
  constructor(message: string) { super(message); this.name = 'StagingIsolationError'; }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export class RebuildStagingStore {
  constructor(private readonly database: SqlDatabase, private readonly hmacKey: string) {}

  /** Refuses any database that looks like a canonical application database; then creates the private schema. */
  async initialize(): Promise<void> {
    const canonical = await this.database.query<{ consents: string | null; migrations: string | null }>(
      `SELECT to_regclass('public.consents')::text AS consents, to_regclass('public.schema_migrations')::text AS migrations`);
    if (canonical.rows[0]?.consents || canonical.rows[0]?.migrations) {
      throw new StagingIsolationError('refusing: this is an application database (consents / schema_migrations present), not the private staging store.');
    }
    for (const statement of STAGING_DDL) await this.database.query(statement);
    const version = await this.database.query<{ value: string }>(`SELECT value FROM rebuild_staging.meta WHERE key='schema_version'`);
    if (version.rows[0]?.value !== REBUILD_STAGING_SCHEMA_VERSION) throw new StagingIsolationError('unexpected staging schema version.');
  }

  matchRef(providerMatchId: string): string { return lookupHmac('rebuild-staging-match:v1', providerMatchId, this.hmacKey); }

  async upsertAccounts(accounts: readonly Omit<StagingAccount, 'affinity' | 'providerPuuid'>[]): Promise<number> {
    await this.database.transaction(async (transaction) => {
      for (const account of accounts) {
        const result = await transaction.query<{ member_public_id: string; game_name: string; tag: string }>(
          `INSERT INTO rebuild_staging.accounts (account_public_id, member_public_id, community_name, game_name, tag, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (account_public_id) DO UPDATE SET community_name=EXCLUDED.community_name
           RETURNING member_public_id::text, game_name, tag`,
          [account.accountPublicId, account.memberPublicId, account.communityName, account.gameName, account.tag, account.isPrimary]);
        const row = result.rows[0]!;
        if (row.member_public_id !== account.memberPublicId || row.game_name !== account.gameName || row.tag !== account.tag) {
          throw new StagingIsolationError('an existing staging account conflicts with the member cache.');
        }
      }
    });
    return accounts.length;
  }

  async accounts(): Promise<StagingAccount[]> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT account_public_id::text, member_public_id::text, community_name, game_name, tag, is_primary, affinity, provider_puuid
       FROM rebuild_staging.accounts ORDER BY account_public_id`);
    return result.rows.map((row) => ({
      accountPublicId: row.account_public_id as string, memberPublicId: row.member_public_id as string,
      communityName: row.community_name as string, gameName: row.game_name as string, tag: row.tag as string,
      isPrimary: row.is_primary === true, affinity: (row.affinity as Affinity | null) ?? null, providerPuuid: (row.provider_puuid as string | null) ?? null,
    }));
  }

  async resolveAccount(accountPublicId: string, affinity: Affinity, providerPuuid: string): Promise<void> {
    const result = await this.database.query(
      `UPDATE rebuild_staging.accounts SET affinity=$2, provider_puuid=$3, resolved_at=now()
       WHERE account_public_id=$1 AND (provider_puuid IS NULL OR provider_puuid=$3)`, [accountPublicId, affinity, providerPuuid]);
    if (result.rowCount !== 1) throw new StagingIsolationError('account resolution conflicts with the stored provider identity.');
  }

  async cursor(accountPublicId: string, source: DiscoverySource): Promise<CursorState> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT next_position, exhausted, termination, last_fingerprint, repeat_count, provider_total, pages_read, entries_seen
       FROM rebuild_staging.cursors WHERE account_public_id=$1 AND source=$2`, [accountPublicId, source]);
    const row = result.rows[0];
    if (!row) return { nextPosition: source === 'stored_index' ? 1 : 0, exhausted: false, termination: null, lastFingerprint: null, repeatCount: 0, providerTotal: null, pagesRead: 0, entriesSeen: 0 };
    return {
      nextPosition: Number(row.next_position), exhausted: row.exhausted === true, termination: (row.termination as string | null) ?? null,
      lastFingerprint: (row.last_fingerprint as string | null) ?? null, repeatCount: Number(row.repeat_count),
      providerTotal: row.provider_total === null ? null : Number(row.provider_total), pagesRead: Number(row.pages_read), entriesSeen: Number(row.entries_seen),
    };
  }

  /** One discovery page, atomically: matches + account links + free live payloads + the advanced cursor. */
  async commitDiscoveryPage(input: {
    account: StagingAccount; source: DiscoverySource; entries: readonly DiscoveredEntry[]; cursor: CursorState; at: string;
  }): Promise<{ newMatches: number; newLinks: number; payloadsStored: number }> {
    const { account, source, entries, cursor, at } = input;
    if (!account.affinity) throw new StagingIsolationError('account affinity is not resolved.');
    return this.database.transaction(async (transaction) => {
      let newMatches = 0; let newLinks = 0; let payloadsStored = 0;
      for (const entry of entries) {
        const inserted = await transaction.query(
          `INSERT INTO rebuild_staging.matches (provider_match_id, match_ref, first_discovered_at, started_at, mode, map_name, season_short, detail_affinity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (provider_match_id) DO NOTHING`,
          [entry.providerMatchId, this.matchRef(entry.providerMatchId), at, entry.startedAt, entry.mode, entry.mapName, entry.seasonShort, account.affinity]);
        newMatches += inserted.rowCount;
        await transaction.query(
          `UPDATE rebuild_staging.matches SET started_at=COALESCE(started_at, $2), mode=COALESCE(mode, $3),
             map_name=COALESCE(map_name, $4), season_short=COALESCE(season_short, $5) WHERE provider_match_id=$1`,
          [entry.providerMatchId, entry.startedAt, entry.mode, entry.mapName, entry.seasonShort]);
        const link = await transaction.query<{ inserted: boolean }>(
          `INSERT INTO rebuild_staging.account_matches (account_public_id, provider_match_id, source, discovered_at, stored_row)
           VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (account_public_id, provider_match_id)
           DO UPDATE SET stored_row=COALESCE(rebuild_staging.account_matches.stored_row, EXCLUDED.stored_row)
           RETURNING (xmax = 0) AS inserted`,
          [account.accountPublicId, entry.providerMatchId, source, at, entry.storedRow === undefined ? null : JSON.stringify(entry.storedRow)]);
        if (link.rows[0]?.inserted === true) newLinks += 1;
        if (entry.payload !== undefined) payloadsStored += await this.storePayload(transaction, entry.providerMatchId, entry.payload, 'v4_history', at);
      }
      await this.writeCursor(transaction, account.accountPublicId, source, cursor);
      return { newMatches, newLinks, payloadsStored };
    });
  }

  async writeCursorOnly(accountPublicId: string, source: DiscoverySource, cursor: CursorState): Promise<void> {
    await this.database.transaction((transaction) => this.writeCursor(transaction, accountPublicId, source, cursor));
  }

  private async writeCursor(executor: SqlExecutor, accountPublicId: string, source: DiscoverySource, cursor: CursorState): Promise<void> {
    await executor.query(
      `INSERT INTO rebuild_staging.cursors (account_public_id, source, next_position, exhausted, termination, last_fingerprint,
         repeat_count, provider_total, pages_read, entries_seen, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (account_public_id, source) DO UPDATE SET next_position=EXCLUDED.next_position, exhausted=EXCLUDED.exhausted,
         termination=EXCLUDED.termination, last_fingerprint=EXCLUDED.last_fingerprint, repeat_count=EXCLUDED.repeat_count,
         provider_total=EXCLUDED.provider_total, pages_read=EXCLUDED.pages_read, entries_seen=EXCLUDED.entries_seen, updated_at=now()`,
      [accountPublicId, source, cursor.nextPosition, cursor.exhausted, cursor.termination, cursor.lastFingerprint,
        cursor.repeatCount, cursor.providerTotal, cursor.pagesRead, cursor.entriesSeen]);
  }

  /** Idempotent: an already stored payload is never replaced (first complete document wins). Returns 1 if new. */
  private async storePayload(executor: SqlExecutor, providerMatchId: string, payload: unknown, source: 'v4_detail' | 'v4_history', at: string): Promise<number> {
    const text = JSON.stringify(payload);
    const inserted = await executor.query(
      `INSERT INTO rebuild_staging.match_payloads (provider_match_id, source, payload, payload_sha256, fetched_at)
       VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (provider_match_id) DO NOTHING`,
      [providerMatchId, source, text, sha256(text), at]);
    await executor.query(
      `UPDATE rebuild_staging.matches SET hydration_status='hydrated', hydrated_at=COALESCE(hydrated_at, $2), last_error=NULL
       WHERE provider_match_id=$1`, [providerMatchId, at]);
    return inserted.rowCount;
  }

  /** Next unique matches still needing a detail fetch: Competitive first, newest first; never a hydrated one. */
  async pendingMatches(limit: number, maxAttempts: number): Promise<{ providerMatchId: string; affinity: Affinity }[]> {
    const result = await this.database.query<{ provider_match_id: string; detail_affinity: Affinity }>(
      `SELECT provider_match_id, detail_affinity FROM rebuild_staging.matches
       WHERE hydration_status IN ('pending','failed') AND hydration_attempts < $2
       ORDER BY (lower(coalesce(mode,'')) = 'competitive') DESC, started_at DESC NULLS LAST, provider_match_id
       LIMIT $1`, [limit, maxAttempts]);
    return result.rows.map((row) => ({ providerMatchId: row.provider_match_id, affinity: row.detail_affinity }));
  }

  async isHydrated(providerMatchId: string): Promise<boolean> {
    const result = await this.database.query<{ hydrated: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM rebuild_staging.match_payloads WHERE provider_match_id=$1) AS hydrated`, [providerMatchId]);
    return result.rows[0]?.hydrated === true;
  }

  async commitDetail(providerMatchId: string, payload: unknown, at: string, metadata: { startedAt: string | null; mode: string | null }): Promise<number> {
    return this.database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE rebuild_staging.matches SET hydration_attempts=hydration_attempts+1, started_at=COALESCE($2, started_at),
           mode=COALESCE($3, mode) WHERE provider_match_id=$1`, [providerMatchId, metadata.startedAt, metadata.mode]);
      return this.storePayload(transaction, providerMatchId, payload, 'v4_detail', at);
    });
  }

  async markHydrationOutcome(providerMatchId: string, status: 'unavailable' | 'failed', reason: string): Promise<void> {
    await this.database.query(
      `UPDATE rebuild_staging.matches SET hydration_status=$2, hydration_attempts=hydration_attempts+1, last_error=$3
       WHERE provider_match_id=$1 AND hydration_status <> 'hydrated'`, [providerMatchId, status, reason]);
  }

  async recordRequest(request: RequestRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO rebuild_staging.provider_requests (at, category, http_status, outcome, duration_ms, rl_limit, rl_remaining, rl_reset)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [request.at, request.category, request.httpStatus, request.outcome, request.durationMs,
        request.rateLimit?.limit ?? null, request.rateLimit?.remaining ?? null, request.rateLimit?.reset ?? null]);
  }

  /** Request starts of earlier processes inside the last `windowMs` (to seed the rolling-window limiter). */
  async recentRequestStarts(windowMs: number): Promise<number[]> {
    const result = await this.database.query<{ at: string | Date }>(
      `SELECT at FROM rebuild_staging.provider_requests WHERE at > now() - ($1::double precision * interval '1 millisecond') ORDER BY at`, [windowMs]);
    return result.rows.map((row) => new Date(row.at).getTime());
  }

  async startRun(command: string): Promise<number> {
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO rebuild_staging.runs (started_at, command, status) VALUES (now(), $1, 'running') RETURNING id::text`, [command]);
    return Number(result.rows[0]!.id);
  }

  async finishRun(id: number, status: 'complete' | 'stopped' | 'failed', stopReason: string | null, summary: Record<string, unknown>): Promise<void> {
    await this.database.query(
      `UPDATE rebuild_staging.runs SET finished_at=now(), status=$2, stop_reason=$3, summary=$4::jsonb WHERE id=$1`,
      [id, status, stopReason, JSON.stringify(summary)]);
  }

  /** Identifier-free progress counters (safe to log). */
  async counts(): Promise<Record<string, number>> {
    const result = await this.database.query<Record<string, string>>(`SELECT
      (SELECT count(*) FROM rebuild_staging.accounts)::text AS accounts,
      (SELECT count(*) FROM rebuild_staging.accounts WHERE affinity IS NOT NULL AND provider_puuid IS NOT NULL)::text AS resolved,
      (SELECT count(*) FROM rebuild_staging.account_matches)::text AS discovered_links,
      (SELECT count(*) FROM rebuild_staging.matches)::text AS unique_discovered,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='hydrated')::text AS hydrated,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='unavailable')::text AS unavailable,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='failed')::text AS failed,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='pending')::text AS pending,
      (SELECT count(*) FROM rebuild_staging.cursors WHERE exhausted)::text AS exhausted_cursors,
      (SELECT count(*) FROM rebuild_staging.provider_requests)::text AS provider_requests`);
    return Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]));
  }
}
