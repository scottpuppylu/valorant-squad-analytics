import type {
  AbilityCastMetrics, ClutchMetrics, EconomyMetrics, ImpactContextMetrics, KastMetrics,
  MetricCoverage, MetricEvidence, ObjectiveMetrics, OpeningMetrics, RoleValueInputs, TradeMetrics,
} from '../../src/types/advancedMetrics.js';
import type { EvidenceStatus } from '../evidence/types.js';

export interface MetricParticipantInput {
  id: string;
  teamKey: string;
  agent?: string;
  assists?: number;
  kills?: number;
  damage?: number;
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

export interface MetricRoundInput {
  id: string;
  number: number;
  winningTeam?: string;
  participantsStatus: EvidenceStatus;
  participantIds: string[];
  plantStatus: EvidenceStatus | 'present' | 'absent';
  plantParticipantId?: string;
  defuseStatus: EvidenceStatus | 'present' | 'absent';
  defuseParticipantId?: string;
}

export interface MetricKillInput {
  roundId: string;
  sequence: number;
  timeInRoundMs: number;
  killerId: string;
  victimId: string;
  assistantIds: string[];
}

export interface EventMetricMatchInput {
  normalizationVersion: string;
  roundsStatus: EvidenceStatus;
  killsStatus: EvidenceStatus;
  participants: MetricParticipantInput[];
  rounds: MetricRoundInput[];
  kills: MetricKillInput[];
}

export interface MetricTraceEntry {
  domain: 'trade' | 'kast' | 'opening' | 'clutch' | 'objectives' | 'economy' | 'impact' | 'role';
  roundNumber?: number;
  eventSequence?: number;
  branch: string;
  count?: number;
  reason?: string;
}

export interface PlayerMetricReconstruction {
  metrics: ReconstructedAdvancedMetrics;
  trace: MetricTraceEntry[];
}

export interface ReconstructedAdvancedMetrics {
  ruleVersion: string;
  coverage: MetricCoverage;
  trade: MetricEvidence<TradeMetrics>;
  kast: MetricEvidence<KastMetrics>;
  opening: MetricEvidence<OpeningMetrics>;
  clutch: MetricEvidence<ClutchMetrics>;
  objectives: MetricEvidence<ObjectiveMetrics>;
  abilityCasts: MetricEvidence<AbilityCastMetrics>;
  economy: MetricEvidence<EconomyMetrics>;
  impactContext: MetricEvidence<ImpactContextMetrics>;
  roleValueInputs: MetricEvidence<RoleValueInputs>;
}

export interface MatchMetricReconstruction {
  ruleVersion: string;
  players: Map<string, PlayerMetricReconstruction>;
}
