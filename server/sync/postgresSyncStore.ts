import { randomUUID } from 'node:crypto';
import type { SqlDatabase, SqlExecutor } from '../db/types.js';
import { PublicApiError } from '../errors.js';
import type {
  PublicSyncStatus,
  SyncChunkMetrics,
  SyncCursorRecord,
  SyncErrorCategory,
  SyncKind,
  SyncRunRecord,
  SyncStatus,
  SyncSubject,
  SyncTerminationReason,
  DeepCursorState,
} from './types.js';
import { PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION } from '../../shared/privacyPolicy.js';
import type { ScheduledJob, ScheduledCandidate } from './scheduledSyncService.js';
import type { RecentRefreshState } from './recentRefresh.js';

type SubjectRow = {
  player_id: string;
  public_player_id: string;
  squad_id: string;
  display_name: string;
  display_tag: string;
  affinity: string;
};

type CursorRow = {
  history_phase: DeepCursorState['historyPhase'];
  stored_page: number;
  stored_item_index: number;
  stored_total: number | null;
  discovery_page: number | null;
  live_history_exhausted: boolean;
  stored_history_exhausted: boolean;
  id: string;
  player_id: string;
  sync_kind: SyncKind;
  next_start: number;
  coverage_from: string | Date | null;
  coverage_to: string | Date | null;
  last_provider_match_boundary_hmac: string | null;
  last_page_fingerprint_hmac: string | null;
  last_successful_page: number | null;
  retry_count: number;
  next_attempt_at: string | Date | null;
  coverage_complete_for_provider_window: boolean;
  coverage_incomplete_reason: string | null;
};

type RunRow = SubjectRow & {
  id: string;
  public_id: string;
  sync_kind: SyncKind;
  status: SyncStatus;
  cursor_start: number | null;
  next_attempt_at: string | Date | null;
};

type StatusRow = {
  history_phase: DeepCursorState['historyPhase'];
  stored_page: number;
  stored_item_index: number;
  stored_total: number | null;
  discovery_page: number | null;
  live_history_exhausted: boolean;
  stored_history_exhausted: boolean;
  stored_matches_seen: number;
  detail_requests: number;
  detail_unavailable_count: number;
  public_id: string;
  sync_kind: SyncKind;
  status: SyncStatus;
  page_count: number;
  matches_seen: number;
  matches_persisted: number;
  overlap_count: number;
  retry_count: number;
  coverage_from: string | Date | null;
  coverage_to: string | Date | null;
  last_success_at: string | Date | null;
  coverage_complete_for_provider_window: boolean;
  coverage_incomplete_reason: string | null;
  termination_reason: SyncTerminationReason | null;
  last_error_category: SyncErrorCategory | null;
  next_attempt_at: string | Date | null;
  provider_fetch_ms: number | string;
  normalization_ms: number | string;
  database_ms: number | string;
  total_ms: number | string;
  sql_query_count: number;
  provider_request_count: number;
};

function iso(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function subjectFromRow(row: SubjectRow): SyncSubject {
  return {
    playerId: row.player_id,
    publicPlayerId: row.public_player_id,
    squadId: row.squad_id,
    gameName: row.display_name,
    tag: row.display_tag,
    affinity: row.affinity,
  };
}

function cursorFromRow(row: CursorRow): SyncCursorRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    kind: row.sync_kind,
    nextStart: Number(row.next_start),
    coverageFrom: iso(row.coverage_from),
    coverageTo: iso(row.coverage_to),
    lastBoundaryHmac: row.last_provider_match_boundary_hmac ?? undefined,
    lastPageFingerprintHmac: row.last_page_fingerprint_hmac ?? undefined,
    lastSuccessfulPage: row.last_successful_page ?? undefined,
    retryCount: Number(row.retry_count),
    nextAttemptAt: iso(row.next_attempt_at),
    completeForProviderWindow: row.coverage_complete_for_provider_window,
    incompleteReason: row.coverage_incomplete_reason ?? undefined,
    ...(row.sync_kind === 'deep_backfill' ? { deep: deepFromRow(row) } : {}),
  };
}

