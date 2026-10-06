import { PublicApiError } from '../errors.js';

/**
 * TASK-DATA-HISTORICAL-IDENTITY-01 `historical-identity-v1`: typed, non-database identity failures.
 * They fail closed (no match write, cursor unchanged) and are reported as MALFORMED_RESPONSE, never
 * DATABASE_ERROR. Messages carry no identifier.
 */
export class HistoricalIdentityError extends Error {
  constructor(message: string) { super(message); this.name = 'HistoricalIdentityError'; }
}

/** The public, non-database failure every identity error maps to (category MALFORMED_RESPONSE). */
export function identityFailure(): PublicApiError {
  return new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '無法確認比賽中的同意帳號身分，進度尚未前進。');
}

/** A provider match has no participant whose stable provider identity HMAC equals the syncing account's. */
export class ConsentingParticipantAbsentError extends HistoricalIdentityError {
  constructor() { super('Consenting participant is absent from provider evidence.'); this.name = 'ConsentingParticipantAbsentError'; }
}

/** More than one participant of one provider match carries the syncing account's identity (invariant violation). */
export class ConsentingParticipantAmbiguousError extends HistoricalIdentityError {
  constructor() { super('Consenting participant is ambiguous in provider evidence.'); this.name = 'ConsentingParticipantAmbiguousError'; }
}

/** The syncing account's durable provider identity is not exactly one active HenrikDev row for its affinity. */
export class ProviderIdentityUnresolvedError extends HistoricalIdentityError {
  constructor() { super('Durable provider identity could not be resolved exactly.'); this.name = 'ProviderIdentityUnresolvedError'; }
}

/** A stored participant row is already linked to a different account; it is never overwritten. */
export class ParticipantAccountConflictError extends HistoricalIdentityError {
  constructor() { super('Participant is already linked to a different account.'); this.name = 'ParticipantAccountConflictError'; }
}
