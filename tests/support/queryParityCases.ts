import type { AnalysisQuery } from '../../src/dataSources/server/analysisResult';
import type { StaticWeaponQuery } from '../../src/dataSources/static/contract';

/**
 * TASK-INFRA-STATIC-QUERY-PARITY-01 deterministic query cases for the static-vs-server parity oracle.
 * Coverage: every single filter value, greedy ALL-PAIRS over (period × player × map × agent × role × mode ×
 * form), representative 3-way combinations, custom-date boundaries (full, one day, from-only, to-only, empty,
 * reversed), Synergy contexts, the improvement index per member and weapon combinations.
 */
export interface ParityFacts { players: string[]; maps: string[]; agents: string[]; modes: string[]; acts: string[]; earliest: string; latest: string; oneDay: string; middle: string }

const roles = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

/** Greedy all-pairs: every value pair of every two dimensions appears in at least one row (deterministic). */
export function allPairs<T>(dimensions: T[][]): T[][] {
  const uncovered = new Set<string>();
  for (let a = 0; a < dimensions.length; a += 1) for (let b = a + 1; b < dimensions.length; b += 1)
    for (let i = 0; i < dimensions[a]!.length; i += 1) for (let j = 0; j < dimensions[b]!.length; j += 1) uncovered.add(`${a}:${i}|${b}:${j}`);
  const rows: number[][] = [];
  while (uncovered.size > 0) {
    const row: number[] = [];
    for (let d = 0; d < dimensions.length; d += 1) {
      let best = 0; let bestGain = -1;
      for (let v = 0; v < dimensions[d]!.length; v += 1) {
        let gain = 0;
        for (let e = 0; e < d; e += 1) if (uncovered.has(`${e}:${row[e]}|${d}:${v}`)) gain += 1;
        // Look ahead: pairs with later dimensions that this value can still cover.
        for (let e = d + 1; e < dimensions.length; e += 1) for (let w = 0; w < dimensions[e]!.length; w += 1) if (uncovered.has(`${d}:${v}|${e}:${w}`)) { gain += 0.001; break; }
        if (gain > bestGain) { best = v; bestGain = gain; }
      }
      row.push(best);
    }
    let removed = 0;
    for (let a = 0; a < row.length; a += 1) for (let b = a + 1; b < row.length; b += 1) if (uncovered.delete(`${a}:${row[a]}|${b}:${row[b]}`)) removed += 1;
    if (removed === 0) {
      // Force progress on the first uncovered pair.
      const [first] = uncovered;
      const [[a, i], [b, j]] = first!.split('|').map((part) => part.split(':').map(Number)) as [[number, number], [number, number]];
      row[a] = i; row[b] = j;
      uncovered.delete(first!);
    }
    rows.push(row);
  }
  return rows.map((row) => row.map((value, d) => dimensions[d]![value]!));
}

const dayAfter = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

