import type { DurableMatchEvidence } from '../evidence/types.js';
import type { SqlExecutor } from '../db/types.js';

export interface ConnectedPlayerInput {
  provider: string;
  affinity: string;
  identityLookupHmac: string;
  displayName: string;
  displayTag: string;
}

export interface ConnectedPlayerRecord {
  id: string;
  publicId: string;
}

export interface PlayerRepository {
  upsertConnectedPlayer(transaction: SqlExecutor, input: ConnectedPlayerInput): Promise<ConnectedPlayerRecord>;
}

export interface ConsentRepository {
  recordActiveSelfAssertedConsent(
    transaction: SqlExecutor,
    playerId: string,
    privacyVersion: string,
    consentedAt: string,
    credential?: { hmac: string; version: string; issuedAt: string },
  ): Promise<{ id: string; credentialIssued: boolean }>;
}

export interface MatchEvidenceRepository {
  upsertMatch(transaction: SqlExecutor, squadId: string, playerId: string, evidence: DurableMatchEvidence, observedAt: string): Promise<string>;
}

export interface RankRepository {
  recordObservation(transaction: SqlExecutor, input: { playerId: string; provider: string; observedAt: string; tierId?: number; tierName?: string; rr?: number }): Promise<void>;
}

export interface SyncRepository {
  startRun(transaction: SqlExecutor, input: { squadId: string; playerId: string; provider: string; startedAt: string }): Promise<string>;
  completeRun(transaction: SqlExecutor, runId: string, completedAt: string): Promise<void>;
}
