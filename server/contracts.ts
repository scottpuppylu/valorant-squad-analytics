import type { NormalizedAnalyticsDataset } from '../src/dataSources/types.js';

export const supportedAffinities = ['ap', 'eu', 'na', 'kr', 'latam', 'br'] as const;
export type ValorantAffinity = (typeof supportedAffinities)[number];
export type ImportLimit = 3 | 10 | 20 | 30;

export interface ConnectionInput {
  gameName: string;
  tag: string;
  affinity: ValorantAffinity;
  consent: true;
}

export interface MatchImportInput extends ConnectionInput {
  limit: ImportLimit;
}

export interface SanitizedAccount {
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
}

export interface MatchImportResult {
  dataset: NormalizedAnalyticsDataset;
  importedMatches: number;
  importedAt: string;
}

export interface ValorantDataProvider {
  status(): ProviderStatus;
  resolveAccount(input: ConnectionInput): Promise<AccountResolutionResult>;
  importMatches(input: MatchImportInput): Promise<MatchImportResult>;
}

export interface ApiRequest {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}