function deepFromRow(row: Pick<CursorRow, 'history_phase' | 'stored_page' | 'stored_item_index' | 'stored_total' | 'discovery_page' | 'live_history_exhausted' | 'stored_history_exhausted'>): DeepCursorState {
  return {
    historyPhase: row.history_phase, storedPage: Number(row.stored_page),
    storedItemIndex: Number(row.stored_item_index), storedTotal: row.stored_total ?? undefined,
    discoveryPage: row.discovery_page ?? undefined, liveHistoryExhausted: row.live_history_exhausted,
    storedHistoryExhausted: row.stored_history_exhausted,
  };
}

export class PostgresSyncStore {
  constructor(private readonly database: SqlDatabase) {}

  async withScheduledLock<T>(work: () => Promise<T>): Promise<T | undefined> {
    // Transaction-scoped advisory lock uses a dedicated pool connection, not a
    // session lock that can leak across pooled callers. Work commits independently.
    return this.database.transaction(async (tx) => {
      const lock = await tx.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock(50501,1) AS acquired');
      if (!lock.rows[0]?.acquired) return undefined;
      return work();
    });
  }

  async duePlayers(job: ScheduledJob, at: string): Promise<ScheduledCandidate[]> {
    const kind = job === 'recent' ? 'incremental' : 'deep_backfill';
    const result = await this.database.query<{ public_id: string }>(`
      SELECT p.public_id FROM players p
      JOIN LATERAL (SELECT affinity FROM provider_identities WHERE player_id=p.id
        AND provider='HenrikDev' ORDER BY created_at LIMIT 1) pi ON true
      LEFT JOIN sync_cursors sc ON sc.player_id=p.id AND sc.provider='HenrikDev'
        AND sc.affinity=pi.affinity AND sc.queue_scope='*' AND sc.sync_kind=$4
      LEFT JOIN LATERAL (SELECT status,termination_reason,completed_at,started_at FROM sync_runs
        WHERE player_id=p.id AND provider='HenrikDev' AND sync_kind=$4
        ORDER BY started_at DESC LIMIT 1) sr ON true
      WHERE p.anonymized_at IS NULL
        AND EXISTS(SELECT 1 FROM squad_memberships WHERE player_id=p.id AND status='active')
        AND EXISTS(SELECT 1 FROM consents WHERE player_id=p.id AND status='active'
          AND consent_method=$2 AND privacy_version=$3)
        AND NOT EXISTS(SELECT 1 FROM deletion_jobs WHERE player_id=p.id AND status<>'complete')
        AND (sc.lease_token IS NULL OR sc.lease_expires_at <= $1::timestamptz)
        AND (sc.next_attempt_at IS NULL OR sc.next_attempt_at <= $1::timestamptz)
        AND CASE WHEN $4='incremental' THEN
          (sc.last_success_at IS NULL OR sc.last_success_at <= $1::timestamptz - interval '20 hours' OR sr.status IS NULL)
        ELSE sr.status IS NULL OR sr.status IN ('paused','pending','running')
          OR (sr.status='failed' AND sr.termination_reason='provider_repeated_page')
          OR (sr.status='complete' AND sr.completed_at <= $1::timestamptz -
            CASE WHEN sc.live_history_exhausted AND sc.stored_history_exhausted
              THEN interval '30 days' ELSE interval '7 days' END) END
      ORDER BY CASE WHEN $4='incremental' THEN 0
        WHEN sr.status IN ('paused','pending','running','failed') THEN 0
        WHEN sr.status IS NULL THEN 1
        WHEN sc.live_history_exhausted AND sc.stored_history_exhausted THEN 3 ELSE 2 END,
        CASE WHEN $4='incremental' THEN sc.last_success_at ELSE sc.updated_at END ASC NULLS FIRST,
        sc.updated_at ASC NULLS FIRST,
        p.public_id`, [at, PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION, kind]);
    return result.rows.map((row) => ({ publicPlayerId: row.public_id }));
  }

  async findSubject(publicPlayerId: string): Promise<SyncSubject | undefined> {
    const result = await this.database.query<SubjectRow>(
      `SELECT p.id AS player_id, p.public_id AS public_player_id, sm.squad_id,
              p.display_name, p.display_tag, pi.affinity
       FROM players p
       JOIN provider_identities pi ON pi.player_id=p.id AND pi.provider='HenrikDev'
       JOIN squad_memberships sm ON sm.player_id=p.id AND sm.status='active'
       WHERE p.public_id=$1
       ORDER BY pi.created_at ASC LIMIT 1`,
      [publicPlayerId],
    );
    return result.rows[0] ? subjectFromRow(result.rows[0]) : undefined;
  }

