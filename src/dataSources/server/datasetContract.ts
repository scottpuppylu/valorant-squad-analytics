import type { DatasetAnalyticsContextResponse, DatasetHistoryResponse, DatasetReadyResponse } from './contracts';
import { normalizeSeasonKey } from '../../analytics/scope/season';
import type { NormalizedAnalyticsDataset } from '../types';
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
    && isRealDataset(candidate.dataset);
}

export function isRealDataset(dataset: unknown): dataset is NormalizedAnalyticsDataset {
  if (!isRecord(dataset)) return false;
  const candidate = dataset as Partial<NormalizedAnalyticsDataset>;
  return candidate.mode === 'REAL'
    && candidate.isDemo === false
    && Array.isArray(candidate.players)
    && Array.isArray(candidate.matches)
    && candidate.matches.every((match) => isRecord(match)
      && Array.isArray(match.performances)
      && match.performances.every((performance) => isRecord(performance)
        && isEventEvidence(performance)
        && (performance.advancedMetrics === undefined || isAdvancedMetrics(performance.advancedMetrics)))
      && validSynergyContract(match, new Set(candidate.players!.map((p) => p.id))));
}

const optionalIso = (value: unknown) => value === undefined || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** TASK-DATA-03B.1 history page; rejects any lifetime-completeness claim or unbounded page. */
export function isDatasetHistoryResponse(value: unknown): value is DatasetHistoryResponse {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<DatasetHistoryResponse>;
  const page = candidate.page;
  const tracked = candidate.tracked;
  return candidate.ok === true
    && candidate.schemaVersion === 4
    && candidate.view === 'history'
    && candidate.historyVersion === 'dataset-history-v1'
    && candidate.projectionVersion === 'evidence-decoupled-projection-v1'
    && (candidate.state === 'ready' || candidate.state === 'empty')
    && isRecord(page) && count(page.limit) && page.limit >= 1 && page.limit <= 100
    && count(page.traversedMatchCount) && count(page.withheldMatchCount)
    && typeof page.hasMore === 'boolean'
    && (page.hasMore ? typeof page.nextCursor === 'string' && page.nextCursor.length <= 200 : page.nextCursor === null)
    && optionalIso(page.from) && optionalIso(page.to)
    && isRecord(tracked) && count(tracked.trackedMatchCount) && tracked.lifetimeComplete === false
    && optionalIso(tracked.earliestTrackedAt) && optionalIso(tracked.latestTrackedAt) && optionalIso(tracked.lastSyncedAt)
    && isRealDataset(candidate.dataset)
    && candidate.dataset.matches.length <= page.limit * 2;
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

const scopeStatuses = new Set(['available', 'partial', 'unavailable']);

/** TASK-DATA-03B.2A analytics facts; rejects any lifetime/current-Act claim or non-public Act key. */
export function isDatasetAnalyticsContextResponse(value: unknown): value is DatasetAnalyticsContextResponse {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<DatasetAnalyticsContextResponse>;
  const population = candidate.population;
  const evidence = candidate.evidence;
  return candidate.ok === true && candidate.schemaVersion === 4 && candidate.view === 'analytics'
    && candidate.analyticsVersion === 'analytics-context-v1' && candidate.scopeRuleVersion === 'analysis-scope-v1'
    && candidate.featurePolicyVersion === 'feature-scope-policy-v1' && candidate.adaptiveWindowVersion === 'adaptive-window-v1'
    && isRecord(population) && count(population.trackedMatchCount) && typeof population.snapshotCoversTrackedHistory === 'boolean'
    && population.lifetimeComplete === false
    && isRecord(evidence) && isRecord(evidence.season) && scopeStatuses.has(evidence.season.status)
    && evidence.season.currentActKnown === false && Array.isArray(evidence.season.acts)
    && evidence.season.acts.every((act) => isRecord(act) && normalizeSeasonKey(act.key) === act.key && count(act.matches))
    && isRecord(evidence.rank) && scopeStatuses.has(evidence.rank.status)
    && isRecord(evidence.duration) && Array.isArray(evidence.queues);
}
