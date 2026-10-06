import type { ShapeObservation } from './evidence/shapeInspector.js';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types.js';
import type { HenrikCapabilitySummary } from '../src/dataSources/thirdParty/henrikV4.js';
import type { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy.js';

export const supportedAffinities = ['ap', 'eu', 'na', 'kr', 'latam', 'br'] as const;
export type ValorantAffinity = (typeof supportedAffinities)[number];
export type ImportLimit = 1 | 3 | 10 | 20 | 30;

export interface ConnectionInput {
  gameName: string;
  tag: string;
  affinity: ValorantAffinity;
  consent: true;
  privacyVersion: typeof PUBLIC_DATASET_PRIVACY_VERSION;
}

export interface MatchImportInput extends ConnectionInput {
  playerId: string;
  limit: ImportLimit;
}

export interface SanitizedAccount {
  playerId?: string;
  gameName: string;
  tag: string;
  affinity: ValorantAffinity;
  accountLevel?: number;
}

export interface ProviderStatus {
  usable: boolean;
  mode: 'configured' | 'unconfigured';
}

export interface AccountResolutionResult {
  account: SanitizedAccount;
  managementCredential?: string;
}

export interface MatchImportResult {
  dataset: NormalizedAnalyticsDataset;
  importedMatches: number;
  importedAt: string;
}

export interface ProviderAuditEndpoint {
  status: 'observed' | 'not-found' | 'unavailable';
  summary?: HenrikCapabilitySummary;
}

export interface ProviderEvidenceAuditResult {
  schema: { provider: 'HenrikDev'; endpointVersion: 'v4'; openApiVersion: '4.6.0' };
  matchHistory: ProviderAuditEndpoint;
  matchDetail: ProviderAuditEndpoint;
  storedMatches: ProviderAuditEndpoint;
  mmrCurrent: ProviderAuditEndpoint;
  mmrHistory: ProviderAuditEndpoint;
  pagination: {
    v4: { size: 3; starts: [0, 3]; returned: [number, number]; overlapCount: number };
    stored: { size: 3; pages: [1, 2]; returned: [number, number]; overlapCount: number; pageParameterDocumentedInOpenApi: false };
  };
}

/** TASK-DATA-PERFORMANCE-SCORE-01 targeted audit: shape only, at most 2 logical provider requests. */
export interface ProviderPerformanceScoreAudit {
  schema: { provider: 'HenrikDev'; endpointVersion: 'v4'; documentedOpenApiVersion: '4.6.0' };
  inspectorVersion: 'provider-shape-inspector-v1';
  logicalProviderRequests: number;
  matchHistory: { status: 'observed'; candidates: ShapeObservation[]; pathCount: number; truncated: boolean };
  matchDetail: { status: 'observed' | 'not-found' | 'unavailable'; candidates?: ShapeObservation[]; pathCount?: number; truncated?: boolean };
}

export interface ValorantDataProvider {
  status(): ProviderStatus;
  resolveAccount(input: ConnectionInput): Promise<AccountResolutionResult>;
  importMatches(input: MatchImportInput): Promise<MatchImportResult>;
  auditEvidence(input: MatchImportInput): Promise<ProviderEvidenceAuditResult>;
  auditPerformanceScoreShape?(input: MatchImportInput): Promise<ProviderPerformanceScoreAudit>;
}

export interface ApiRequest {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}
