import { createHmac, randomUUID } from 'node:crypto';

function requireKey(explicitKey?: string): string {
  const key = explicitKey ?? process.env.IDENTIFIER_HMAC_KEY;
  if (!key || Buffer.byteLength(key, 'utf8') < 32) {
    throw new Error('IDENTIFIER_HMAC_KEY must contain at least 32 UTF-8 bytes.');
  }
  return key;
}

export function lookupHmac(domain: string, value: string, explicitKey?: string): string {
  return createHmac('sha256', requireKey(explicitKey))
    .update(`${domain}\0${value}`, 'utf8')
    .digest('hex');
}

export function providerIdentityHmac(provider: string, affinity: string, identifier: string, key?: string): string {
  return lookupHmac(`provider-identity:v1:${provider}:${affinity}`, identifier, key);
}

export function sourceMatchHmac(provider: string, matchId: string, key?: string): string {
  return lookupHmac(`source-match:v1:${provider}`, matchId, key);
}

export function participantHmac(matchId: string, providerIdentifier: string, key?: string): string {
  return lookupHmac(`match-participant:v1:${matchId}`, providerIdentifier, key);
}

export function eventHmac(matchId: string, eventIdentity: string, key?: string): string {
  return lookupHmac(`kill-event:v1:${matchId}`, eventIdentity, key);
}

export function newPublicId(): string {
  return randomUUID();
}
