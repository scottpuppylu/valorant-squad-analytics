import type { NormalizedAnalyticsDataset } from '../types';

export type ProviderPublicErrorCode =
  | 'BAD_REQUEST'
  | 'CONSENT_REQUIRED'
  | 'METHOD_NOT_ALLOWED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'ACCOUNT_NOT_FOUND'
  | 'NO_MATCHES'
  | 'RATE_LIMITED'
  | 'IMPORT_IN_PROGRESS'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'MALFORMED_PROVIDER_RESPONSE';

export type Affinity = 'ap' | 'eu' | 'na' | 'kr' | 'latam' | 'br';
export type ImportSize = 10 | 20 | 30;

export interface ConnectionRequest {
  gameName: string;
  tag: string;
  affinity: Affinity;
  consent: boolean;
}

export interface PublicAccount {
  gameName: string;
  tag: string;
  affinity: Affinity;
  accountLevel?: number;
}

export interface ProviderStatusResponse {
  ok: true;
  provider: { usable: boolean; mode: 'configured' | 'unconfigured' };
}

export interface AccountResponse {
  ok: true;
  account: PublicAccount;
}

export interface ImportResponse {
  ok: true;
  dataset: NormalizedAnalyticsDataset;
  importedMatches: number;
  importedAt: string;
}

export interface ErrorResponse {
  ok: false;
  error: { code: ProviderPublicErrorCode; message: string };
}