export function analysisParityCases(f: ParityFacts, level: 'ci' | 'full'): AnalysisQuery[] {
  const day = (iso: string) => iso.slice(0, 10);
  const ranges: { from?: string; to?: string }[] = [
    { from: day(f.earliest), to: day(f.latest) }, { from: day(f.oneDay), to: day(f.oneDay) }, { from: day(f.middle) }, { to: day(f.middle) },
    { from: dayAfter(f.latest, 30), to: dayAfter(f.latest, 60) }, { from: day(f.latest), to: day(f.earliest) },
  ];
  const periods: AnalysisQuery[] = [
    { feature: 'currentStrength' }, { feature: 'lifetimeTotals' }, { feature: 'mapStats' }, { feature: 'agentStats' },
    { feature: 'fixedRecent', recent: 10 }, { feature: 'fixedRecent', recent: 30 },
    ...f.acts.map((act): AnalysisQuery => ({ feature: 'actOverview', act })),
    ...ranges.flatMap((range) => (['lifetimeTotals', 'mapStats', 'agentStats'] as const).map((feature): AnalysisQuery => ({ feature, ...range }))),
  ];
  const agents = level === 'full' ? f.agents : f.agents.slice(0, 4);
  const dims = {
    player: ['all', ...f.players], map: ['all', ...f.maps], agent: ['all', ...agents], role: ['all', ...roles], mode: ['all', ...f.modes],
  };
  const cases: AnalysisQuery[] = [];
  const add = (base: AnalysisQuery, context: Partial<Record<keyof typeof dims, string>>, form: boolean) => {
    const query: AnalysisQuery = { ...base };
    for (const [key, value] of Object.entries(context)) if (value && value !== 'all') (query as unknown as Record<string, unknown>)[key] = value;
    if (form) query.form = true;
    cases.push(query);
  };
  // Singles: every value of every dimension, for every period (ci: the two default periods + one range).
  const singlePeriods = level === 'full' ? periods : [periods[0]!, periods[1]!, periods.find((p) => p.from && p.to && p.from === p.to)!];
  for (const base of singlePeriods) for (const [key, values] of Object.entries(dims)) for (const value of values.slice(1)) add(base, { [key]: value }, false);
  // All pairs over every dimension (period included) with form on/off.
  const periodIndex = periods.map((_, i) => String(i));
  for (const [p, player, map, agent, role, mode, form] of allPairs([periodIndex, dims.player, dims.map, dims.agent, dims.role, dims.mode, ['0', '1']])) {
    add(periods[Number(p)]!, { player, map, agent, role, mode }, form === '1');
  }
  // Representative 3-way combinations on the default and lifetime populations.
  for (const base of [periods[0]!, periods[1]!, periods[4]!]) {
    add(base, { player: f.players[0], map: f.maps[0], agent: f.agents[0] }, true);
    add(base, { map: f.maps[1] ?? f.maps[0], role: 'Duelist', mode: f.modes[0] }, false);
    add(base, { player: f.players[1] ?? f.players[0], agent: f.agents[1] ?? f.agents[0], mode: 'Competitive' }, true);
  }
  // Synergy contexts (map × mode × Act/date) and the improvement index per member.
  const synergyMaps = ['all', ...f.maps.slice(0, level === 'full' ? undefined : 2)];
  const synergyModes = ['all', 'Competitive', ...(f.modes.includes('Unrated') ? ['Unrated'] : [])];
  const synergyScopes: { act?: string; from?: string; to?: string }[] = [{}, ...f.acts.map((act) => ({ act })), ...ranges.slice(0, level === 'full' ? undefined : 3)];
  for (const [map, mode, scope] of allPairs<string | { act?: string; from?: string; to?: string }>([synergyMaps, synergyModes, synergyScopes])) {
    const query: AnalysisQuery = { feature: 'synergy', ...(scope as object) };
    if (map !== 'all') query.map = map as string;
    if (mode !== 'all') query.mode = mode as string;
    cases.push(query);
  }
  for (const player of f.players) cases.push({ feature: 'improvementIndex', player });
  return cases;
}

export function weaponParityCases(f: ParityFacts, level: 'ci' | 'full'): StaticWeaponQuery[] {
  const scopes: Pick<StaticWeaponQuery, 'scope' | 'act'>[] = [{ scope: 'all' }, { scope: 'current' }, ...f.acts.map((act) => ({ scope: 'act' as const, act })), { scope: 'act', act: 'e1a1' }];
  const maps = ['all', ...f.maps.slice(0, level === 'full' ? undefined : 3)];
  const agents = ['all', ...f.agents.slice(0, level === 'full' ? undefined : 3)];
  const modes = ['Competitive', 'all', 'Unrated'];
  const players = ['all', ...f.players];
  const out: StaticWeaponQuery[] = [];
  for (const [player, scope, map, agent, mode] of allPairs<string | Pick<StaticWeaponQuery, 'scope' | 'act'>>([players, scopes, maps, agents, modes])) {
    out.push({ player: player as string, ...(scope as Pick<StaticWeaponQuery, 'scope' | 'act'>), map: map as string, agent: agent as string, mode: mode as string });
  }
  return out;
}
