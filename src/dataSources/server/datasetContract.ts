import type { DatasetReadyResponse } from './contracts';
import { validSynergyContract } from './synergyContract';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isAdvancedMetrics(value: unknown): boolean {
  if (!isRecord(value) || value.ruleVersion !== 'event-metrics-v1' || !isRecord(value.coverage) || !isRecord(value.evidence)) return false;
  if (!isFiniteOptionalNumber(value.coverage.eligibleRounds)
    || !isFiniteOptionalNumber(value.coverage.reconstructedRounds)
    || !isFiniteOptionalNumber(value.coverage.omittedRounds)) return false;
  const validStatuses = new Set(['reconstructed', 'derived', 'partial', 'unavailable']);
  const statuses = value.evidence;
  return ['trade', 'clutch', 'objectives', 'abilityCasts', 'economy', 'impactContext', 'roleValueInputs']
    .every((key) => typeof statuses[key] === 'string' && validStatuses.has(statuses[key]));
}

export function isDatasetResponse(value: unknown): value is DatasetReadyResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DatasetReadyResponse>;
  return candidate.ok === true
    && candidate.schemaVersion === 4
    && (candidate.state === 'ready' || candidate.state === 'empty')
    && typeof candidate.snapshot?.version === 'string'
    && candidate.snapshot.projectionVersion === 'evidence-decoupled-projection-v1'
    && candidate.snapshot.generation === 'dataset-read-v4'
    && candidate.snapshot.source === 'durable-neon'
    && candidate.dataset?.mode === 'REAL'
    && candidate.dataset.isDemo === false
    && Array.isArray(candidate.dataset.players)
    && Array.isArray(candidate.dataset.matches)
    && candidate.dataset.matches.every((match) => isRecord(match)
      && Array.isArray(match.performances)
      && match.performances.every((performance) => isRecord(performance)
        && isEventEvidence(performance)
        && (performance.advancedMetrics === undefined || isAdvancedMetrics(performance.advancedMetrics)))
      && validSynergyContract(match, new Set(candidate.dataset!.players.map((p) => p.id))));
}

function isEventEvidence(performance: Record<string, unknown>): boolean {
  const evidence = performance.eventEvidence;
  if (!isRecord(evidence) || Object.keys(evidence).some((key) => key !== 'kast' && key !== 'opening')) return false;
  const statuses = ['reconstructed', 'partial', 'unavailable'];
  if (!statuses.includes(String(evidence.kast)) || !statuses.includes(String(evidence.opening))) return false;
  if (evidence.kast === 'reconstructed') {
    if (typeof performance.kast !== 'number' || !Number.isFinite(performance.kast)) return false;
  } else if (performance.kast !== undefined) return false;
  if (evidence.opening === 'reconstructed') {
    if (typeof performance.firstKills !== 'number' || typeof performance.firstDeaths !== 'number') return false;
  } else if (performance.firstKills !== undefined || performance.firstDeaths !== undefined) return false;
  return true;
}
