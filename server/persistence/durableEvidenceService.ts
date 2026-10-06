import type { ConnectionInput, MatchImportInput } from '../contracts.js';
import { ConsentingParticipantAbsentError, ConsentingParticipantAmbiguousError } from './errors.js';
import type { SqlDatabase, SqlExecutor } from '../db/types.js';
import type { DurableMatchEvidence } from '../evidence/types.js';
import { normalizeHenrikEvidence } from '../evidence/normalizeHenrikEvidence.js';
import { providerIdentityHmac } from '../identityProtection.js';
import {
  consentCredentialVersion,
  consentManagementCredentialHmac,
  createConsentManagementCredential,
} from '../consentManagementCredential.js';
import { PublicApiError } from '../errors.js';
import { DEFAULT_SQUAD_ID, PostgresConsentRepository, PostgresMatchEvidenceRepository, PostgresPlayerRepository } from '../repositories/postgres.js';
import { PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION } from '../../shared/privacyPolicy.js';

export interface DurableWriteSummary {
  playerWrites: number;
  consentWrites: number;
  matchWrites: number;
  publicPlayerId?: string;
  managementCredential?: string;
  performance?: DurablePersistencePerformance;
}

export interface DurablePersistencePerformance {
  normalizationMs: number;
  dbTransactionMs: number;
  sqlQueryCount: number;
  evidenceCounts: {
    participants: number;
    teams: number;
    rounds: number;
    roundParticipants: number;
    kills: number;
    assistants: number;
    locations: number;
  };
}

export interface DurableEvidenceWriter {
  assertConnectionAllowed(input: ConnectionInput): Promise<void>;
  persistConnection(input: ConnectionInput, providerIdentifier: string, at?: string): Promise<DurableWriteSummary>;
  persistMatches(input: MatchImportInput, payload: unknown, at?: string): Promise<DurableWriteSummary>;
  assertImportAllowed(input: MatchImportInput): Promise<void>;
}

export interface DurableSyncPageSummary {
  matchWrites: number;
  matchLookupHmacs: string[];
  startedAtValues: string[];
  performance: DurablePersistencePerformance;
}

/** historical-identity-v1: every match must contain EXACTLY ONE participant carrying the account's identity. */
function assertSingleConsentingParticipant(match: DurableMatchEvidence): void {
  const count = match.participants.filter((participant) => participant.providerIdentityHmac).length;
  if (count === 0) throw new ConsentingParticipantAbsentError();
  if (count > 1) throw new ConsentingParticipantAmbiguousError();
}

export class DurableEvidenceService implements DurableEvidenceWriter {
  private readonly players = new PostgresPlayerRepository();
  private readonly consents = new PostgresConsentRepository();
  private readonly matches = new PostgresMatchEvidenceRepository();

  constructor(private readonly database: SqlDatabase, private readonly hmacKey: string) {}

