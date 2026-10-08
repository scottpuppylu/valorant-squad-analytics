import type { POSITION_EVIDENCE_VERSION } from './positionEvidence.js';
export type EvidenceStatus = 'observed' | 'missing' | 'unavailable';

export const DURABLE_NORMALIZATION_VERSION = 'durable-evidence-v2' as const;
/**
 * Consenting-participant identity rule (docs/HISTORICAL_IDENTITY.md). Deliberately separate from
 * DURABLE_NORMALIZATION_VERSION: the normalized evidence shape is unchanged, and bumping that version
 * would make every stored v2 match ineligible for event metrics.
 */
export const HISTORICAL_IDENTITY_VERSION = 'historical-identity-v1' as const;

export interface EvidenceParticipant {
  lookupHmac: string;
  providerIdentityHmac?: string;
  teamKey: string;
  agentId?: string;
  agentName?: string;
  status: EvidenceStatus;
  kills?: number;
  deaths?: number;
  assists?: number;
  score?: number;
  damageDealt?: number;
  damageReceived?: number;
  headshots?: number;
  bodyshots?: number;
  legshots?: number;
  abilityStatus: EvidenceStatus;
  ability1Casts?: number;
  ability2Casts?: number;
  grenadeCasts?: number;
  ultimateCasts?: number;
  economyStatus: EvidenceStatus;
  loadoutValueTotal?: number;
  loadoutValueAverage?: number;
  spentTotal?: number;
  spentAverage?: number;
}

export interface EvidenceKill {
  lookupHmac: string;
  sequence: number;
  timeInRoundMs: number;
  timeInMatchMs?: number;
  killerHmac: string;
  victimHmac: string;
  assistantHmacs: string[];
  weaponId?: string;
  weaponName?: string;
  /** KILL_EVENT_LOCATION: provider `kills[].location` (raw coordinate system). */
  location?: { x: number; y: number };
  /** PLAYER_SNAPSHOT_LOCATION at this kill (position-evidence-v1): one row per participant, first occurrence wins. */
  playerLocations: Array<{ participantHmac: string; x: number; y: number; viewRadians?: number }>;
}

export interface EvidenceRoundParticipant {
  participantHmac: string;
  statsStatus: EvidenceStatus;
  kills?: number;
  score?: number;
  loadoutStatus: EvidenceStatus;
  loadoutValue?: number;
  remainingCredits?: number;
  weaponStatus: EvidenceStatus;
  weaponId?: string;
  weaponName?: string;
  armorStatus: EvidenceStatus;
  armorId?: string;
  armorName?: string;
}

export interface EvidenceRound {
  number: number;
  winningTeam?: string;
  result?: string;
  plantStatus: EvidenceStatus | 'present' | 'absent';
  plantParticipantHmac?: string;
  plantTimeMs?: number;
  defuseStatus: EvidenceStatus | 'present' | 'absent';
  defuseParticipantHmac?: string;
  defuseTimeMs?: number;
  /** position-evidence-v1: provider plant site label (never inferred from coordinates). */
  plantSite?: string;
  plantLocation?: { x: number; y: number };
  defuseLocation?: { x: number; y: number };
  /** position-evidence-v1: explicit round side (see server/evidence/positionEvidence.ts). */
  winningTeamRole?: 'Attacker' | 'Defender';
  attackingTeamKey?: string;
  sideSource?: 'winning_team_role' | 'plant' | 'defuse';
  participantsStatus: EvidenceStatus;
  participants: EvidenceRoundParticipant[];
  kills: EvidenceKill[];
}

export interface DurableMatchEvidence {
  matchLookupHmac: string;
  provider: 'HenrikDev';
  providerSchemaVersion: 'v4';
  normalizationVersion: typeof DURABLE_NORMALIZATION_VERSION;
  affinity: string;
  mapId?: string;
  mapName?: string;
  queueId?: string;
  queueName?: string;
  startedAt?: string;
  gameLengthMs?: number;
  /** TASK-DATA-SEASON-01: validated provider season UUID; server-only. */
  seasonId?: string;
  /** TASK-DATA-SEASON-01: validated provider season short code; public key derived only when recognized. */
  seasonShort?: string;
  roundsStatus: EvidenceStatus;
  killsStatus: EvidenceStatus;
  /** Version of the spatial / side columns written with this match (TASK-DATA-POSITION-NORMALIZATION-01). */
  positionEvidenceVersion: typeof POSITION_EVIDENCE_VERSION;
  participants: EvidenceParticipant[];
  teams: Array<{ teamKey: string; won?: boolean; roundsWon?: number; roundsLost?: number }>;
  rounds: EvidenceRound[];
}
