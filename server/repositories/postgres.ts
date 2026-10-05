import { randomUUID } from 'node:crypto';
import type { SqlExecutor } from '../db/types.js';
import type { DurableMatchEvidence } from '../evidence/types.js';
import type { ConnectedPlayerInput, ConnectedPlayerRecord, ConsentRepository, MatchEvidenceRepository, PlayerRepository, RankRepository, SyncRepository } from './contracts.js';
import { PUBLIC_DATASET_CONSENT_METHOD } from '../../shared/privacyPolicy.js';

export const DEFAULT_SQUAD_ID = '00000000-0000-4000-8000-000000000001';

type IdRow = { id: string };
type PlayerIdRow = IdRow & { public_id: string };
type ParticipantIdRow = IdRow & { participant_lookup_hmac: string };

function valuePlaceholders(rowCount: number, columnCount: number): string {
  return Array.from({ length: rowCount }, (_, rowIndex) => (
    `(${Array.from({ length: columnCount }, (_value, columnIndex) => `$${rowIndex * columnCount + columnIndex + 1}`).join(',')})`
  )).join(',');
}

function flattenRows(rows: unknown[][]): unknown[] {
  return rows.flatMap((row) => row);
}

export async function ensureDefaultSquad(transaction: SqlExecutor): Promise<string> {
  await transaction.query(
    `INSERT INTO squads (id, slug, display_name) VALUES ($1, 'goblin-survey', 'Goblin Survey')
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [DEFAULT_SQUAD_ID],
  );
  return DEFAULT_SQUAD_ID;
}

export class PostgresPlayerRepository implements PlayerRepository {
  async upsertConnectedPlayer(transaction: SqlExecutor, input: ConnectedPlayerInput): Promise<ConnectedPlayerRecord> {
    const existing = await transaction.query<PlayerIdRow>(
      `SELECT p.id, p.public_id FROM players p JOIN provider_identities i ON i.player_id = p.id
       WHERE i.provider = $1 AND i.affinity = $2 AND i.lookup_hmac = $3`,
      [input.provider, input.affinity, input.identityLookupHmac],
    );
    const playerId = existing.rows[0]?.id ?? randomUUID();
    const publicId = existing.rows[0]?.public_id ?? randomUUID();
    if (existing.rows.length === 0) {
      await transaction.query(
        `INSERT INTO players (id, public_id, display_name, display_tag) VALUES ($1, $2, $3, $4)`,
        [playerId, publicId, input.displayName, input.displayTag],
      );
      await transaction.query(
        `INSERT INTO provider_identities (id, player_id, provider, affinity, lookup_hmac)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider, affinity, lookup_hmac) DO NOTHING`,
        [randomUUID(), playerId, input.provider, input.affinity, input.identityLookupHmac],
      );
    } else {
      await transaction.query('UPDATE players SET display_name = $2, display_tag = $3, updated_at = now() WHERE id = $1', [playerId, input.displayName, input.displayTag]);
    }
    const squadId = await ensureDefaultSquad(transaction);
    await transaction.query(
      `INSERT INTO squad_memberships (id, squad_id, player_id) VALUES ($1, $2, $3)
       ON CONFLICT (squad_id, player_id) DO UPDATE SET status = 'active', left_at = NULL`,
      [randomUUID(), squadId, playerId],
    );
    return { id: playerId, publicId };
  }
}

export class PostgresConsentRepository implements ConsentRepository {
  async recordActiveSelfAssertedConsent(
    transaction: SqlExecutor,
    playerId: string,
    privacyVersion: string,
    consentedAt: string,
    credential?: { hmac: string; version: string; issuedAt: string },
  ): Promise<{ id: string; credentialIssued: boolean }> {
    const existing = await transaction.query<IdRow & { privacy_version: string; management_credential_hmac: string | null }>(
      `SELECT id, privacy_version, management_credential_hmac FROM consents
       WHERE player_id = $1 AND status = 'active' FOR UPDATE`,
      [playerId],
    );
    if (existing.rows.length > 1) throw new Error('Player has multiple active consent records.');
    if (existing.rows[0]?.privacy_version === privacyVersion) {
      return { id: existing.rows[0].id, credentialIssued: false };
    }
    if (existing.rows[0]) {
      await transaction.query(
        `UPDATE consents SET status='revoked', revoked_at=$2
         WHERE player_id=$1 AND status='active'`,
        [playerId, consentedAt],
      );
    }
    const id = randomUUID();
    await transaction.query(
      `INSERT INTO consents (
         id, player_id, status, consent_method, privacy_version, consented_at,
         management_credential_hmac, management_credential_version, management_credential_issued_at
       ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8)`,
      [id, playerId, PUBLIC_DATASET_CONSENT_METHOD, privacyVersion, consentedAt, credential?.hmac ?? null, credential?.version ?? null, credential?.issuedAt ?? null],
    );
    return { id, credentialIssued: credential !== undefined };
  }
}

async function upsertId(transaction: SqlExecutor, sql: string, params: unknown[]): Promise<string> {
  const result = await transaction.query<IdRow>(sql, params);
  if (!result.rows[0]) throw new Error('Database write did not return an identifier.');
  return result.rows[0].id;
}

export class PostgresMatchEvidenceRepository implements MatchEvidenceRepository {
  async upsertMatch(transaction: SqlExecutor, squadId: string, playerId: string, evidence: DurableMatchEvidence, observedAt: string): Promise<string> {
    const sourceMatchId = await upsertId(transaction,
      `INSERT INTO source_matches (
        id, squad_id, provider, provider_match_lookup_hmac, provider_schema_version, normalization_version,
        affinity, map_id, map_name, queue_id, queue_name, started_at, game_length_ms, first_observed_at, last_observed_at
        , rounds_evidence_status, kills_evidence_status, season_id, season_short
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17,$18)
      ON CONFLICT (provider, provider_match_lookup_hmac) DO UPDATE SET
        map_id=EXCLUDED.map_id, map_name=EXCLUDED.map_name, queue_id=EXCLUDED.queue_id, queue_name=EXCLUDED.queue_name,
        started_at=EXCLUDED.started_at, game_length_ms=EXCLUDED.game_length_ms, normalization_version=EXCLUDED.normalization_version,
        -- TASK-DATA-SEASON-01: a later valid value corrects; a missing/invalid value never erases.
        season_id=COALESCE(EXCLUDED.season_id, source_matches.season_id),
        season_short=COALESCE(EXCLUDED.season_short, source_matches.season_short),
        rounds_evidence_status=EXCLUDED.rounds_evidence_status, kills_evidence_status=EXCLUDED.kills_evidence_status,
        last_observed_at=EXCLUDED.last_observed_at RETURNING id`,
      [randomUUID(), squadId, evidence.provider, evidence.matchLookupHmac, evidence.providerSchemaVersion, evidence.normalizationVersion,
        evidence.affinity, evidence.mapId ?? null, evidence.mapName ?? null, evidence.queueId ?? null, evidence.queueName ?? null,
        evidence.startedAt ?? null, evidence.gameLengthMs ?? null, observedAt, evidence.roundsStatus, evidence.killsStatus,
        evidence.seasonId ?? null, evidence.seasonShort ?? null],
    );

    const teamRows = evidence.teams.map((team) => [
      randomUUID(), sourceMatchId, team.teamKey, team.won ?? null, team.roundsWon ?? null, team.roundsLost ?? null,
    ]);
    if (teamRows.length > 0) {
      await transaction.query(
        `INSERT INTO match_teams (id, source_match_id, team_key, won, rounds_won, rounds_lost)
         VALUES ${valuePlaceholders(teamRows.length, 6)}
         ON CONFLICT (source_match_id, team_key) DO UPDATE SET
           won=EXCLUDED.won, rounds_won=EXCLUDED.rounds_won, rounds_lost=EXCLUDED.rounds_lost`,
        flattenRows(teamRows),
      );
    }

    const participantRows = evidence.participants.map((participant) => [
      randomUUID(), sourceMatchId, participant.providerIdentityHmac ? playerId : null, participant.lookupHmac,
      participant.teamKey, participant.agentId ?? null, participant.agentName ?? null, participant.status,
      participant.kills ?? null, participant.deaths ?? null, participant.assists ?? null, participant.score ?? null,
      participant.damageDealt ?? null, participant.damageReceived ?? null, participant.headshots ?? null,
      participant.bodyshots ?? null, participant.legshots ?? null,
      participant.abilityStatus, participant.ability1Casts ?? null, participant.ability2Casts ?? null,
      participant.grenadeCasts ?? null, participant.ultimateCasts ?? null,
      participant.economyStatus, participant.loadoutValueTotal ?? null, participant.loadoutValueAverage ?? null,
      participant.spentTotal ?? null, participant.spentAverage ?? null,
    ]);
    const participantResult = participantRows.length === 0
      ? { rows: [] as ParticipantIdRow[] }
      : await transaction.query<ParticipantIdRow>(
        `INSERT INTO match_participants (
           id, source_match_id, player_id, participant_lookup_hmac, team_key, agent_id, agent_name, stats_evidence_status,
           kills, deaths, assists, score, damage_dealt, damage_received, headshots, bodyshots, legshots,
           ability_evidence_status, ability_1_casts, ability_2_casts, grenade_casts, ultimate_casts,
           economy_evidence_status, loadout_value_total, loadout_value_average, spent_total, spent_average
         ) VALUES ${valuePlaceholders(participantRows.length, 27)}
         ON CONFLICT (source_match_id, participant_lookup_hmac) DO UPDATE SET
           player_id=COALESCE(EXCLUDED.player_id, match_participants.player_id), team_key=EXCLUDED.team_key,
           agent_id=EXCLUDED.agent_id, agent_name=EXCLUDED.agent_name, stats_evidence_status=EXCLUDED.stats_evidence_status,
           kills=EXCLUDED.kills, deaths=EXCLUDED.deaths, assists=EXCLUDED.assists, score=EXCLUDED.score,
           damage_dealt=EXCLUDED.damage_dealt, damage_received=EXCLUDED.damage_received,
           headshots=EXCLUDED.headshots, bodyshots=EXCLUDED.bodyshots, legshots=EXCLUDED.legshots,
           ability_evidence_status=EXCLUDED.ability_evidence_status,
           ability_1_casts=EXCLUDED.ability_1_casts, ability_2_casts=EXCLUDED.ability_2_casts,
           grenade_casts=EXCLUDED.grenade_casts, ultimate_casts=EXCLUDED.ultimate_casts,
           economy_evidence_status=EXCLUDED.economy_evidence_status,
           loadout_value_total=EXCLUDED.loadout_value_total, loadout_value_average=EXCLUDED.loadout_value_average,
           spent_total=EXCLUDED.spent_total, spent_average=EXCLUDED.spent_average
         RETURNING id, participant_lookup_hmac`,
        flattenRows(participantRows),
      );
    const participantIds = new Map(participantResult.rows.map((row) => [row.participant_lookup_hmac, row.id]));

    await transaction.query('DELETE FROM rounds WHERE source_match_id = $1', [sourceMatchId]);
    const preparedRounds = evidence.rounds.map((round) => ({ id: randomUUID(), round }));
    const roundRows = preparedRounds.map(({ id, round }) => [
      id, sourceMatchId, round.number, round.winningTeam ?? null, round.result ?? null, round.participantsStatus, round.plantStatus,
      round.plantParticipantHmac ? participantIds.get(round.plantParticipantHmac) ?? null : null, round.plantTimeMs ?? null,
      round.defuseStatus, round.defuseParticipantHmac ? participantIds.get(round.defuseParticipantHmac) ?? null : null,
      round.defuseTimeMs ?? null,
    ]);
    if (roundRows.length > 0) {
      await transaction.query(
        `INSERT INTO rounds (id, source_match_id, round_number, winning_team, result, participants_evidence_status, plant_status, plant_participant_id, plant_time_ms, defuse_status, defuse_participant_id, defuse_time_ms)
         VALUES ${valuePlaceholders(roundRows.length, 12)}`,
        flattenRows(roundRows),
      );
    }

    const roundParticipantRows = preparedRounds.flatMap(({ id: roundId, round }) => round.participants.flatMap((item) => {
      const participantId = participantIds.get(item.participantHmac);
      return participantId ? [[
        randomUUID(), roundId, participantId, item.statsStatus, item.kills ?? null, item.score ?? null, item.loadoutStatus,
        item.loadoutValue ?? null, item.remainingCredits ?? null, item.weaponStatus, item.weaponId ?? null, item.weaponName ?? null,
        item.armorStatus, item.armorId ?? null, item.armorName ?? null,
      ]] : [];
    }));
    if (roundParticipantRows.length > 0) {
      await transaction.query(
        `INSERT INTO round_participants (id, round_id, match_participant_id, stats_evidence_status, kills, score, loadout_evidence_status, loadout_value, remaining_credits, weapon_evidence_status, weapon_id, weapon_name, armor_evidence_status, armor_id, armor_name)
         VALUES ${valuePlaceholders(roundParticipantRows.length, 15)}`,
        flattenRows(roundParticipantRows),
      );
    }

    const preparedKills = preparedRounds.flatMap(({ id: roundId, round }) => round.kills.flatMap((kill) => {
      const killerId = participantIds.get(kill.killerHmac);
      const victimId = participantIds.get(kill.victimHmac);
      return killerId && victimId ? [{ id: randomUUID(), roundId, kill, killerId, victimId }] : [];
    }));
    const killRows = preparedKills.map(({ id, roundId, kill, killerId, victimId }) => [
      id, sourceMatchId, roundId, kill.lookupHmac, kill.sequence, kill.timeInRoundMs, kill.timeInMatchMs ?? null,
      killerId, victimId, kill.weaponId ?? null, kill.weaponName ?? null, kill.location?.x ?? null, kill.location?.y ?? null,
    ]);
    if (killRows.length > 0) {
      await transaction.query(
        `INSERT INTO kill_events (id, source_match_id, round_id, event_lookup_hmac, event_sequence, time_in_round_ms, time_in_match_ms, killer_participant_id, victim_participant_id, weapon_id, weapon_name, location_x, location_y)
         VALUES ${valuePlaceholders(killRows.length, 13)}`,
        flattenRows(killRows),
      );
    }

    const assistantRows = preparedKills.flatMap(({ id: killId, kill }) => [...new Set(kill.assistantHmacs)].flatMap((assistant) => {
      const assistantId = participantIds.get(assistant);
      return assistantId ? [[killId, assistantId]] : [];
    }));
    if (assistantRows.length > 0) {
      await transaction.query(
        `INSERT INTO kill_assistants (kill_event_id, match_participant_id)
         VALUES ${valuePlaceholders(assistantRows.length, 2)} ON CONFLICT DO NOTHING`,
        flattenRows(assistantRows),
      );
    }

    const locationsByParticipant = new Map<string, unknown[]>();
    for (const { id: killId, kill } of preparedKills) {
      for (const location of kill.playerLocations) {
        const locationPlayerId = participantIds.get(location.participantHmac);
        if (locationPlayerId) locationsByParticipant.set(`${killId}:${locationPlayerId}`, [killId, locationPlayerId, location.x, location.y]);
      }
    }
    const locationRows = [...locationsByParticipant.values()];
    if (locationRows.length > 0) {
      await transaction.query(
        `INSERT INTO event_player_locations (kill_event_id, match_participant_id, location_x, location_y)
         VALUES ${valuePlaceholders(locationRows.length, 4)}
         ON CONFLICT (kill_event_id, match_participant_id) DO UPDATE SET
           location_x=EXCLUDED.location_x, location_y=EXCLUDED.location_y`,
        flattenRows(locationRows),
      );
    }
    return sourceMatchId;
  }
}

export class PostgresRankRepository implements RankRepository {
  async recordObservation(transaction: SqlExecutor, input: { playerId: string; provider: string; observedAt: string; tierId?: number; tierName?: string; rr?: number }): Promise<void> {
    await transaction.query(
      `INSERT INTO rank_observations (id, player_id, provider, observed_at, tier_id, tier_name, rr) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), input.playerId, input.provider, input.observedAt, input.tierId ?? null, input.tierName ?? null, input.rr ?? null],
    );
  }
}

export class PostgresSyncRepository implements SyncRepository {
  async startRun(transaction: SqlExecutor, input: { squadId: string; playerId: string; provider: string; startedAt: string }): Promise<string> {
    const id = randomUUID();
    await transaction.query(
      `INSERT INTO sync_runs (id, squad_id, player_id, provider, trigger_kind, status, started_at) VALUES ($1,$2,$3,$4,'connect','running',$5)`,
      [id, input.squadId, input.playerId, input.provider, input.startedAt],
    );
    return id;
  }
  async completeRun(transaction: SqlExecutor, runId: string, completedAt: string): Promise<void> {
    await transaction.query(`UPDATE sync_runs SET status='complete', completed_at=$2 WHERE id=$1`, [runId, completedAt]);
  }
}
