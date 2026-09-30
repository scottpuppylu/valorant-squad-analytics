import type { SqlDatabase } from '../db/types.js';

export interface RetentionCleanupResult {
  jobsRemoved: number;
  playerTombstonesRemoved: number;
}

export class DeletionRetentionService {
  constructor(private readonly database: SqlDatabase) {}

  async purgeExpired(at = new Date().toISOString(), batchSize = 100): Promise<RetentionCleanupResult> {
    return this.database.transaction(async (transaction) => {
      const expired = await transaction.query<{ id: string; player_id: string | null }>(
        `SELECT id,player_id FROM deletion_jobs
         WHERE status='complete' AND retention_until IS NOT NULL AND retention_until <= $1
         ORDER BY retention_until,id LIMIT $2 FOR UPDATE`,
        [at, batchSize],
      );
      let playerTombstonesRemoved = 0;
      for (const row of expired.rows) {
        if (row.player_id) {
          playerTombstonesRemoved += (await transaction.query(
            `DELETE FROM players WHERE id=$1 AND anonymized_at IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM provider_identities WHERE player_id=$1)
             AND NOT EXISTS (SELECT 1 FROM consents WHERE player_id=$1)
             AND NOT EXISTS (SELECT 1 FROM squad_memberships WHERE player_id=$1)
             AND NOT EXISTS (SELECT 1 FROM match_participants WHERE player_id=$1)
             AND NOT EXISTS (SELECT 1 FROM sync_cursors WHERE player_id=$1)
             AND NOT EXISTS (SELECT 1 FROM sync_runs WHERE player_id=$1)`,
            [row.player_id],
          )).rowCount;
        }
      }
      if (expired.rows.length > 0) {
        await transaction.query('DELETE FROM deletion_jobs WHERE id = ANY($1::uuid[])', [expired.rows.map((row) => row.id)]);
      }
      return { jobsRemoved: expired.rows.length, playerTombstonesRemoved };
    });
  }
}
