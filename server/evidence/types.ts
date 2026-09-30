export type EvidenceStatus = 'observed' | 'missing' | 'unavailable';

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
  location?: { x: number; y: number };
  playerLocations: Array<{ participantHmac: string; x: number; y: number }>;
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
  participants: EvidenceRoundParticipant[];
  kills: EvidenceKill[];
}

export interface DurableMatchEvidence {
  matchLookupHmac: string;
  provider: 'HenrikDev';
  providerSchemaVersion: 'v4';
  normalizationVersion: 'durable-evidence-v1';
  affinity: string;
  mapId?: string;
  mapName?: string;
  queueId?: string;
  queueName?: string;
  startedAt?: string;
  gameLengthMs?: number;
  participants: EvidenceParticipant[];
  teams: Array<{ teamKey: string; won?: boolean; roundsWon?: number; roundsLost?: number }>;
  rounds: EvidenceRound[];
}