  async assertConnectionAllowed(input: ConnectionInput): Promise<void> {
    const result = await this.database.query<{ blocked: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM players p
         JOIN provider_identities pi ON pi.player_id=p.id AND pi.provider='HenrikDev' AND pi.affinity=$3
         JOIN deletion_jobs dj ON dj.player_id=p.id AND dj.status <> 'complete'
         WHERE lower(p.display_name)=lower($1) AND lower(p.display_tag)=lower($2)
       ) AS blocked`,
      [input.gameName, input.tag, input.affinity],
    );
    if (result.rows[0]?.blocked === true) {
      throw new PublicApiError(409, 'CONSENT_REVOKED', '撤回刪除工作尚未完成，未呼叫資料來源。');
    }
  }

  async persistConnection(input: ConnectionInput, providerIdentifier: string, at = new Date().toISOString()): Promise<DurableWriteSummary> {
    let publicPlayerId: string | undefined;
    let managementCredential: string | undefined;
    await this.database.transaction(async (transaction) => {
      const player = await this.players.upsertConnectedPlayer(transaction, {
        provider: 'HenrikDev', affinity: input.affinity,
        identityLookupHmac: providerIdentityHmac('HenrikDev', input.affinity, providerIdentifier, this.hmacKey),
        displayName: input.gameName, displayTag: input.tag,
      });
      publicPlayerId = player.publicId;
      const candidate = createConsentManagementCredential();
      const consent = await this.consents.recordActiveSelfAssertedConsent(
        transaction,
        player.id,
        PUBLIC_DATASET_PRIVACY_VERSION,
        at,
        { hmac: consentManagementCredentialHmac(candidate, this.hmacKey), version: consentCredentialVersion, issuedAt: at },
      );
      if (consent.credentialIssued) managementCredential = candidate;
    });
    return { playerWrites: 1, consentWrites: 1, matchWrites: 0, publicPlayerId, managementCredential };
  }

  async assertImportAllowed(input: MatchImportInput): Promise<void> {
    const result = await this.database.query<{ active: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM players p
         JOIN provider_identities pi ON pi.player_id=p.id AND pi.provider='HenrikDev' AND pi.affinity=$2
         JOIN squad_memberships sm ON sm.player_id=p.id AND sm.status='active'
         JOIN consents c ON c.player_id=p.id AND c.status='active'
           AND c.consent_method=$5 AND c.privacy_version=$6
         WHERE p.public_id=$1 AND p.display_name=$3 AND p.display_tag=$4 AND p.anonymized_at IS NULL
       ) AS active`,
      [input.playerId, input.affinity, input.gameName, input.tag, PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION],
    );
    if (result.rows[0]?.active !== true) {
      throw new PublicApiError(409, 'CONSENT_REVOKED', '玩家同意目前不是有效狀態，未呼叫資料來源。');
    }
  }

  async persistMatches(input: MatchImportInput, payload: unknown, at = new Date().toISOString()): Promise<DurableWriteSummary> {
    await this.assertImportAllowed(input);
    const expectedIdentity = await this.players.resolveProviderIdentityHmac(this.database, { publicId: input.playerId }, input.affinity);
    const normalizationStarted = performance.now();
    const evidence = normalizeHenrikEvidence(payload, input, this.hmacKey, expectedIdentity);
    const normalizationMs = Math.round(performance.now() - normalizationStarted);
    const evidenceCounts = evidence.reduce<DurablePersistencePerformance['evidenceCounts']>((counts, match) => {
      counts.participants += match.participants.length;
      counts.teams += match.teams.length;
      counts.rounds += match.rounds.length;
      for (const round of match.rounds) {
        counts.roundParticipants += round.participants.length;
        counts.kills += round.kills.length;
        for (const kill of round.kills) {
          counts.assistants += new Set(kill.assistantHmacs).size;
          counts.locations += kill.playerLocations.length;
        }
      }
      return counts;
    }, { participants: 0, teams: 0, rounds: 0, roundParticipants: 0, kills: 0, assistants: 0, locations: 0 });
    let matchWrites = 0;
    let dbTransactionMs = 0;
    let sqlQueryCount = 2;
    for (const match of evidence) {
      assertSingleConsentingParticipant(match);
      const transactionStarted = performance.now();
      await this.database.transaction(async (transaction) => {
        const measuredTransaction: SqlExecutor = {
          query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
            sqlQueryCount += 1;
            return transaction.query<Row>(sql, params);
          },
        };
        const player = await measuredTransaction.query<{ id: string }>(
          `SELECT p.id FROM players p JOIN consents c ON c.player_id=p.id AND c.status='active'
             AND c.consent_method=$2 AND c.privacy_version=$3
           WHERE p.public_id=$1 AND p.anonymized_at IS NULL FOR UPDATE OF c`,
          [input.playerId, PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION],
        );
        if (!player.rows[0]) throw new PublicApiError(409, 'CONSENT_REVOKED', '玩家已撤回同意，未寫入戰績。');
        await this.matches.upsertMatch(measuredTransaction, DEFAULT_SQUAD_ID, player.rows[0].id, match, at);
      });
      sqlQueryCount += 2;
      dbTransactionMs += Math.round(performance.now() - transactionStarted);
      matchWrites += 1;
    }
    return {
      playerWrites: evidence.length > 0 ? 1 : 0,
      consentWrites: 0,
      matchWrites,
      performance: { normalizationMs, dbTransactionMs, sqlQueryCount, evidenceCounts },
    };
  }

  async persistSyncPage(
    input: MatchImportInput,
    payload: unknown,
    playerId: string,
    at = new Date().toISOString(),
  ): Promise<DurableSyncPageSummary> {
    const expectedIdentity = await this.players.resolveProviderIdentityHmac(this.database, { id: playerId }, input.affinity);
    const normalizationStarted = performance.now();
    const evidence = normalizeHenrikEvidence(payload, input, this.hmacKey, expectedIdentity);
    const normalizationMs = Math.round(performance.now() - normalizationStarted);
    const evidenceCounts = evidence.reduce<DurablePersistencePerformance['evidenceCounts']>((counts, match) => {
      counts.participants += match.participants.length;
      counts.teams += match.teams.length;
      counts.rounds += match.rounds.length;
      for (const round of match.rounds) {
        counts.roundParticipants += round.participants.length;
        counts.kills += round.kills.length;
        for (const kill of round.kills) {
          counts.assistants += new Set(kill.assistantHmacs).size;
          counts.locations += kill.playerLocations.length;
        }
      }
      return counts;
    }, { participants: 0, teams: 0, rounds: 0, roundParticipants: 0, kills: 0, assistants: 0, locations: 0 });
    let dbTransactionMs = 0;
    let sqlQueryCount = 1;
    for (const match of evidence) {
      assertSingleConsentingParticipant(match);
      const transactionStarted = performance.now();
      await this.database.transaction(async (transaction) => {
        const measuredTransaction: SqlExecutor = {
          query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
            sqlQueryCount += 1;
            return transaction.query<Row>(sql, params);
          },
        };
        const consent = await measuredTransaction.query<{ id: string }>(
          `SELECT id FROM consents WHERE player_id=$1 AND status='active'
             AND consent_method=$2 AND privacy_version=$3 FOR UPDATE`,
          [playerId, PUBLIC_DATASET_CONSENT_METHOD, PUBLIC_DATASET_PRIVACY_VERSION],
        );
        if (!consent.rows[0]) throw new PublicApiError(409, 'CONSENT_REVOKED', '玩家已撤回同意，未寫入戰績。');
        await this.matches.upsertMatch(measuredTransaction, DEFAULT_SQUAD_ID, playerId, match, at);
      });
      sqlQueryCount += 2;
      dbTransactionMs += Math.round(performance.now() - transactionStarted);
    }
    return {
      matchWrites: evidence.length,
      matchLookupHmacs: evidence.map((match) => match.matchLookupHmac),
      startedAtValues: evidence.flatMap((match) => match.startedAt ? [match.startedAt] : []),
      performance: { normalizationMs, dbTransactionMs, sqlQueryCount, evidenceCounts },
    };
  }
}
