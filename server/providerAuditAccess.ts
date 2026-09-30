import { PublicApiError } from './errors.js';

export function assertProviderAuditAllowed(environment = process.env.VERCEL_ENV): void {
  if (environment === 'production') {
    throw new PublicApiError(404, 'METHOD_NOT_ALLOWED', '找不到此功能。');
  }
}
