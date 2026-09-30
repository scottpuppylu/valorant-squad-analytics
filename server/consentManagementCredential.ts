import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lookupHmac } from './identityProtection.js';

export const consentCredentialVersion = 'consent-management:v1';

export function createConsentManagementCredential(): string {
  return randomBytes(32).toString('base64url');
}

export function consentManagementCredentialHmac(credential: string, hmacKey?: string): string {
  return lookupHmac(consentCredentialVersion, credential, hmacKey);
}

export function isConsentManagementCredential(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function verifyConsentManagementCredential(
  credential: string,
  storedHmac: string | null | undefined,
  hmacKey?: string,
): boolean {
  if (!isConsentManagementCredential(credential) || !storedHmac || !/^[a-f0-9]{64}$/u.test(storedHmac)) return false;
  const calculated = Buffer.from(consentManagementCredentialHmac(credential, hmacKey), 'hex');
  const expected = Buffer.from(storedHmac, 'hex');
  return calculated.length === expected.length && timingSafeEqual(calculated, expected);
}
