import type { AnalysisQuery } from '../../src/dataSources/server/analysisResult.js';
import { staticAnalysisKey, staticWeaponKey } from '../../src/dataSources/static/contract.js';
import type { StaticWeaponQuery as WeaponQuery } from '../../src/dataSources/static/contract.js';

/**
 * `static-catalog-v1`: the deterministic, finite set of public read requests a static snapshot precomputes.
 * Every entry is answered by the SAME server service as the live `/api/valorant/dataset` route.
 *
 * facts    — nothing precomputed: every request runs the shared core on public facts in the browser
 *            (TASK-INFRA-STATIC-QUERY-PARITY-01).
 * common   — facts + the first-paint requests only: Dashboard/Leaderboard 目前實力, each member profile and the
 *            Synergy page defaults (overall and per Act).
 * core     — every page's default request, every analysis period for the whole community and for each member
 *            (profiles), every map (Maps), every agent and role (Agents), Synergy by Act, the improvement index
 *            and weapon analytics per member and scope.
 * extended — core plus EVERY single-filter slice (one of member / map / agent / role / mode) for every period
 *            and member-level weapons by map and agent.
 * Never precomputed (explicit `not precomputed` in the browser, never a substituted scope): combinations of
 * two or more filters, custom date ranges and minimum-sample thresholds other than the page default.
 */
export type StaticCatalogTier = 'facts' | 'common' | 'core' | 'extended';

export interface CatalogFacts {
  /** Public member ids (the dataset's players). */
  players: string[];
  maps: string[];
  agents: string[];
  gameModes: string[];
  /** Public Act keys (analytics context evidence). */
  acts: string[];
}

export const catalogRoles = ['Duelist', 'Initiator', 'Controller', 'Sentinel'] as const;

export interface StaticCatalog { analysis: AnalysisQuery[]; weapons: WeaponQuery[] }

function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, item]) => item);
}

export function buildStaticCatalog(facts: CatalogFacts, tier: StaticCatalogTier): StaticCatalog {
  if (tier === 'facts') return { analysis: [], weapons: [] };
  if (tier === 'common') {
    const current: AnalysisQuery = { feature: 'currentStrength', form: true };
    // Synergy's all-pair default is the costliest shared-engine request (duo-synergy-v1 over every pair window).
    const synergy: AnalysisQuery[] = [{ feature: 'synergy' }, ...[...new Set(facts.acts)].sort().map((act): AnalysisQuery => ({ feature: 'synergy', act }))];
    return { analysis: unique([current, ...[...new Set(facts.players)].sort().map((player) => ({ ...current, player })), ...synergy], staticAnalysisKey), weapons: [] };
  }
  const sorted = (values: string[]) => [...new Set(values)].sort();
  const players = sorted(facts.players);
  const maps = sorted(facts.maps);
  const agents = sorted(facts.agents);
  const modes = sorted(facts.gameModes);
  const acts = sorted(facts.acts);
  // Scope features are exported WITH recent-form windows (a strict superset of the form-less answer).
  const periods: AnalysisQuery[] = ([
    { feature: 'currentStrength' }, { feature: 'lifetimeTotals' }, { feature: 'fixedRecent', recent: 10 }, { feature: 'fixedRecent', recent: 30 },
    ...acts.map((act): AnalysisQuery => ({ feature: 'actOverview', act })),
  ] as AnalysisQuery[]).map((query) => ({ ...query, form: true }));
  const lifetimeViews: AnalysisQuery[] = [{ feature: 'mapStats', form: true }, { feature: 'agentStats', form: true }];
  const slices = (base: AnalysisQuery, dimensions: ('player' | 'map' | 'agent' | 'role' | 'mode')[]): AnalysisQuery[] => [
    base,
    ...(dimensions.includes('player') ? players.map((player) => ({ ...base, player })) : []),
    ...(dimensions.includes('map') ? maps.map((map) => ({ ...base, map })) : []),
    ...(dimensions.includes('agent') ? agents.map((agent) => ({ ...base, agent })) : []),
    ...(dimensions.includes('role') ? catalogRoles.map((role) => ({ ...base, role })) : []),
    ...(dimensions.includes('mode') ? modes.map((mode) => ({ ...base, mode })) : []),
  ];
  const all = ['player', 'map', 'agent', 'role', 'mode'] as const;
  const analysis: AnalysisQuery[] = tier === 'core'
    ? [
      ...periods.flatMap((period) => slices(period, ['player'])),
      ...slices(lifetimeViews[0]!, ['map']),
      ...slices(lifetimeViews[1]!, ['agent', 'role']),
    ]
    : [...periods, ...lifetimeViews].flatMap((base) => slices(base, [...all]));
  analysis.push({ feature: 'synergy' }, ...acts.map((act): AnalysisQuery => ({ feature: 'synergy', act })));
  if (tier === 'extended') analysis.push(...maps.map((map): AnalysisQuery => ({ feature: 'synergy', map })));
  analysis.push(...players.map((player): AnalysisQuery => ({ feature: 'improvementIndex', player })));

  const scopes: Pick<WeaponQuery, 'scope' | 'act'>[] = [{ scope: 'all' }, { scope: 'current' }, ...acts.map((act) => ({ scope: 'act' as const, act }))];
  const weaponBase = (player: string, scope: Pick<WeaponQuery, 'scope' | 'act'>): WeaponQuery => ({ player, ...scope, map: 'all', agent: 'all', mode: 'Competitive' });
  const weapons: WeaponQuery[] = players.flatMap((player) => scopes.flatMap((scope) => [
    weaponBase(player, scope),
    ...(tier === 'extended' ? [...maps.map((map) => ({ ...weaponBase(player, scope), map })), ...agents.map((agent) => ({ ...weaponBase(player, scope), agent }))] : []),
  ]));
  return { analysis: unique(analysis, staticAnalysisKey), weapons: unique(weapons, staticWeaponKey) };
}
