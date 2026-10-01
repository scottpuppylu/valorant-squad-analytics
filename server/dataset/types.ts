import type { NormalizedAnalyticsDataset } from '../../src/dataSources/types.js';
import type { SqlExecutor } from '../db/types.js';

export const datasetSchemaVersion = 1 as const;
export const datasetProjectionVersion = 'legacy-browser-projection-v1' as const;
export const datasetWindowSize = 300;

export interface DatasetPlayerRow extends Record<string, unknown> {
  internal_player_id: string;
  public_id: string;
  display_name: string;
  display_tag: string;
  default_emoji: string;
}

export interface DatasetPerformanceRow extends Record<string, unknown> {
  internal_match_id: string;
  public_match_id: string;
  started_at: string | Date | null;
  map_name: string | null;
  queue_id: string | null;
  queue_name: string | null;
  game_length_ms: number | null;
  internal_participant_id: string;
  internal_player_id: string;
  team_key: string;
  agent_name: string | null;
  stats_evidence_status: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
  damage_dealt: number | null;
  headshots: number | null;
  bodyshots: number | null;
  legshots: number | null;
  team_won: boolean | null;
  rounds_won: number | null;
  rounds_lost: number | null;
}

export interface DatasetRoundRow extends Record<string, unknown> {
  internal_match_id: string;
  internal_round_id: string;
  round_number: number;
}

export interface DatasetRoundParticipantRow extends Record<string, unknown> {
  internal_round_id: string;
  internal_participant_id: string;
}

export interface DatasetEventRow extends Record<string, unknown> {
  internal_match_id: string;
  internal_round_id: string;
  event_sequence: number;
  time_in_round_ms: number;
  killer_participant_id: string;
  victim_participant_id: string;
  killer_team_key: string;
  assistant_participant_id: string | null;
}

export interface DatasetCoverageRow extends Record<string, unknown> {
  coverage_from: string | Date | null;
  coverage_to: string | Date | null;
  last_synced_at: string | Date | null;
  complete_for_provider_window: boolean | null;
}

export interface DatasetProjectionRows {
  players: DatasetPlayerRow[];
  performances: DatasetPerformanceRow[];
  rounds: DatasetRoundRow[];
  roundParticipants: DatasetRoundParticipantRow[];
  events: DatasetEventRow[];
  coverage: DatasetCoverageRow | null;
  sqlQueryCount: number;
  databaseMs: number;
}

export interface DatasetReadRepository {
  readProjectionRows(windowSize: number): Promise<DatasetProjectionRows>;
}

export interface DatasetCoverage {
  from?: string;
  to?: string;
  lastSyncedAt?: string;
  completeForProviderWindow: boolean;
  boundedMatchLimit: number;
  lifetimeComplete: false;
}

export interface DatasetEvidenceAvailability {
  acs: 'derived';
  adr: 'derived';
  headshotPercentage: 'derived';
  kast: 'reconstructed' | 'partial';
  firstKills: 'reconstructed' | 'partial';
  firstDeaths: 'reconstructed' | 'partial';
}

export interface DatasetSnapshot {
  version: string;
  generation: 'dataset-read-v1';
  source: 'durable-neon';
  projectionVersion: typeof datasetProjectionVersion;
}

export interface DatasetReadPayload {
  ok: true;
  schemaVersion: typeof datasetSchemaVersion;
  state: 'ready' | 'empty';
  snapshot: DatasetSnapshot;
  coverage: DatasetCoverage;
  evidence: DatasetEvidenceAvailability;
  dataset: NormalizedAnalyticsDataset;
}

export interface DatasetReadDisabledPayload {
  ok: true;
  schemaVersion: typeof datasetSchemaVersion;
  state: 'disabled';
  source: 'REAL_SERVER';
}

export type DatasetApiPayload = DatasetReadPayload | DatasetReadDisabledPayload;

export interface DatasetProjectionMetrics {
  sqlQueryCount: number;
  databaseMs: number;
  projectionMs: number;
  serializedBytes: number;
}

export interface DatasetProjectionResult {
  payload: DatasetReadPayload;
  metrics: DatasetProjectionMetrics;
}

export type DatasetSqlExecutor = Pick<SqlExecutor, 'query'>;
