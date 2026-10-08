import { normalizeSeasonKey } from '../scope/season.js';
import { isAbsoluteStrengthMode, requestedModeAllowed } from '../modeEligibility.js';
import { aggregateWeaponFacts, buildWeaponAnalytics, type EvidenceState, type WeaponAggregates, type WeaponMatchFact, type WeaponScopeMode } from './engine.js';

/**
 * TASK-WEAPON-01 `feature=weaponAnalytics` request semantics, shared by the server (SQL aggregation) and the
 * static read model's browser engine (fact aggregation with the engine's SQL mirror `aggregateWeaponFacts`)
 * — TASK-INFRA-STATIC-QUERY-PARITY-01. Only the aggregation source differs; filters, reasons, status and the
 * result builder are this one implementation.
 */
export interface WeaponRequest { player: string; scope: WeaponScopeMode; act?: string; map: string; agent: string; mode: string }

/** weapon-analytics-v2 / mode-eligibility-policy-v1: weapon STRENGTH evidence is Competitive only. */
export function weaponModeExcluded(request: WeaponRequest): boolean {
  return !requestedModeAllowed('ABSOLUTE_STRENGTH', request.mode);
}

/** Whether a match of this normalized game mode belongs to the request's queue population. */
export function weaponModeIncluded(request: WeaponRequest, gameMode: string): boolean {
  return !weaponModeExcluded(request) && isAbsoluteStrengthMode(gameMode) && (request.mode === 'all' || gameMode === request.mode);
}

/** Reasons known before aggregation. `actObserved`: some tracked source match carries the requested Act. */
export function weaponRequestReasons(request: WeaponRequest, actObserved: boolean, current?: { scopeStatus?: EvidenceState; scopeReasons: string[] }): string[] {
  const reasons: string[] = [];
  if (weaponModeExcluded(request)) reasons.push('queue_excluded_by_policy');
  if (request.scope === 'act' && !actObserved) reasons.push('act_not_observed');
  if (current) reasons.push(...current.scopeReasons, 'current_strength_adaptive_window');
  return reasons;
}

/** The public weapon payload from aggregates (identical for SQL and fact aggregation). */
export function finishWeaponAnalytics(aggregates: WeaponAggregates, request: WeaponRequest, options: { memberIds: string[]; reasons: string[]; scopeStatus?: EvidenceState }) {
  const reasons = [...options.reasons];
  const memberVisible = request.player === 'all' || options.memberIds.includes(request.player);
  if (!memberVisible) reasons.push('member_not_visible');
  const anyRounds = aggregates.rounds.some((row) => row.dim === 'total' && row.playedRounds > 0);
  const status: EvidenceState = !memberVisible || !anyRounds ? 'unavailable' : options.scopeStatus === 'partial' ? 'partial' : 'available';
  const result = buildWeaponAnalytics(aggregates, {
    memberIds: options.memberIds, ...(request.player !== 'all' && memberVisible ? { memberId: request.player } : {}),
    scope: { mode: request.scope, status, reasons: [...new Set(reasons)].sort(), ...(request.act ? { act: request.act } : {}), context: { map: request.map, agent: request.agent, mode: request.mode } },
  });
  return { ok: true as const, schemaVersion: 6 as const, view: 'analysis' as const, feature: 'weaponAnalytics' as const, modeEligibilityPolicyVersion: 'mode-eligibility-policy-v1' as const, ...result };
}

/**
 * A public weapon fact: one member-match participation exactly as the server SQL sees it (`participations` +
 * eligible round rows + the member's own kill events), plus the raw filter columns the SQL `WHERE` uses.
 */
export interface PublicWeaponFact extends WeaponMatchFact {
  /** normalizeGameMode(queue) — the SQL queue filter's semantics. */
  gameMode: string;
  /** Raw durable map / agent are NULL (the SQL filter compares raw values; `map` / `agent` are coalesced). */
  mapNull?: true;
  agentNull?: true;
}

/** The SQL `WHERE` of `participations` over public facts (queue, map, agent, Act, CURRENT member/match pairs). */
export function filterWeaponFacts(facts: PublicWeaponFact[], request: WeaponRequest, pairs?: Set<string>): WeaponMatchFact[] {
  return facts.filter((fact) => weaponModeIncluded(request, fact.gameMode)
    && (request.map === 'all' || (!fact.mapNull && fact.map === request.map))
    && (request.agent === 'all' || (!fact.agentNull && fact.agent === request.agent))
    && (request.scope !== 'act' || (fact.act !== undefined && normalizeSeasonKey(fact.act) === request.act))
    && (!pairs || pairs.has(`${fact.memberId}|${fact.matchId}`)));
}

export { aggregateWeaponFacts };
