export type DeletionStatus = 'pending' | 'running' | 'paused' | 'complete' | 'failed';
export type DeletionStage =
  | 'cancel_sync'
  | 'remove_rank_observations'
  | 'process_matches'
  | 'remove_provider_identity'
  | 'remove_membership'
  | 'clear_sync_metadata'
  | 'purge_player_profile_identity'
  | 'finalize_job';

export interface PublicDeletionProgress {
  jobId: string;
  status: DeletionStatus;
  stage: DeletionStage;
  requestedAt: string;
  completedAt?: string;
  progress: {
    rankRowsRemoved: number;
    exclusiveMatchesRemoved: number;
    sharedMatchesAnonymized: number;
    participantsAnonymized: number;
    providerIdentitiesRemoved: number;
    membershipsRemoved: number;
    syncCursorsRemoved: number;
    syncRunsAnonymized: number;
    attempts: number;
  };
}
