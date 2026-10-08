import { createHash } from 'node:crypto';
import type { SqlDatabase } from '../db/types.js';
import { normalizeTier, RANK_TIER_MODEL_VERSION } from '../../src/analytics/rank/tiers.js';
import type { RankEvidence, RankEvidenceKind } from '../../src/analytics/rank/rankContext.js';
import type { ParsedRankEvidence } from './henrikRankParser.js';

/**
 * TASK-DATA-RANK-01 — PRIVATE rank evidence store (`rank-staging-v1`), a separate schema inside the private
 * staging database next to rebuild-staging-v1 (whose tables are never altered). It references the existing
 * private stable account identity (rebuild_staging.accounts.account_public_id), never Name#Tag, and stores no raw
 * provider account id. Not a migration, never in a canonical database (the caller's RebuildStagingStore.initialize
 * refuses application databases first).
 *
 * Idempotency (`evidence_key`):
 *   match_snapshot / history → one row per (account, kind, match) — re-ingesting is a no-op;
 *   current / peak           → one row per distinct observed STATE; re-observing it bumps last_ingested_at/count,
 *                              a changed state is a NEW row (history of observations);
 *   seasonal                 → one row per (account, season), updated in place (values evolve during a season).
 */
export const RANK_STAGING_SCHEMA_VERSION = 'rank-staging-v1' as const;

export const RANK_STAGING_DDL: readonly string[] = [
  `CREATE SCHEMA IF NOT EXISTS rank_staging`,
  `CREATE TABLE IF NOT EXISTS rank_staging.meta (key text PRIMARY KEY, value text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rank_staging.rank_evidence (
     evidence_key text PRIMARY KEY CHECK (evidence_key ~ '^[0-9a-f]{64}$'),
     account_public_id uuid NOT NULL REFERENCES rebuild_staging.accounts(account_public_id),
     kind text NOT NULL CHECK (kind IN ('match_snapshot','history','current','peak','seasonal')),
     source text NOT NULL,
     effective_at timestamptz NOT NULL,
     first_ingested_at timestamptz NOT NULL,
     last_ingested_at timestamptz NOT NULL,
     observation_count integer NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
     season_id text, season_short text,
     provider_tier_id integer, provider_tier_name text,
     rr integer, provider_elo integer, rr_change integer,
     match_ref text, queue text,
     normalized_tier_key text, tier_ordinal integer CHECK (tier_ordinal IS NULL OR tier_ordinal BETWEEN 1 AND 25),
     tier_model_version text NOT NULL,
     extra jsonb NOT NULL DEFAULT '{}'::jsonb
   )`,
  `CREATE INDEX IF NOT EXISTS rank_evidence_account_time ON rank_staging.rank_evidence (account_public_id, effective_at)`,
  `CREATE TABLE IF NOT EXISTS rank_staging.ingestion_state (
     account_public_id uuid NOT NULL REFERENCES rebuild_staging.accounts(account_public_id),
     endpoint text NOT NULL CHECK (endpoint IN ('v3_mmr','v2_stored_mmr_history','v4_match_snapshots')),
     last_attempt_at timestamptz NOT NULL,
     last_status text NOT NULL,
     rows_parsed integer NOT NULL DEFAULT 0,
     provider_total integer,
     provider_returned integer,
     PRIMARY KEY (account_public_id, endpoint)
   )`,
  `INSERT INTO rank_staging.meta (key, value) VALUES ('schema_version', '${RANK_STAGING_SCHEMA_VERSION}') ON CONFLICT (key) DO NOTHING`,
];

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export function evidenceKey(row: Pick<RankEvidence, 'accountId' | 'kind' | 'matchRef' | 'effectiveAt' | 'seasonId' | 'seasonShort' | 'providerTierId' | 'providerTierName' | 'rr' | 'providerElo' | 'rrChange'>): string {
  const season = row.seasonId ?? row.seasonShort ?? '';
  const state = [row.providerTierId, row.providerTierName, row.rr, row.providerElo, row.rrChange].map((value) => value ?? '').join('|');
  const byKind: Record<RankEvidenceKind, string> = {
    match_snapshot: `match:${row.matchRef ?? row.effectiveAt}`,
    history: `match:${row.matchRef ?? row.effectiveAt}`,
    current: `state:${state}`,
    peak: `state:${season}|${state}`,
    seasonal: `season:${season}`,
  };
  return sha(`rank-evidence:v1|${row.accountId}|${row.kind}|${byKind[row.kind]}`);
}

export class RankStagingStore {
  constructor(private readonly database: SqlDatabase) {}

  async initialize(): Promise<void> {
    for (const statement of RANK_STAGING_DDL) await this.database.query(statement);
  }

