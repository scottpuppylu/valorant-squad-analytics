import { randomBytes, randomUUID } from 'node:crypto';
import { verifyConsentManagementCredential } from '../consentManagementCredential.js';
import type { SqlDatabase, SqlExecutor } from '../db/types.js';
import { PublicApiError } from '../errors.js';
import type { DeletionStage, PublicDeletionProgress } from './types.js';

const leaseMs = 45_000;
const defaultWorkBudgetMs = 22_000;
const matchBatchSize = 10;

type JobRow = {
  id: string; public_id: string; player_id: string | null; consent_id: string | null;
  management_credential_hmac: string | null;
  status: 'pending' | 'running' | 'paused' | 'complete' | 'failed';
  stage: DeletionStage; requested_at: string | Date; completed_at: string | Date | null;
  attempt_count: number; rank_rows_removed: number; exclusive_matches_removed: number;
  shared_matches_anonymized: number; participants_anonymized: number;
  provider_identities_removed: number; memberships_removed: number;
  sync_cursors_removed: number; sync_runs_anonymized: number;
};

type RevocationSubject = { player_id: string; consent_id: string; management_credential_hmac: string | null };

function iso(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicProgress(row: JobRow): PublicDeletionProgress {
  return {
    jobId: row.public_id, status: row.status, stage: row.stage, requestedAt: iso(row.requested_at)!,
    completedAt: iso(row.completed_at),
    progress: {
      rankRowsRemoved: Number(row.rank_rows_removed),
      exclusiveMatchesRemoved: Number(row.exclusive_matches_removed),
      sharedMatchesAnonymized: Number(row.shared_matches_anonymized),
      participantsAnonymized: Number(row.participants_anonymized),
      providerIdentitiesRemoved: Number(row.provider_identities_removed),
      membershipsRemoved: Number(row.memberships_removed),
      syncCursorsRemoved: Number(row.sync_cursors_removed),
      syncRunsAnonymized: Number(row.sync_runs_anonymized),
      attempts: Number(row.attempt_count),
    },
  };
}

export class RevocationDeletionService {
  constructor(
    private readonly database: SqlDatabase,
    private readonly hmacKey: string,
    private readonly now: () => Date = () => new Date(),
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {}

  async revoke(publicPlayerId: string, credential: string): Promise<PublicDeletionProgress> {
    const at = this.now().toISOString();
    const row = await this.database.transaction(async (transaction) => {
      const subject = await transaction.query<RevocationSubject>(
        `SELECT p.id AS player_id, c.id AS consent_id, c.management_credential_hmac
         FROM players p JOIN consents c ON c.player_id=p.id AND c.status='active'
         WHERE p.public_id=$1 AND p.anonymized_at IS NULL
         ORDER BY c.consented_at DESC LIMIT 1 FOR UPDATE OF p,c`, [publicPlayerId],
      );
      if (!subject.rows[0]) {
        const existing = await transaction.query<JobRow>(
          `SELECT dj.* FROM deletion_jobs dj JOIN players p ON p.id=dj.player_id
           WHERE p.public_id=$1 ORDER BY dj.requested_at DESC LIMIT 1 FOR UPDATE OF dj`, [publicPlayerId],
        );
        if (!existing.rows[0]) throw new PublicApiError(404, 'DELETION_NOT_FOUND', '找不到可撤回的同意紀錄。');
        this.requireCredential(credential, existing.rows[0].management_credential_hmac);
        return existing.rows[0];
      }
      const active = subject.rows[0];
      this.requireCredential(credential, active.management_credential_hmac);
      await transaction.query(`UPDATE consents SET status='revoked', revoked_at=$2 WHERE id=$1 AND status='active'`, [active.consent_id, at]);
      await transaction.query(`UPDATE squad_memberships SET status='inactive', left_at=$2 WHERE player_id=$1 AND status='active'`, [active.player_id, at]);
      await transaction.query(
        `UPDATE sync_runs SET status='cancelled', completed_at=$2, error_category='CONSENT_REVOKED', last_error_at=$2
         WHERE player_id=$1 AND status IN ('pending','running','paused','failed')`, [active.player_id, at],
      );
      await transaction.query(
        `UPDATE sync_cursors SET lease_token=NULL, lease_expires_at=NULL, next_attempt_at=NULL,
           last_error_category='CONSENT_REVOKED', last_error_at=$2, updated_at=$2 WHERE player_id=$1`, [active.player_id, at],
      );
      const inserted = await transaction.query<JobRow>(
        `INSERT INTO deletion_jobs (
           id, public_id, player_id, consent_id, status, stage, requested_at, stage_started_at,
           management_credential_hmac, credential_version, retention_until
         ) VALUES ($1,$2,$3,$4,'pending','cancel_sync',$5,$5,$6,'consent-management:v1',$5::timestamptz + interval '90 days')
         ON CONFLICT (player_id) WHERE player_id IS NOT NULL AND status <> 'complete'
         DO UPDATE SET updated_at=EXCLUDED.requested_at RETURNING *`,
        [randomUUID(), randomUUID(), active.player_id, active.consent_id, at, active.management_credential_hmac],
      );
      if (!inserted.rows[0]) throw new Error('Deletion job was not created.');
      return inserted.rows[0];
    });
    return publicProgress(row);
  }

  async status(publicJobId: string, credential: string): Promise<PublicDeletionProgress> {
    const row = await this.findJob(publicJobId);
    this.requireCredential(credential, row.management_credential_hmac);
    return publicProgress(row);
  }

  async continue(publicJobId: string, credential: string, usefulWorkBudgetMs = defaultWorkBudgetMs): Promise<PublicDeletionProgress> {
    const existing = await this.findJob(publicJobId);
    this.requireCredential(credential, existing.management_credential_hmac);
    if (existing.status === 'complete') return publicProgress(existing);
    const now = this.now();
    const leaseToken = randomUUID();
    const leased = await this.database.query<JobRow>(
      `UPDATE deletion_jobs SET status='running', lease_token=$2, lease_expires_at=$3,
         attempt_count=attempt_count+1, last_error_safe=NULL, last_error_at=NULL, updated_at=$4
       WHERE public_id=$1 AND status <> 'complete' AND (lease_token IS NULL OR lease_expires_at <= $4) RETURNING *`,
      [publicJobId, leaseToken, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString()],
    );
    if (!leased.rows[0]) throw new PublicApiError(409, 'LOCK_BUSY', '刪除工作正在另一個安全區塊中執行。');
    const started = this.monotonicNow();
    try {
      let job = leased.rows[0];
      while (job.status !== 'complete' && this.monotonicNow() - started < usefulWorkBudgetMs) job = await this.runStage(job, leaseToken);
      if (job.status !== 'complete') {
        await this.database.query(
          `UPDATE deletion_jobs SET status='paused', lease_token=NULL, lease_expires_at=NULL, updated_at=$3
           WHERE id=$1 AND lease_token=$2`, [job.id, leaseToken, this.now().toISOString()],
        );
      }
      return publicProgress(await this.findJob(publicJobId));
    } catch (error) {
      await this.database.query(
        `UPDATE deletion_jobs SET status='paused', lease_token=NULL, lease_expires_at=NULL,
           last_error_safe='DELETION_STAGE_FAILED', last_error_at=$3, updated_at=$3
         WHERE public_id=$1 AND lease_token=$2`, [publicJobId, leaseToken, this.now().toISOString()],
      ).catch(() => undefined);
      throw error;
    }
  }

  private requireCredential(credential: string, storedHmac: string | null): void {
    if (!storedHmac) throw new PublicApiError(409, 'MANAGEMENT_CREDENTIAL_REQUIRED', '這筆舊版同意尚未配置管理憑證，請由管理員協助處理。');
    if (!verifyConsentManagementCredential(credential, storedHmac, this.hmacKey)) {
      throw new PublicApiError(403, 'REVOCATION_FORBIDDEN', '無法驗證這個瀏覽器的同意管理權限。');
    }
  }

  private async findJob(publicJobId: string): Promise<JobRow> {
    const result = await this.database.query<JobRow>('SELECT * FROM deletion_jobs WHERE public_id=$1', [publicJobId]);
    if (!result.rows[0]) throw new PublicApiError(404, 'DELETION_NOT_FOUND', '找不到這次刪除工作。');
    return result.rows[0];
  }

  private async runStage(job: JobRow, leaseToken: string): Promise<JobRow> {
    switch (job.stage) {
      case 'cancel_sync': return this.advance(job, leaseToken, 'remove_rank_observations');
      case 'remove_rank_observations': return this.removeRank(job, leaseToken);
      case 'process_matches': return this.processMatches(job, leaseToken);
      case 'remove_provider_identity': return this.removeProviderIdentity(job, leaseToken);
      case 'remove_membership': return this.removeMembership(job, leaseToken);
      case 'clear_sync_metadata': return this.clearSyncMetadata(job, leaseToken);
      case 'purge_player_profile_identity': return this.purgePlayerIdentity(job, leaseToken);
      case 'finalize_job': return this.finalize(job, leaseToken);
    }
  }

  private advance(job: JobRow, leaseToken: string, stage: DeletionStage): Promise<JobRow> {
    return this.updateJob(job.id, leaseToken, `stage=$3, stage_started_at=$4, updated_at=$4`, [stage, this.now().toISOString()]);
  }

  private async removeRank(job: JobRow, leaseToken: string): Promise<JobRow> {
    return this.database.transaction(async (transaction) => {
      const removed = await transaction.query('DELETE FROM rank_observations WHERE player_id=$1', [job.player_id]);
      return this.updateJobIn(transaction, job.id, leaseToken,
        `rank_rows_removed=rank_rows_removed+$3, stage='process_matches', stage_started_at=$4, updated_at=$4`,
        [removed.rowCount, this.now().toISOString()]);
    });
  }

  private async processMatches(job: JobRow, leaseToken: string): Promise<JobRow> {
    if (!job.player_id) return this.advance(job, leaseToken, 'remove_provider_identity');
    return this.database.transaction(async (transaction) => {
      const matches = await transaction.query<{ id: string; shared: boolean }>(
        `SELECT DISTINCT sm.id, EXISTS(
           SELECT 1 FROM match_participants other
           JOIN consents oc ON oc.player_id=other.player_id AND oc.status='active'
           JOIN squad_memberships osm ON osm.player_id=other.player_id AND osm.status='active'
           WHERE other.source_match_id=sm.id AND other.player_id IS NOT NULL AND other.player_id <> $1
         ) AS shared
         FROM source_matches sm JOIN match_participants target ON target.source_match_id=sm.id
         WHERE target.player_id=$1 ORDER BY sm.id LIMIT $2`, [job.player_id, matchBatchSize],
      );
      if (matches.rows.length === 0) {
        return this.updateJobIn(transaction, job.id, leaseToken,
          `stage='remove_provider_identity', stage_started_at=$3, updated_at=$3`, [this.now().toISOString()]);
      }
      let exclusive = 0; let shared = 0; let participants = 0;
      for (const match of matches.rows) {
        if (!match.shared) {
          exclusive += (await transaction.query('DELETE FROM source_matches WHERE id=$1', [match.id])).rowCount;
          continue;
        }
        const targets = await transaction.query<{ id: string }>(
          'SELECT id FROM match_participants WHERE source_match_id=$1 AND player_id=$2', [match.id, job.player_id],
        );
        for (const participant of targets.rows) {
          const identityDerivedEvents = await transaction.query<{ id: string }>(
            `SELECT id FROM kill_events
             WHERE source_match_id=$1 AND (killer_participant_id=$2 OR victim_participant_id=$2)
             ORDER BY id`, [match.id, participant.id],
          );
          for (const event of identityDerivedEvents.rows) {
            await transaction.query(
              `UPDATE kill_events SET event_lookup_hmac=$2, weapon_id=NULL, weapon_name=NULL,
                 location_x=NULL, location_y=NULL WHERE id=$1`,
              [event.id, randomBytes(32).toString('hex')],
            );
          }
          await transaction.query(
            `UPDATE match_participants SET player_id=NULL, participant_lookup_hmac=$2,
               agent_id=NULL, agent_name=NULL, stats_evidence_status='unavailable', kills=NULL, deaths=NULL,
               assists=NULL, score=NULL, damage_dealt=NULL, damage_received=NULL, headshots=NULL,
               bodyshots=NULL, legshots=NULL, ability_1_casts=NULL, ability_2_casts=NULL,
               grenade_casts=NULL, ultimate_casts=NULL, loadout_value_total=NULL,
               loadout_value_average=NULL, spent_total=NULL, spent_average=NULL WHERE id=$1`,
            [participant.id, randomBytes(32).toString('hex')],
          );
          await transaction.query(
            `UPDATE round_participants SET stats_evidence_status='unavailable', kills=NULL, score=NULL,
               loadout_evidence_status='unavailable', loadout_value=NULL, remaining_credits=NULL,
               weapon_evidence_status='unavailable', weapon_id=NULL, weapon_name=NULL,
               armor_evidence_status='unavailable', armor_id=NULL, armor_name=NULL WHERE match_participant_id=$1`,
            [participant.id],
          );
          await transaction.query('DELETE FROM event_player_locations WHERE match_participant_id=$1', [participant.id]);
          // TASK-DATA-03B.2D: derived analysis facts of the anonymized participant go with its evidence.
          await transaction.query('DELETE FROM analysis_participant_facts WHERE match_participant_id=$1', [participant.id]);
          participants += 1;
        }
        shared += 1;
      }
      return this.updateJobIn(transaction, job.id, leaseToken,
        `exclusive_matches_removed=exclusive_matches_removed+$3,
         shared_matches_anonymized=shared_matches_anonymized+$4,
         participants_anonymized=participants_anonymized+$5, updated_at=$6`,
        [exclusive, shared, participants, this.now().toISOString()]);
    });
  }

  private async removeProviderIdentity(job: JobRow, leaseToken: string): Promise<JobRow> {
    return this.database.transaction(async (transaction) => {
      const removed = await transaction.query('DELETE FROM provider_identities WHERE player_id=$1', [job.player_id]);
      return this.updateJobIn(transaction, job.id, leaseToken,
        `provider_identities_removed=provider_identities_removed+$3, stage='remove_membership', stage_started_at=$4, updated_at=$4`,
        [removed.rowCount, this.now().toISOString()]);
    });
  }

  private async removeMembership(job: JobRow, leaseToken: string): Promise<JobRow> {
    return this.database.transaction(async (transaction) => {
      const removed = await transaction.query('DELETE FROM squad_memberships WHERE player_id=$1', [job.player_id]);
      return this.updateJobIn(transaction, job.id, leaseToken,
        `memberships_removed=memberships_removed+$3, stage='clear_sync_metadata', stage_started_at=$4, updated_at=$4`,
        [removed.rowCount, this.now().toISOString()]);
    });
  }

  private async clearSyncMetadata(job: JobRow, leaseToken: string): Promise<JobRow> {
    return this.database.transaction(async (transaction) => {
      const cursors = await transaction.query('DELETE FROM sync_cursors WHERE player_id=$1', [job.player_id]);
      const runs = await transaction.query(
        `UPDATE sync_runs SET player_id=NULL, coverage_from=NULL, coverage_to=NULL, cursor_start=NULL,
           last_provider_match_boundary_hmac=NULL WHERE player_id=$1`, [job.player_id],
      );
      return this.updateJobIn(transaction, job.id, leaseToken,
        `sync_cursors_removed=sync_cursors_removed+$3, sync_runs_anonymized=sync_runs_anonymized+$4,
         stage='purge_player_profile_identity', stage_started_at=$5, updated_at=$5`,
        [cursors.rowCount, runs.rowCount, this.now().toISOString()]);
    });
  }

  private async purgePlayerIdentity(job: JobRow, leaseToken: string): Promise<JobRow> {
    return this.database.transaction(async (transaction) => {
      await transaction.query('DELETE FROM consents WHERE player_id=$1', [job.player_id]);
      await transaction.query(
        `UPDATE players SET display_name='已刪除玩家', display_tag='deleted', default_emoji='👤',
           anonymized_at=$2, updated_at=$2 WHERE id=$1`, [job.player_id, this.now().toISOString()],
      );
      // TASK-IDENTITY-01 (account-scoped deletion): a legacy member name derived from THIS account is
      // personal data and is scrubbed; a member left with no live account is archived, never deleted.
      // Other linked accounts, their consent, sync and matches are untouched.
      await transaction.query(
        `UPDATE members SET display_name='已刪除成員', default_emoji='👤', updated_at=$2
         WHERE id=$1 AND display_name_source='legacy_account'`, [job.player_id, this.now().toISOString()],
      );
      await transaction.query(
        `UPDATE members m SET archived_at=$2, updated_at=$2
         WHERE m.id=(SELECT member_id FROM players WHERE id=$1) AND m.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM players p WHERE p.member_id=m.id AND p.anonymized_at IS NULL)`,
        [job.player_id, this.now().toISOString()],
      );
      return this.updateJobIn(transaction, job.id, leaseToken,
        `consent_id=NULL, stage='finalize_job', stage_started_at=$3, updated_at=$3`, [this.now().toISOString()]);
    });
  }

  private finalize(job: JobRow, leaseToken: string): Promise<JobRow> {
    const at = this.now().toISOString();
    return this.updateJob(job.id, leaseToken,
      `status='complete', completed_at=$3, lease_token=NULL, lease_expires_at=NULL, updated_at=$3`, [at]);
  }

  private updateJob(id: string, leaseToken: string, assignments: string, values: unknown[]): Promise<JobRow> {
    return this.updateJobIn(this.database, id, leaseToken, assignments, values);
  }

  private async updateJobIn(executor: SqlExecutor, id: string, leaseToken: string, assignments: string, values: unknown[]): Promise<JobRow> {
    const result = await executor.query<JobRow>(
      `UPDATE deletion_jobs SET ${assignments} WHERE id=$1 AND lease_token=$2 RETURNING *`, [id, leaseToken, ...values],
    );
    if (!result.rows[0]) throw new Error('Deletion lease was lost before stage commit.');
    return result.rows[0];
  }
}
