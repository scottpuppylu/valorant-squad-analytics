import type { ConnectionInput, MatchImportInput } from '../contracts.js';
import type { SqlDatabase } from '../db/types.js';
import { normalizeHenrikEvidence } from '../evidence/normalizeHenrikEvidence.js';
import { providerIdentityHmac } from '../identityProtection.js';
import { DEFAULT_SQUAD_ID, PostgresConsentRepository, PostgresMatchEvidenceRepository, PostgresPlayerRepository } from '../repositories/postgres.js';

export interface DurableWriteSummary {
  playerWrites: number;
  consentWrites: number;
  matchWrites: number;
}

export interface DurableEvidenceWriter {
  persistConnection(input: ConnectionInput, providerIdentifier: string, at?: string): Promise<DurableWriteSummary>;
  persistMatches(input: MatchImportInput, payload: unknown, at?: string): Promise<DurableWriteSummary>;
}

export class DurableEvidenceService implements DurableEvidenceWriter {
  private readonly players = new PostgresPlayerRepository();
  private readonly consents = new PostgresConsentRepository();
  private readonly matches = new PostgresMatchEvidenceRepository();

  constructor(private readonly database: SqlDatabase, private readonly hmacKey: string) {}

  async persistConnection(input: ConnectionInput, providerIdentifier: string, at = new Date().toISOString()): Promise<DurableWriteSummary> {
    await this.database.transaction(async (transaction) => {
      const playerId = await this.players.upsertConnectedPlayer(transaction, {
        provider: 'HenrikDev', affinity: input.affinity,
        identityLookupHmac: providerIdentityHmac('HenrikDev', input.affinity, providerIdentifier, this.hmacKey),
        displayName: input.gameName, displayTag: input.tag,
      });
      await this.consents.recordActiveSelfAssertedConsent(transaction, playerId, '2026-09-30-v1', at);
    });
    return { playerWrites: 1, consentWrites: 1, matchWrites: 0 };
  }

  async persistMatches(input: MatchImportInput, payload: unknown, at = new Date().toISOString()): Promise<DurableWriteSummary> {
    const evidence = normalizeHenrikEvidence(payload, input, this.hmacKey);
    let matchWrites = 0;
    for (const match of evidence) {
      const consenting = match.participants.find((participant) => participant.providerIdentityHmac);
      if (!consenting?.providerIdentityHmac) throw new Error('Consenting participant is absent from provider evidence.');
      const identityLookupHmac = consenting.providerIdentityHmac;
      await this.database.transaction(async (transaction) => {
        const playerId = await this.players.upsertConnectedPlayer(transaction, {
          provider: match.provider, affinity: input.affinity, identityLookupHmac,
          displayName: input.gameName, displayTag: input.tag,
        });
        await this.consents.recordActiveSelfAssertedConsent(transaction, playerId, '2026-09-30-v1', at);
        await this.matches.upsertMatch(transaction, DEFAULT_SQUAD_ID, playerId, match, at);
      });
      matchWrites += 1;
    }
    return { playerWrites: evidence.length > 0 ? 1 : 0, consentWrites: evidence.length > 0 ? 1 : 0, matchWrites };
  }
}