  /** Idempotent upsert. Returns the number of NEW logical observations. */
  async upsert(rows: readonly ParsedRankEvidence[]): Promise<number> {
    if (rows.length === 0) return 0;
    return this.database.transaction(async (transaction) => {
      let created = 0;
      for (const row of rows) {
        const key = evidenceKey(row);
        const result = await transaction.query<{ inserted: boolean }>(
          `INSERT INTO rank_staging.rank_evidence (evidence_key, account_public_id, kind, source, effective_at, first_ingested_at, last_ingested_at,
             season_id, season_short, provider_tier_id, provider_tier_name, rr, provider_elo, rr_change, match_ref, queue,
             normalized_tier_key, tier_ordinal, tier_model_version, extra)
           VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
           ON CONFLICT (evidence_key) DO UPDATE SET
             last_ingested_at = GREATEST(rank_staging.rank_evidence.last_ingested_at, EXCLUDED.last_ingested_at),
             observation_count = rank_staging.rank_evidence.observation_count + 1,
             -- seasonal summaries evolve during a season: the latest observation wins; other kinds keep their facts.
             provider_tier_id = CASE WHEN EXCLUDED.kind='seasonal' THEN EXCLUDED.provider_tier_id ELSE rank_staging.rank_evidence.provider_tier_id END,
             provider_tier_name = CASE WHEN EXCLUDED.kind='seasonal' THEN EXCLUDED.provider_tier_name ELSE rank_staging.rank_evidence.provider_tier_name END,
             rr = CASE WHEN EXCLUDED.kind='seasonal' THEN EXCLUDED.rr ELSE rank_staging.rank_evidence.rr END,
             normalized_tier_key = CASE WHEN EXCLUDED.kind='seasonal' THEN EXCLUDED.normalized_tier_key ELSE rank_staging.rank_evidence.normalized_tier_key END,
             tier_ordinal = CASE WHEN EXCLUDED.kind='seasonal' THEN EXCLUDED.tier_ordinal ELSE rank_staging.rank_evidence.tier_ordinal END,
             effective_at = CASE WHEN EXCLUDED.kind='seasonal' THEN EXCLUDED.effective_at ELSE rank_staging.rank_evidence.effective_at END,
             extra = CASE WHEN EXCLUDED.kind='seasonal' THEN EXCLUDED.extra ELSE rank_staging.rank_evidence.extra END
           RETURNING (xmax = 0) AS inserted`,
          [key, row.accountId, row.kind, row.source, row.effectiveAt, row.ingestedAt, row.seasonId, row.seasonShort,
            row.providerTierId, row.providerTierName, row.rr, row.providerElo, row.rrChange, row.matchRef, row.queue,
            row.normalized?.key ?? null, row.normalized?.tierOrdinal ?? null, RANK_TIER_MODEL_VERSION, JSON.stringify(row.extra)]);
        if (result.rows[0]?.inserted === true) created += 1;
      }
      return created;
    });
  }

  async recordState(input: { accountId: string; endpoint: 'v3_mmr' | 'v2_stored_mmr_history' | 'v4_match_snapshots'; status: string; rowsParsed: number; total?: number | null; returned?: number | null }): Promise<void> {
    await this.database.query(
      `INSERT INTO rank_staging.ingestion_state (account_public_id, endpoint, last_attempt_at, last_status, rows_parsed, provider_total, provider_returned)
       VALUES ($1,$2,now(),$3,$4,$5,$6) ON CONFLICT (account_public_id, endpoint) DO UPDATE SET last_attempt_at=now(),
         last_status=EXCLUDED.last_status, rows_parsed=EXCLUDED.rows_parsed, provider_total=EXCLUDED.provider_total, provider_returned=EXCLUDED.provider_returned`,
      [input.accountId, input.endpoint, input.status, input.rowsParsed, input.total ?? null, input.returned ?? null]);
  }

  async attempted(accountId: string, endpoint: string): Promise<string | null> {
    const result = await this.database.query<{ last_status: string }>(
      `SELECT last_status FROM rank_staging.ingestion_state WHERE account_public_id=$1 AND endpoint=$2`, [accountId, endpoint]);
    return result.rows[0]?.last_status ?? null;
  }

  /** Provider-independent evidence for the rank-context-v1 resolver. */
  async evidence(accountId?: string): Promise<RankEvidence[]> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT account_public_id::text AS account_id, kind, source, effective_at, last_ingested_at, season_id, season_short, provider_tier_id,
         provider_tier_name, rr, provider_elo, rr_change, match_ref, queue
       FROM rank_staging.rank_evidence ${accountId ? 'WHERE account_public_id=$1' : ''} ORDER BY effective_at`, accountId ? [accountId] : []);
    return result.rows.map((row) => ({
      accountId: String(row.account_id), kind: row.kind as RankEvidenceKind, source: String(row.source),
      effectiveAt: new Date(row.effective_at as string).toISOString(), ingestedAt: new Date(row.last_ingested_at as string).toISOString(),
      seasonId: (row.season_id as string | null) ?? null, seasonShort: (row.season_short as string | null) ?? null,
      providerTierId: (row.provider_tier_id as number | null) ?? null, providerTierName: (row.provider_tier_name as string | null) ?? null,
      rr: (row.rr as number | null) ?? null, providerElo: (row.provider_elo as number | null) ?? null, rrChange: (row.rr_change as number | null) ?? null,
      matchRef: (row.match_ref as string | null) ?? null, queue: (row.queue as string | null) ?? null,
      normalized: normalizeTier({ name: (row.provider_tier_name as string | null) ?? null }),
    }));
  }
}