  async hasActiveConsent(playerId: string): Promise<boolean> {
    const result = await this.database.query<{ active: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM consents c JOIN players p ON p.id=c.player_id
         WHERE player_id=$1 AND status='active' AND consent_method=$2 AND privacy_version=$3
           AND p.anonymized_at IS NULL
           AND EXISTS(SELECT 1 FROM squad_memberships WHERE player_id=p.id AND status='active')
           AND NOT EXISTS(SELECT 1 FROM deletion_jobs WHERE player_id=p.id AND status<>'complete')
       ) AS active`,
      [playerId, PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION],
    );
    return result.rows[0]?.active === true;
  }

  /**
   * TASK-DATA-FASTSYNC-01: durable inputs for decideRecentRefresh in ONE query (eligibility, the
   * incremental cursor and the latest incremental run). Server-internal; never returned as-is.
   */
  async recentRefreshState(subject: SyncSubject): Promise<RecentRefreshState> {
    const result = await this.database.query<{
      eligible: boolean; version: string | null; last_success_at: string | Date | null; last_error_at: string | Date | null;
      next_attempt_at: string | Date | null; lease_expires_at: string | Date | null; lease_token: string | null;
      run_public_id: string | null; run_status: SyncStatus | null;
    }>(
      `SELECT EXISTS(
           SELECT 1 FROM consents c JOIN players p ON p.id=c.player_id
           WHERE c.player_id=$1 AND c.status='active' AND c.consent_method=$3 AND c.privacy_version=$4
             AND p.anonymized_at IS NULL
             AND EXISTS(SELECT 1 FROM squad_memberships WHERE player_id=p.id AND status='active')
             AND EXISTS(SELECT 1 FROM provider_identities WHERE player_id=p.id AND provider='HenrikDev')
             AND NOT EXISTS(SELECT 1 FROM deletion_jobs WHERE player_id=p.id AND status<>'complete')) AS eligible,
         (extract(epoch FROM sc.updated_at)*1000000)::bigint::text AS version,
         sc.last_success_at, sc.last_error_at, sc.next_attempt_at, sc.lease_expires_at, sc.lease_token,
         sr.public_id AS run_public_id, sr.status AS run_status
       FROM (SELECT 1) one
       LEFT JOIN sync_cursors sc ON sc.player_id=$1 AND sc.provider='HenrikDev' AND sc.affinity=$2
         AND sc.queue_scope='*' AND sc.sync_kind='incremental'
       LEFT JOIN LATERAL (SELECT public_id, status FROM sync_runs WHERE player_id=$1 AND provider='HenrikDev'
         AND sync_kind='incremental' AND public_id IS NOT NULL ORDER BY started_at DESC LIMIT 1) sr ON true`,
      [subject.playerId, subject.affinity, PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION],
    );
    const row = result.rows[0];
    return {
      eligible: row?.eligible === true,
      ...(row?.version ? { cursor: {
        version: row.version,
        lastSuccessAt: iso(row.last_success_at),
        lastErrorAt: iso(row.last_error_at),
        nextAttemptAt: iso(row.next_attempt_at),
        leaseExpiresAt: row.lease_token ? iso(row.lease_expires_at) : undefined,
      } } : {}),
      ...(row?.run_public_id && row.run_status ? { latestRun: { publicId: row.run_public_id, status: row.run_status } } : {}),
    };
  }

  private async ensureCursorRow(transaction: SqlExecutor, subject: SyncSubject, kind: SyncKind): Promise<{ id: string; inserted: boolean }> {
    const id = randomUUID();
    const insert = await transaction.query(
      `INSERT INTO sync_cursors (id, player_id, provider, affinity, queue_scope, sync_kind, history_rule_version)
       VALUES ($1,$2,'HenrikDev',$3,'*',$4,CASE WHEN $4='deep_backfill' THEN 'deep-history-v1' ELSE NULL END)
       ON CONFLICT (player_id, provider, affinity, queue_scope, sync_kind) DO NOTHING`,
      [id, subject.playerId, subject.affinity, kind],
    );
    const result = await transaction.query<{ id: string }>(
      `SELECT id FROM sync_cursors
       WHERE player_id=$1 AND provider='HenrikDev' AND affinity=$2 AND queue_scope='*' AND sync_kind=$3`,
      [subject.playerId, subject.affinity, kind],
    );
    if (!result.rows[0]) throw new Error('Sync cursor could not be created.');
    return { id: result.rows[0].id, inserted: insert.rowCount === 1 && result.rows[0].id === id };
  }

  async acquireCursorLease(
    subject: SyncSubject,
    kind: SyncKind,
    now: string,
    leaseExpiresAt: string,
    resetCompletedIncremental = false,
    resetTerminalDeep = false,
    /**
     * TASK-DATA-FASTSYNC-01 race guard: the cursor version the freshness decision observed
     * (null = no cursor existed). Re-checked under a row lock inside this transaction, so a
     * concurrent refresh that already did (or is doing) work makes this acquisition fail.
     */
    expectedVersion?: string | null,
  ): Promise<{ cursor: SyncCursorRecord; leaseToken: string } | undefined> {
    return this.database.transaction(async (transaction) => {
      const consent = await transaction.query<{ id: string }>(
        `SELECT id FROM consents WHERE player_id=$1 AND status='active'
           AND consent_method=$2 AND privacy_version=$3 FOR SHARE`,
        [subject.playerId, PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION],
      );
      if (!consent.rows[0]) {
        throw new PublicApiError(409, 'CONSENT_REVOKED', '玩家同意目前不是有效狀態，未建立同步租約。');
      }
      const ensured = await this.ensureCursorRow(transaction, subject, kind);
      const cursorId = ensured.id;
      if (expectedVersion !== undefined) {
        const current = await transaction.query<{ version: string }>(
          `SELECT (extract(epoch FROM updated_at)*1000000)::bigint::text AS version
           FROM sync_cursors WHERE id=$1 FOR UPDATE`, [cursorId]);
        const unchanged = expectedVersion === null ? ensured.inserted : current.rows[0]?.version === expectedVersion;
        if (!unchanged) return undefined;
      }
      if (kind === 'deep_backfill' && resetTerminalDeep) {
        // Conditional reset under the cursor lease transaction: audit/data are preserved.
        await transaction.query(`UPDATE sync_cursors sc SET next_start=0, history_phase='live_v4',
          stored_page=1,stored_item_index=0,stored_total=NULL,discovery_page=NULL,
          live_history_exhausted=false,stored_history_exhausted=false,
          last_page_fingerprint_hmac=NULL,last_provider_match_boundary_hmac=NULL,
          last_successful_page=NULL,retry_count=0,next_attempt_at=NULL,
          last_error_category=NULL,last_success_at=NULL,coverage_complete_for_provider_window=false,
          coverage_incomplete_reason=NULL,updated_at=$2
          WHERE sc.id=$1 AND (lease_token IS NULL OR lease_expires_at <= $2)
          AND (SELECT status FROM sync_runs WHERE player_id=sc.player_id AND sync_kind='deep_backfill'
            ORDER BY started_at DESC LIMIT 1)='complete'
          AND (SELECT completed_at FROM sync_runs WHERE player_id=sc.player_id AND sync_kind='deep_backfill'
            ORDER BY started_at DESC LIMIT 1) <= $2::timestamptz -
            CASE WHEN sc.live_history_exhausted AND sc.stored_history_exhausted
              THEN interval '30 days' ELSE interval '7 days' END`, [cursorId, now]);
        const latest = await transaction.query<{ status: string; history_phase: string; next_start: number; last_success_at: string | null }>(
          `SELECT sr.status,sc.history_phase,sc.next_start,sc.last_success_at FROM sync_cursors sc JOIN LATERAL
           (SELECT status FROM sync_runs WHERE player_id=sc.player_id AND sync_kind='deep_backfill'
            ORDER BY started_at DESC LIMIT 1) sr ON true WHERE sc.id=$1`, [cursorId]);
        if (latest.rows[0] && (latest.rows[0].status !== 'complete'
          || latest.rows[0].history_phase !== 'live_v4' || latest.rows[0].next_start !== 0
          || latest.rows[0].last_success_at !== null)) return undefined;
      }
      if (kind === 'incremental' && resetCompletedIncremental) {
        await transaction.query(
          `UPDATE sync_cursors SET next_start=0, last_successful_page=NULL,
             last_page_fingerprint_hmac=NULL, coverage_complete_for_provider_window=false,
             coverage_incomplete_reason=NULL, updated_at=$2
           WHERE id=$1 AND coverage_complete_for_provider_window=true
             AND (lease_token IS NULL OR lease_expires_at <= $2)`,
          [cursorId, now],
        );
      }
      const leaseToken = randomUUID();
      const result = await transaction.query<CursorRow>(
        `UPDATE sync_cursors SET lease_token=$2, lease_expires_at=$3, updated_at=$4
         WHERE id=$1 AND (lease_token IS NULL OR lease_expires_at <= $4)
         RETURNING *`,
        [cursorId, leaseToken, leaseExpiresAt, now],
      );
      return result.rows[0] ? { cursor: cursorFromRow(result.rows[0]), leaseToken } : undefined;
    });
  }

  async createRun(subject: SyncSubject, kind: SyncKind, cursorStart: number, at: string, trigger: 'manual' | 'scheduled' = 'manual'): Promise<SyncRunRecord> {
    const id = randomUUID();
    const publicId = randomUUID();
    await this.database.query(
      `INSERT INTO sync_runs (
         id, public_id, squad_id, player_id, provider, trigger_kind, sync_kind, status, started_at, cursor_start
       ) VALUES ($1,$2,$3,$4,'HenrikDev',$8,$5,'running',$6,$7)`,
      [id, publicId, subject.squadId, subject.playerId, kind, at, cursorStart, trigger],
    );
    return { id, publicId, subject, kind, status: 'running', cursorStart };
  }

  async findRun(publicRunId: string): Promise<SyncRunRecord | undefined> {
    const result = await this.database.query<RunRow>(
      `SELECT sr.id, sr.public_id, sr.sync_kind, sr.status, sr.cursor_start,
              sc.next_attempt_at, p.id AS player_id, p.public_id AS public_player_id,
              sr.squad_id, p.display_name, p.display_tag, pi.affinity
       FROM sync_runs sr
       JOIN players p ON p.id=sr.player_id
       JOIN provider_identities pi ON pi.player_id=p.id AND pi.provider=sr.provider
       LEFT JOIN sync_cursors sc ON sc.player_id=sr.player_id AND sc.provider=sr.provider
         AND sc.affinity=pi.affinity AND sc.queue_scope='*' AND sc.sync_kind=sr.sync_kind
       WHERE sr.public_id=$1
       ORDER BY pi.created_at ASC LIMIT 1`,
      [publicRunId],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      publicId: row.public_id,
      subject: subjectFromRow(row),
      kind: row.sync_kind,
      status: row.status,
      cursorStart: Number(row.cursor_start ?? 0),
      nextAttemptAt: iso(row.next_attempt_at),
    } : undefined;
  }

  async findLatestRun(subject: SyncSubject, kind: SyncKind): Promise<SyncRunRecord | undefined> {
    const result = await this.database.query<{ public_id: string }>(
      `SELECT public_id FROM sync_runs
       WHERE player_id=$1 AND provider='HenrikDev' AND sync_kind=$2 AND public_id IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`,
      [subject.playerId, kind],
    );
    return result.rows[0]?.public_id ? this.findRun(result.rows[0].public_id) : undefined;
  }

  async markRunRunning(runId: string): Promise<void> {
    await this.database.query(
      `UPDATE sync_runs SET status='running', completed_at=NULL WHERE id=$1 AND status IN ('pending','paused','failed','running')`,
      [runId],
    );
  }

  async cancelRunForConsent(runId: string, playerId: string, kind: SyncKind, at: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE sync_runs SET status='cancelled', completed_at=$2, error_category='CONSENT_REVOKED',
           last_error_at=$2, retry_count=retry_count+1 WHERE id=$1`,
        [runId, at],
      );
      await transaction.query(
        `UPDATE sync_cursors SET last_error_category='CONSENT_REVOKED', last_error_at=$3,
           next_attempt_at=NULL, lease_token=NULL, lease_expires_at=NULL, updated_at=$3
         WHERE player_id=$1 AND provider='HenrikDev' AND sync_kind=$2`,
        [playerId, kind, at],
      );
    });
  }

  async existingMatchHmacs(hmacs: string[]): Promise<Set<string>> {
    if (hmacs.length === 0) return new Set();
    const result = await this.database.query<{ provider_match_lookup_hmac: string }>(
      `SELECT provider_match_lookup_hmac FROM source_matches
       WHERE provider='HenrikDev' AND provider_match_lookup_hmac = ANY($1::text[])`,
      [hmacs],
    );
    return new Set(result.rows.map((row) => row.provider_match_lookup_hmac));
  }

  /**
   * TASK-DATA-SEASON-01: fill season metadata for ALREADY DURABLE matches seen in a Stored Matches
   * index page, keyed only by the existing HMAC. Never creates a source match or any evidence row,
   * only touches matches this player participated in, requires active consent in the same statement,
   * and keeps the upsert semantics: a valid value corrects, a missing value never erases.
   */
  async fillKnownMatchSeasons(playerId: string, rows: { hmac: string; seasonId?: string; seasonShort?: string }[]): Promise<number> {
    const usable = rows.filter((row) => row.seasonId !== undefined || row.seasonShort !== undefined);
    if (usable.length === 0) return 0;
    const result = await this.database.query(
      `UPDATE source_matches sm SET
         season_id=COALESCE(v.season_id, sm.season_id),
         season_short=COALESCE(v.season_short, sm.season_short)
       FROM unnest($2::text[], $3::text[], $4::text[]) AS v(hmac, season_id, season_short)
       WHERE sm.provider='HenrikDev' AND sm.provider_match_lookup_hmac=v.hmac
         AND (sm.season_id IS DISTINCT FROM COALESCE(v.season_id, sm.season_id)
           OR sm.season_short IS DISTINCT FROM COALESCE(v.season_short, sm.season_short))
         AND EXISTS (SELECT 1 FROM match_participants mp WHERE mp.source_match_id=sm.id AND mp.player_id=$1)
         AND EXISTS (SELECT 1 FROM consents c WHERE c.player_id=$1 AND c.status='active')`,
      [playerId, usable.map((row) => row.hmac), usable.map((row) => row.seasonId ?? null), usable.map((row) => row.seasonShort ?? null)],
    );
    return result.rowCount;
  }

  async recordSuccess(input: {
    cursorId: string;
    leaseToken: string;
    runId: string;
    nextStart: number;
    pageNumber: number;
    boundaryHmac?: string;
    fingerprintHmac?: string;
    coverageFrom?: string;
    coverageTo?: string;
    at: string;
    terminationReason?: SyncTerminationReason;
    completeForProviderWindow: boolean;
    incompleteReason?: string;
    metrics: SyncChunkMetrics;
    deep?: DeepCursorState;
    runStatus?: SyncStatus;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const consent = await transaction.query<{ id: string }>(
        `SELECT id FROM consents WHERE player_id=(SELECT player_id FROM sync_runs WHERE id=$1)
         AND status='active' AND consent_method=$2 AND privacy_version=$3 FOR SHARE`,
        [input.runId, PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION],
      );
      if (!consent.rows[0]) {
        throw new PublicApiError(409, 'CONSENT_REVOKED', '玩家已撤回同意，同步游標未前進。');
      }
      const cursor = await transaction.query(
        `UPDATE sync_cursors SET next_start=$3, coverage_from=CASE
             WHEN $4::timestamptz IS NULL THEN coverage_from
             WHEN coverage_from IS NULL THEN $4::timestamptz
             ELSE LEAST(coverage_from,$4::timestamptz) END,
           coverage_to=CASE
             WHEN $5::timestamptz IS NULL THEN coverage_to
             WHEN coverage_to IS NULL THEN $5::timestamptz
             ELSE GREATEST(coverage_to,$5::timestamptz) END,
           last_provider_match_boundary_hmac=COALESCE($6,last_provider_match_boundary_hmac),
           last_page_fingerprint_hmac=COALESCE($7,last_page_fingerprint_hmac),
           last_successful_page=$8, last_success_at=$9, retry_count=0,
           last_error_category=NULL, last_error_at=NULL, next_attempt_at=NULL,
           coverage_complete_for_provider_window=$10, coverage_incomplete_reason=$11,
           history_phase=COALESCE($12::jsonb->>'historyPhase',history_phase),
           stored_page=COALESCE(($12::jsonb->>'storedPage')::integer,stored_page),
           stored_item_index=COALESCE(($12::jsonb->>'storedItemIndex')::integer,stored_item_index),
           stored_total=COALESCE(($12::jsonb->>'storedTotal')::integer,stored_total),
           discovery_page=COALESCE(($12::jsonb->>'discoveryPage')::integer,discovery_page),
           live_history_exhausted=COALESCE(($12::jsonb->>'liveHistoryExhausted')::boolean,live_history_exhausted),
           stored_history_exhausted=COALESCE(($12::jsonb->>'storedHistoryExhausted')::boolean,stored_history_exhausted),
           history_rule_version=CASE WHEN $12::jsonb IS NULL THEN history_rule_version ELSE 'deep-history-v1' END,
           lease_token=NULL, lease_expires_at=NULL, updated_at=$9
         WHERE id=$1 AND lease_token=$2`,
        [input.cursorId, input.leaseToken, input.nextStart, input.coverageFrom ?? null, input.coverageTo ?? null,
          input.boundaryHmac ?? null, input.fingerprintHmac ?? null, input.pageNumber, input.at,
          input.completeForProviderWindow, input.incompleteReason ?? null, input.deep ? JSON.stringify(input.deep) : null],
      );
      if (cursor.rowCount !== 1) throw new Error('Sync lease was lost before cursor commit.');
      const terminal = input.terminationReason !== undefined;
      const run = await transaction.query(
        `UPDATE sync_runs SET status=$2, completed_at=CASE WHEN $2='complete' THEN $3::timestamptz ELSE NULL END,
           coverage_from=CASE
             WHEN $4::timestamptz IS NULL THEN coverage_from
             WHEN coverage_from IS NULL THEN $4::timestamptz
             ELSE LEAST(coverage_from,$4::timestamptz) END,
           coverage_to=CASE
             WHEN $5::timestamptz IS NULL THEN coverage_to
             WHEN coverage_to IS NULL THEN $5::timestamptz
             ELSE GREATEST(coverage_to,$5::timestamptz) END,
           last_provider_match_boundary_hmac=COALESCE($6,last_provider_match_boundary_hmac),
           page_count=page_count+1, matches_seen=matches_seen+$7,
           matches_persisted=matches_persisted+$8, overlap_count=overlap_count+$9,
           provider_request_count=provider_request_count+$17, provider_fetch_ms=provider_fetch_ms+$10,
           normalization_ms=normalization_ms+$11, database_ms=database_ms+$12,
           total_ms=total_ms+$13, sql_query_count=sql_query_count+$14,
           termination_reason=$15, error_category=NULL, last_error_at=NULL, cursor_start=$16,
           stored_matches_seen=stored_matches_seen+$18, detail_requests=detail_requests+$19,
           detail_unavailable_count=detail_unavailable_count+$20
         WHERE id=$1 AND status <> 'cancelled'`,
        [input.runId, input.runStatus ?? (terminal ? 'complete' : 'paused'), input.at, input.coverageFrom ?? null, input.coverageTo ?? null,
          input.boundaryHmac ?? null, input.metrics.returnedMatches, input.metrics.persistedMatches,
          input.metrics.overlapMatches, input.metrics.providerFetchMs, input.metrics.normalizationMs,
          input.metrics.databaseMs, input.metrics.totalMs, input.metrics.sqlQueryCount,
          input.terminationReason ?? null, input.nextStart, input.metrics.providerRequests ?? 1,
          input.metrics.storedMatchesSeen ?? 0, input.metrics.detailRequests ?? 0, input.metrics.detailUnavailableCount ?? 0],
      );
      if (run.rowCount !== 1) throw new PublicApiError(409, 'CONSENT_REVOKED', '同步工作已被撤回程序取消。');
    });
  }

  async recordFailure(input: {
    cursorId: string;
    leaseToken: string;
    runId: string;
    category: SyncErrorCategory;
    status: SyncStatus;
    at: string;
    nextAttemptAt?: string;
    metrics?: SyncChunkMetrics;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const cursor = await transaction.query(
        `UPDATE sync_cursors SET retry_count=CASE WHEN $3='PROVIDER_PAGINATION_UNSTABLE'
             AND coverage_incomplete_reason IS DISTINCT FROM 'pagination_repeat' THEN 1 ELSE retry_count+1 END,
           coverage_incomplete_reason=CASE WHEN $3='PROVIDER_PAGINATION_UNSTABLE'
             THEN 'pagination_repeat' ELSE coverage_incomplete_reason END, last_error_category=$3,
           last_error_at=$4, next_attempt_at=$5, lease_token=NULL, lease_expires_at=NULL, updated_at=$4
         WHERE id=$1 AND lease_token=$2`,
        [input.cursorId, input.leaseToken, input.category, input.at, input.nextAttemptAt ?? null],
      );
      if (cursor.rowCount !== 1) throw new Error('Sync lease was lost before failure commit.');
      await transaction.query(
        `UPDATE sync_runs SET status=$2, error_category=$3, last_error_at=$4,
           retry_count=retry_count+1, completed_at=CASE WHEN $2 IN ('failed','cancelled') THEN $4::timestamptz ELSE NULL END,
           provider_request_count=provider_request_count+$5,
           detail_requests=detail_requests+$6,
           provider_fetch_ms=provider_fetch_ms+$7
         WHERE id=$1 AND status <> 'cancelled'`,
        [input.runId, input.status, input.category, input.at, input.metrics?.providerRequests ?? 0,
          input.metrics?.detailRequests ?? 0, input.metrics?.providerFetchMs ?? 0],
      );
    });
  }

  async releaseLease(cursorId: string, leaseToken: string, at: string): Promise<void> {
    await this.database.query(
      `UPDATE sync_cursors SET lease_token=NULL, lease_expires_at=NULL, updated_at=$3
       WHERE id=$1 AND lease_token=$2`,
      [cursorId, leaseToken, at],
    );
  }

  async status(publicRunId: string): Promise<PublicSyncStatus | undefined> {
    const result = await this.database.query<StatusRow>(
      `SELECT sr.public_id, sr.sync_kind, sr.status, sr.page_count, sr.matches_seen,
              sc.history_phase,sc.stored_page,sc.stored_item_index,sc.stored_total,sc.discovery_page,
              sc.live_history_exhausted,sc.stored_history_exhausted,
              sr.stored_matches_seen,sr.detail_requests,sr.detail_unavailable_count,
              sr.matches_persisted, sr.overlap_count, sr.retry_count,
              COALESCE(sc.coverage_from,sr.coverage_from) AS coverage_from,
              COALESCE(sc.coverage_to,sr.coverage_to) AS coverage_to,
              sc.last_success_at, sc.coverage_complete_for_provider_window,
              sc.coverage_incomplete_reason, sr.termination_reason,
              sc.last_error_category, sc.next_attempt_at,
              sr.provider_fetch_ms, sr.normalization_ms, sr.database_ms, sr.total_ms,
              sr.sql_query_count, sr.provider_request_count
       FROM sync_runs sr
       JOIN provider_identities pi ON pi.player_id=sr.player_id AND pi.provider=sr.provider
       JOIN sync_cursors sc ON sc.player_id=sr.player_id AND sc.provider=sr.provider
         AND sc.affinity=pi.affinity AND sc.queue_scope='*' AND sc.sync_kind=sr.sync_kind
       WHERE sr.public_id=$1
       ORDER BY pi.created_at ASC LIMIT 1`,
      [publicRunId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      runId: row.public_id,
      kind: row.sync_kind,
      status: row.status,
      ...(row.sync_kind === 'deep_backfill' ? { history: {
        ...deepFromRow(row), ruleVersion: 'deep-history-v1' as const,
        sourceExhausted: row.history_phase === 'complete' && row.live_history_exhausted && row.stored_history_exhausted,
        lifetimeComplete: false as const,
      } } : {}),
      progress: {
        pages: Number(row.page_count),
        matchesSeen: Number(row.matches_seen),
        matchesPersisted: Number(row.matches_persisted),
        overlapsUpdated: Number(row.overlap_count),
        retries: Number(row.retry_count),
        ...(row.sync_kind === 'deep_backfill' ? {
          storedMatchesSeen: Number(row.stored_matches_seen), detailRequests: Number(row.detail_requests),
          detailUnavailableCount: Number(row.detail_unavailable_count),
        } : {}),
      },
      coverage: {
        from: iso(row.coverage_from),
        to: iso(row.coverage_to),
        lastSyncedAt: iso(row.last_success_at),
        completeForProviderWindow: row.coverage_complete_for_provider_window,
        incompleteReason: row.coverage_incomplete_reason ?? undefined,
      },
      terminationReason: row.termination_reason ?? undefined,
      lastErrorCategory: row.last_error_category ?? undefined,
      nextAttemptAt: iso(row.next_attempt_at),
      performance: {
        providerFetchMs: Number(row.provider_fetch_ms),
        normalizationMs: Number(row.normalization_ms),
        databaseMs: Number(row.database_ms),
        totalMs: Number(row.total_ms),
        sqlQueryCount: Number(row.sql_query_count),
        providerRequests: Number(row.provider_request_count),
      },
    };
  }
}
