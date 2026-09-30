export type PublicErrorCode =
  | 'BAD_REQUEST'
  | 'CONSENT_REQUIRED'
  | 'METHOD_NOT_ALLOWED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'ACCOUNT_NOT_FOUND'
  | 'NO_MATCHES'
  | 'RATE_LIMITED'
  | 'IMPORT_IN_PROGRESS'
  | 'LOCK_BUSY'
  | 'CONSENT_REVOKED'
  | 'MANAGEMENT_CREDENTIAL_REQUIRED'
  | 'REVOCATION_FORBIDDEN'
  | 'DELETION_NOT_FOUND'
  | 'SYNC_NOT_FOUND'
  | 'SYNC_BACKOFF'
  | 'DATABASE_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'MALFORMED_PROVIDER_RESPONSE';

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: PublicErrorCode,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = 'PublicApiError';
  }
}

export function toPublicApiError(error: unknown): PublicApiError {
  if (error instanceof PublicApiError) return error;
  return new PublicApiError(502, 'PROVIDER_ERROR', '資料服務暫時無法使用，請稍後再試。');
}
