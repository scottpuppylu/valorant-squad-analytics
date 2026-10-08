import type { DatasetAnalyticsContextResponse, DatasetHistoryResponse, DatasetReadyResponse } from './contracts.js';
import { normalizeSeasonKey } from '../../analytics/scope/season.js';
import type { NormalizedAnalyticsDataset } from '../types.js';
import { validSynergyContract } from './synergyContract.js';
import { isEventMetricRuleVersion } from '../../types/advancedMetrics.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isAdvancedMetrics(value: unknown): boolean {
  if (!isRecord(value) || !isEventMetricRuleVersion(value.ruleVersion) || !isRecord(value.coverage) || !isRecord(value.evidence)) return false;
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
    && candidate.schemaVersion === 6
    && (candidate.state === 'ready' || candidate.state === 'empty')
    && typeof candidate.snapshot?.version === 'string'
    && candidate.snapshot.projectionVersion === 'evidence-decoupled-projection-v1'
    && candidate.snapshot.generation === 'dataset-read-v4'
    && candidate.snapshot.source === 'durable-neon'
    && candidate.snapshot.identityVersion === 'member-identity-v2'
    && isRealDataset(candidate.dataset);
}

export function isRealDataset(dataset: unknown): dataset is NormalizedAnalyticsDataset {
  if (!isRecord(dataset)) return false;
  const candidate = dataset as Partial<NormalizedAnalyticsDataset>;
  return candidate.mode === 'REAL'
    && candidate.isDemo === false
    && Array.isArray(candidate.players)
    && candidate.players.every(isMemberPlayer)
    && Array.isArray(candidate.matches)
    && candidate.matches.every((match) => isRecord(match)
      && Array.isArray(match.performances)
      && match.performances.every((performance) => isRecord(performance)
        && isEventEvidence(performance)
        && (performance.advancedMetrics === undefined || isAdvancedMetrics(performance.advancedMetrics)))
      && validSynergyContract(match, new Set(candidate.players!.map((p) => p.id))));
}

/** member-identity-v2: every public player is a member with >=1 sanitized account and at most one primary. */
function isMemberPlayer(player: unknown): boolean {
  if (!isRecord(player) || typeof player.id !== 'string' || !Array.isArray(player.accounts) || player.accounts.length === 0) return false;
  if (player.nameSource !== 'legacy_account' && player.nameSource !== 'community') return false;
  // member-identity-v2: optional nickname of the person; absent when unset (never an empty string).
  if (player.nickname !== undefined && (typeof player.nickname !== 'string' || player.nickname.length === 0
    || player.nickname.length > 64 || player.nickname.trim() !== player.nickname)) return false;
  const allowed = new Set(['id', 'gameName', 'tag', 'isPrimary', 'label']);
  const accounts = player.accounts as unknown[];
  return accounts.every((account) => isRecord(account) && Object.keys(account).every((key) => allowed.has(key))
      && typeof account.id === 'string' && account.id.length > 0 && typeof account.gameName === 'string'
      && typeof account.tag === 'string' && typeof account.isPrimary === 'boolean'
      && (account.label === undefined || typeof account.label === 'string'))
    && accounts.filter((account) => isRecord(account) && account.isPrimary === true).length <= 1;
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
    && candidate.schemaVersion === 6
    && candidate.view === 'history'
    && candidate.historyVersion === 'dataset-history-v1'
    && candidate.projectionVersion === 'evidence-decoupled-projection-v1'
    && candidate.identityVersion === 'member-identity-v2'
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
  return candidate.ok === true && candidate.schemaVersion === 6 && candidate.view === 'analytics'
    && candidate.analyticsVersion === 'analytics-context-v1' && candidate.scopeRuleVersion === 'analysis-scope-v1'
    && candidate.featurePolicyVersion === 'feature-scope-policy-v3' && candidate.adaptiveWindowVersion === 'adaptive-window-v1'
    && isRecord(population) && count(population.trackedMatchCount) && typeof population.snapshotCoversTrackedHistory === 'boolean'
    && population.lifetimeComplete === false
    && isRecord(evidence) && isRecord(evidence.season) && scopeStatuses.has(evidence.season.status)
    && evidence.season.currentActKnown === false && Array.isArray(evidence.season.acts)
    && evidence.season.acts.every((act) => isRecord(act) && normalizeSeasonKey(act.key) === act.key && count(act.matches))
    && isRecord(evidence.rank) && scopeStatuses.has(evidence.rank.status)
    && isRecord(evidence.duration) && Array.isArray(evidence.queues)
    && (candidate.facets === undefined || (isRecord(candidate.facets)
      && Array.isArray(candidate.facets.maps) && candidate.facets.maps.every((item) => isRecord(item) && typeof item.map === 'string' && count(item.matches))
      && Array.isArray(candidate.facets.agents) && candidate.facets.agents.every((agent) => typeof agent === 'string')
      && Array.isArray(candidate.facets.gameModes) && candidate.facets.gameModes.every((mode) => typeof mode === 'string')
      && isRecord(candidate.facets.teamOutcome) && count(candidate.facets.teamOutcome.matches) && count(candidate.facets.teamOutcome.wins)
      && candidate.facets.teamOutcome.wins <= candidate.facets.teamOutcome.matches));
}
