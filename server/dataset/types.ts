import type { NormalizedAnalyticsDataset } from '../../src/dataSources/types.js';
import type { SqlExecutor } from '../db/types.js';

export const datasetSchemaVersion = 6 as const;
/** TASK-IDENTITY-01: public `Player` = MEMBER (person) with 1..N sanitized accounts. */
export const datasetIdentityVersion = 'member-identity-v2' as const;
export const datasetProjectionVersion = 'evidence-decoupled-projection-v1' as const;
export const datasetWindowSize = 300;

/** One public ACCOUNT row with its member (TASK-IDENTITY-01). Internal ids never leave the server. */
export interface DatasetPlayerRow extends Record<string, unknown> {
  internal_player_id: string;
  public_id: string;
  display_name: string;
  display_tag: string;
  default_emoji: string;
  is_primary_account: boolean;
  account_label: string | null;
  internal_member_id: string;
  member_public_id: string;
  member_display_name: string;
  member_name_source: 'legacy_account' | 'community';
  member_default_emoji: string;
  /** TASK-IDENTITY-01B: optional second name of the person (presentation only). */
  member_nickname?: string | null;
}

export interface DatasetPerformanceRow extends Record<string, unknown> {
  internal_match_id: string;
  public_match_id: string;
  started_at: string | Date | null;
  map_name: string | null;
  queue_id: string | null;
  queue_name: string | null;
  game_length_ms: number | null;
  /** Human-readable provider season code; only a normalized public Act key is projected. */
  season_short?: string | null;
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
  normalization_version: string;
  rounds_evidence_status: string;
  kills_evidence_status: string;
  ability_evidence_status: string;
  ability_1_casts: number | null;
  ability_2_casts: number | null;
  grenade_casts: number | null;
  ultimate_casts: number | null;
  economy_evidence_status: string;
  loadout_value_total: number | null;
  loadout_value_average: number | null;
  spent_total: number | null;
  spent_average: number | null;
  team_won: boolean | null;
  rounds_won: number | null;
  rounds_lost: number | null;
}

export interface DatasetRoundRow extends Record<string, unknown> {
  internal_match_id: string;
  internal_round_id: string;
  round_number: number;
  winning_team: string | null;
  participants_evidence_status: string;
  plant_status: string;
  plant_participant_id: string | null;
  defuse_status: string;
  defuse_participant_id: string | null;
}

export interface DatasetRoundParticipantRow extends Record<string, unknown> {
  internal_round_id: string;
  internal_participant_id: string;
  team_key: string;
  present: boolean;
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
  readHistoryPage(request: DatasetHistoryPageRequest): Promise<DatasetHistoryPageRows>;
}

/** TASK-DATA-03B.1: bounded keyset traversal of all eligible durable history. */
export const datasetHistoryVersion = 'dataset-history-v1' as const;
export const datasetHistoryDefaultPageSize = 50;
export const datasetHistoryMaxPageSize = 100;

/** Exact, server-side keyset position. Microseconds keep timestamptz ties exact. */
export interface DatasetHistoryKey {
  startedAtMicros: string;
  publicMatchId: string;
}

export type DatasetHistoryStart =
  | { kind: 'newest' }
  | { kind: 'cursor'; key: DatasetHistoryKey }
  | { kind: 'before'; publicMatchId: string };

export interface DatasetHistoryPageRequest {
  start: DatasetHistoryStart;
  pageSize: number;
}

export interface DatasetHistoryKeyRow extends Record<string, unknown> {
  tracked_match_count: number;
  earliest_started_at: string | Date | null;
  latest_started_at: string | Date | null;
  last_synced_at: string | Date | null;
  bound_count: number;
  bound_started_us: string | null;
  bound_public_id: string | null;
  key_started_us: string | null;
  key_public_id: string | null;
  key_started_at: string | Date | null;
}

export interface DatasetHistoryPageRows {
  /** False only when a `before` anchor is not a currently eligible match. */
  startFound: boolean;
  trackedMatchCount: number;
  earliestStartedAt: string | Date | null;
  latestStartedAt: string | Date | null;
  lastSyncedAt: string | Date | null;
  /** Up to pageSize + 1 keys, newest first; the extra key only signals hasMore. */
  keys: { key: DatasetHistoryKey; startedAt: string | Date }[];
  rows: Omit<DatasetProjectionRows, 'coverage' | 'sqlQueryCount' | 'databaseMs'>;
  sqlQueryCount: number;
  databaseMs: number;
}

export interface DatasetHistoryTracked {
  /** Eligible durable matches currently stored in Neon; never a Riot lifetime total. */
  trackedMatchCount: number;
  earliestTrackedAt?: string;
  latestTrackedAt?: string;
  lastSyncedAt?: string;
  lifetimeComplete: false;
}

export interface DatasetHistoryPage {
  limit: number;
  /** Eligible durable matches this page traversed, including withheld ones. */
  traversedMatchCount: number;
  /** Traversed matches omitted because no visible performance had complete core evidence. */
  withheldMatchCount: number;
  from?: string;
  to?: string;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface DatasetHistoryPayload {
  ok: true;
  schemaVersion: typeof datasetSchemaVersion;
  view: 'history';
  historyVersion: typeof datasetHistoryVersion;
  projectionVersion: typeof datasetProjectionVersion;
  identityVersion: typeof datasetIdentityVersion;
  state: 'ready' | 'empty';
  page: DatasetHistoryPage;
  tracked: DatasetHistoryTracked;
  evidence: DatasetEvidenceAvailability;
  dataset: NormalizedAnalyticsDataset;
}

export interface DatasetHistoryResult {
  payload: DatasetHistoryPayload;
  metrics: DatasetProjectionMetrics;
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
  headshotPercentage: 'derived' | 'partial';
  kast: 'reconstructed' | 'partial';
  firstKills: 'reconstructed' | 'partial';
  firstDeaths: 'reconstructed' | 'partial';
}

export interface DatasetSnapshot {
  version: string;
  generation: 'dataset-read-v4';
  source: 'durable-neon';
  projectionVersion: typeof datasetProjectionVersion;
  identityVersion: typeof datasetIdentityVersion;
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
  metricReconstructionMs: number;
  projectionMs: number;
  serializedBytes: number;
  roundCount: number;
  roundParticipantCount: number;
  eventCount: number;
}

export interface DatasetProjectionResult {
  payload: DatasetReadPayload;
  metrics: DatasetProjectionMetrics;
}

export type DatasetSqlExecutor = Pick<SqlExecutor, 'query'>;
