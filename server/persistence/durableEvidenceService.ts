import type { ConnectionInput, MatchImportInput } from '../contracts.js';
import type { SqlDatabase, SqlExecutor } from '../db/types.js';
import { normalizeHenrikEvidence } from '../evidence/normalizeHenrikEvidence.js';
import { providerIdentityHmac } from '../identityProtection.js';
import { DEFAULT_SQUAD_ID, PostgresConsentRepository, PostgresMatchEvidenceRepository, PostgresPlayerRepository } from '../repositories/postgres.js';

export interface DurableWriteSummary {
  playerWrites: number;
  consentWrites: number;
  matchWrites: number;
  publicPlayerId?: string;
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
  persistConnection(input: ConnectionInput, providerIdentifier: string, at?: string): Promise<DurableWriteSummary>;
  persistMatches(input: MatchImportInput, payload: unknown, at?: string): Promise<DurableWriteSummary>;
}

export interface DurableSyncPageSummary {
  matchWrites: number;
  matchLookupHmacs: string[];
  startedAtValues: string[];
  performance: DurablePersistencePerformance;
}

export class DurableEvidenceService implements DurableEvidenceWriter {
  private readonly players = new PostgresPlayerRepository();
  private readonly consents = new PostgresConsentRepository();
  private readonly matches = new PostgresMatchEvidenceRepository();

  constructor(private readonly database: SqlDatabase, private readonly hmacKey: string) {}

  async persistConnection(input: ConnectionInput, providerIdentifier: string, at = new Date().toISOString()): Promise<DurableWriteSummary> {
    let publicPlayerId: string | undefined;
    await this.database.transaction(async (transaction) => {
      const player = await this.players.upsertConnectedPlayer(transaction, {
        provider: 'HenrikDev', affinity: input.affinity,
        identityLookupHmac: providerIdentityHmac('HenrikDev', input.affinity, providerIdentifier, this.hmacKey),
        displayName: input.gameName, displayTag: input.tag,
      });
      publicPlayerId = player.publicId;
      await this.consents.recordActiveSelfAssertedConsent(transaction, player.id, '2026-09-30-v1', at);
    });
    return { playerWrites: 1, consentWrites: 1, matchWrites: 0, publicPlayerId };
  }

  async persistMatches(input: MatchImportInput, payload: unknown, at = new Date().toISOString()): Promise<DurableWriteSummary> {
    const normalizationStarted = performance.now();
    const evidence = normalizeHenrikEvidence(payload, input, this.hmacKey);
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
    let sqlQueryCount = 0;
    for (const match of evidence) {
      const consenting = match.participants.find((participant) => participant.providerIdentityHmac);
      if (!consenting?.providerIdentityHmac) throw new Error('Consenting participant is absent from provider evidence.');
      const identityLookupHmac = consenting.providerIdentityHmac;
      const transactionStarted = performance.now();
      await this.database.transaction(async (transaction) => {
        const measuredTransaction: SqlExecutor = {
          query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
            sqlQueryCount += 1;
            return transaction.query<Row>(sql, params);
          },
        };
        const player = await this.players.upsertConnectedPlayer(measuredTransaction, {
          provider: match.provider, affinity: input.affinity, identityLookupHmac,
          displayName: input.gameName, displayTag: input.tag,
        });
        await this.consents.recordActiveSelfAssertedConsent(measuredTransaction, player.id, '2026-09-30-v1', at);
        await this.matches.upsertMatch(measuredTransaction, DEFAULT_SQUAD_ID, player.id, match, at);
      });
      sqlQueryCount += 2;
      dbTransactionMs += Math.round(performance.now() - transactionStarted);
      matchWrites += 1;
    }
    return {
      playerWrites: evidence.length > 0 ? 1 : 0,
      consentWrites: evidence.length > 0 ? 1 : 0,
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
    const normalizationStarted = performance.now();
    const evidence = normalizeHenrikEvidence(payload, input, this.hmacKey);
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
    let sqlQueryCount = 0;
    for (const match of evidence) {
      if (!match.participants.some((participant) => participant.providerIdentityHmac)) {
        throw new Error('Consenting participant is absent from provider evidence.');
      }
      const transactionStarted = performance.now();
      await this.database.transaction(async (transaction) => {
        const measuredTransaction: SqlExecutor = {
          query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
            sqlQueryCount += 1;
            return transaction.query<Row>(sql, params);
          },
        };
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
