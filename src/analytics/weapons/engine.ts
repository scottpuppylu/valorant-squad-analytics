import { normalizeSeasonKey } from '../scope/season.js';
import { catalogEntry, firearmCategories, normalizeWeaponName, shortHash, usableWeaponId, WEAPON_CATALOG_VERSION, type WeaponCategory } from './catalog.js';

/**
 * weapon-analytics-v1 (TASK-WEAPON-01). Descriptive, MEMBER-level weapon evidence analytics.
 * Two separate evidence domains, never merged:
 *  - ROUND WEAPON OBSERVATION: round_participants.weapon_* — the weapon the provider associates
 *    with the player for that round (economy snapshot). "觀測武器回合", not every weapon touched.
 *  - KILL WEAPON: kill_events.weapon_* — the weapon/method recorded for that kill. "武器擊殺".
 * No per-weapon HS%, ADR, damage, accuracy or attack/defense split (no exact durable evidence).
 * Shared by the server (SQL aggregate rows) and the Demo (fact rows) so both produce one contract.
 * Server-safe module.
 */
/**
 * v2 (TASK-DATA-MODE-POLICY-01): POPULATION contract only — ALL / ACT / CURRENT weapon evidence is
 * Competitive only (mode-eligibility-policy-v1). Every formula, threshold and the catalog are unchanged.
 */
export const WEAPON_ANALYTICS_VERSION = 'weapon-analytics-v2' as const;

export type WeaponScopeMode = 'all' | 'current' | 'act';
export type WeaponDimension = 'total' | 'map' | 'agent' | 'act' | 'account';
export type EvidenceState = 'available' | 'partial' | 'unavailable';

/** Product-design calibration (weapon-analytics-v1), not population percentiles. */
export const weaponCalibration = {
  /** "最常使用" needs this many observed rounds of the weapon and of the member. */
  usageLabelMinWeaponRounds: 20,
  usageLabelMinMemberRounds: 50,
  /** "最多擊殺" needs this many kills with the weapon and weapon-labeled kills overall. */
  killLabelMinWeaponKills: 10,
  killLabelMinMemberKills: 30,
  /** A map/agent/Act breakdown row is only "available" with this many played rounds. */
  breakdownMinPlayedRounds: 24,
  /** A weapon row is "available" (not small-sample partial) with this many rounds or kills. */
  weaponMinRounds: 10,
  weaponMinKills: 5,
  /** Coverage at/above this is "available"; any lower positive coverage is "partial". */
  fullCoverage: 0.9,
} as const;

/** Durable round-level aggregate for one member and one dimension value. */
export interface RoundAggRow { memberId: string; dim: WeaponDimension; dimValue: string; playedRounds: number; weaponObservedRounds: number; loadoutObservedRounds: number; matches: number; firstAt?: string; lastAt?: string }
/** Observed round-weapon aggregate (raw provider weapon id/name). */
export interface WeaponRoundAggRow { memberId: string; dim: WeaponDimension; dimValue: string; weaponId: string | null; weaponName: string | null; rounds: number; matches: number; wins: number; losses: number; scoreSum: number; scoreRounds: number; loadoutSum: number; loadoutRounds: number }
/** Kill-event aggregate; weaponId and weaponName both null = kill without a weapon label. */
export interface KillAggRow { memberId: string; dim: WeaponDimension; dimValue: string; weaponId: string | null; weaponName: string | null; kills: number; matches: number }
export interface WeaponAggregates { rounds: RoundAggRow[]; weaponRounds: WeaponRoundAggRow[]; kills: KillAggRow[] }

/** Fine-grained facts (Demo, tests): one row per member-match participation. */
export interface WeaponMatchFact {
  memberId: string; accountId: string; matchId: string; map: string; agent: string; act?: string; startedAt: string;
  rounds: { won: boolean | null; weaponStatus: 'observed' | 'missing' | 'unavailable'; weaponId?: string | null; weaponName?: string | null;
    loadoutStatus: 'observed' | 'missing' | 'unavailable'; loadoutValue?: number | null; statsStatus: 'observed' | 'missing' | 'unavailable'; score?: number | null }[];
  kills: { weaponId?: string | null; weaponName?: string | null }[];
}

const dims: Exclude<WeaponDimension, 'total'>[] = ['map', 'agent', 'act', 'account'];

/**
 * Raw evidence grouping shared with the server SQL: one group per usable provider weapon id, else per
 * normalized name; the representative name is the smallest non-null name (code-point order, SQL
 * `COLLATE "C"`). Unlabeled (no usable id and no name) → undefined.
 */
export function rawWeaponGroup(id: string | null | undefined, name: string | null | undefined): string | undefined {
  const usable = usableWeaponId(id);
  if (usable) return `id:${usable}`;
  const normalized = normalizeWeaponName(name);
  return normalized ? `name:${normalized}` : undefined;
}
const minName = (a: string | null, b: string | null | undefined) => (b ? (a === null || b < a ? b : a) : a);
const dimValue = (fact: WeaponMatchFact, dim: WeaponDimension) => dim === 'total' ? '' : dim === 'map' ? fact.map : dim === 'agent' ? fact.agent : dim === 'act' ? (fact.act ?? 'unknown') : fact.accountId;

/** Facts → the same aggregate rows the server SQL produces (GROUPING SETS total/map/agent/act/account). */
export function aggregateWeaponFacts(facts: WeaponMatchFact[]): WeaponAggregates {
  const rounds = new Map<string, RoundAggRow & { matchSet: Set<string> }>();
  const weapons = new Map<string, WeaponRoundAggRow & { matchSet: Set<string> }>();
  const kills = new Map<string, KillAggRow & { matchSet: Set<string> }>();
  for (const fact of facts) {
    for (const dim of ['total', ...dims] as WeaponDimension[]) {
      const value = dimValue(fact, dim);
      const roundKey = JSON.stringify([fact.memberId, dim, value]);
      const round = rounds.get(roundKey) ?? { memberId: fact.memberId, dim, dimValue: value, playedRounds: 0, weaponObservedRounds: 0, loadoutObservedRounds: 0, matches: 0, matchSet: new Set() };
      for (const r of fact.rounds) {
        round.playedRounds += 1;
        const rawGroup = r.weaponStatus === 'observed' ? rawWeaponGroup(r.weaponId, r.weaponName) : undefined;
        if (rawGroup) {
          round.weaponObservedRounds += 1;
          const key = JSON.stringify([fact.memberId, dim, value, rawGroup]);
          const row = weapons.get(key) ?? { memberId: fact.memberId, dim, dimValue: value, weaponId: usableWeaponId(r.weaponId) ?? null, weaponName: null, rounds: 0, matches: 0, wins: 0, losses: 0, scoreSum: 0, scoreRounds: 0, loadoutSum: 0, loadoutRounds: 0, matchSet: new Set() };
          row.weaponName = minName(row.weaponName, r.weaponName);
          row.rounds += 1;
          row.matchSet.add(fact.matchId);
          if (r.won === true) row.wins += 1;
          if (r.won === false) row.losses += 1;
          if (r.statsStatus === 'observed' && typeof r.score === 'number') { row.scoreSum += r.score; row.scoreRounds += 1; }
          if (r.loadoutStatus === 'observed' && typeof r.loadoutValue === 'number') { row.loadoutSum += r.loadoutValue; row.loadoutRounds += 1; }
          weapons.set(key, row);
        }
        if (r.loadoutStatus === 'observed' && typeof r.loadoutValue === 'number') round.loadoutObservedRounds += 1;
      }
      if (fact.rounds.length > 0) {
        round.matchSet.add(fact.matchId);
        round.firstAt = !round.firstAt || fact.startedAt < round.firstAt ? fact.startedAt : round.firstAt;
        round.lastAt = !round.lastAt || fact.startedAt > round.lastAt ? fact.startedAt : round.lastAt;
      }
      rounds.set(roundKey, round);
      for (const k of fact.kills) {
        const rawGroup = rawWeaponGroup(k.weaponId, k.weaponName) ?? 'none';
        const key = JSON.stringify([fact.memberId, dim, value, rawGroup]);
        const row = kills.get(key) ?? { memberId: fact.memberId, dim, dimValue: value, weaponId: rawGroup === 'none' ? null : usableWeaponId(k.weaponId) ?? null, weaponName: null, kills: 0, matches: 0, matchSet: new Set() };
        if (rawGroup !== 'none') row.weaponName = minName(row.weaponName, k.weaponName);
        row.kills += 1;
        row.matchSet.add(fact.matchId);
        kills.set(key, row);
      }
    }
  }
  const strip = <T extends { matchSet: Set<string>; matches: number }>(row: T) => { const { matchSet, ...rest } = row; return { ...rest, matches: matchSet.size }; };
  return {
    rounds: [...rounds.values()].filter((row) => row.playedRounds > 0).map(strip),
    weaponRounds: [...weapons.values()].map(strip),
    kills: [...kills.values()].map(strip),
  };
}

export interface WeaponIdentity { weaponKey: string; weaponName: string; category: WeaponCategory; isFirearm: boolean; known: boolean }

/**
 * Canonical weapon identity for every raw (id, name) pair in a response. Group by usable provider id;
 * a name-only pair joins the single id group carrying that name, otherwise it is its own name group.
 * Public key = catalog slug when unique, else an opaque hash (provider ids are never echoed).
 */
export function canonicalWeapons(pairs: { weaponId: string | null; weaponName: string | null; weight: number }[]): (id: string | null, name: string | null) => WeaponIdentity | undefined {
  const namesById = new Map<string, Map<string, number>>();
  for (const pair of pairs) {
    const id = usableWeaponId(pair.weaponId);
    const name = normalizeWeaponName(pair.weaponName);
    if (!id) continue;
    const names = namesById.get(id) ?? new Map<string, number>();
    if (name) names.set(name, (names.get(name) ?? 0) + pair.weight);
    namesById.set(id, names);
  }
  const displayById = new Map<string, string | undefined>();
  for (const [id, names] of namesById) displayById.set(id, [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]);
  const idsByName = new Map<string, string[]>();
  for (const [id, name] of displayById) if (name) idsByName.set(name, [...(idsByName.get(name) ?? []), id]);
  const groupOf = (id: string | null, name: string | null): string | undefined => {
    const usable = usableWeaponId(id);
    if (usable) return `id:${usable}`;
    const normalized = normalizeWeaponName(name);
    if (!normalized) return undefined;
    const ids = idsByName.get(normalized);
    return ids && ids.length === 1 ? `id:${ids[0]}` : `name:${normalized}`;
  };
  const groups = new Set(pairs.map((pair) => groupOf(pair.weaponId, pair.weaponName)).filter((group): group is string => Boolean(group)));
  const slugCount = new Map<string, number>();
  const nameOf = (group: string) => (group.startsWith('id:') ? displayById.get(group.slice(3)) : group.slice(5));
  for (const group of groups) { const entry = catalogEntry(nameOf(group)); if (entry) slugCount.set(entry.slug, (slugCount.get(entry.slug) ?? 0) + 1); }
  const identities = new Map<string, WeaponIdentity>();
  for (const group of groups) {
    const rawName = nameOf(group);
    const entry = catalogEntry(rawName);
    const category: WeaponCategory = entry?.category ?? 'Other';
    identities.set(group, {
      weaponKey: entry && slugCount.get(entry.slug) === 1 ? entry.slug : `x-${shortHash(group)}`,
      weaponName: entry?.name ?? (rawName ? originalCase(pairs, rawName) : '未知武器'),
      category, isFirearm: firearmCategories.has(category), known: Boolean(entry),
    });
  }
  return (id, name) => { const group = groupOf(id, name); return group ? identities.get(group) : undefined; };
}

function originalCase(pairs: { weaponName: string | null }[], normalized: string): string {
  return pairs.find((pair) => normalizeWeaponName(pair.weaponName) === normalized)?.weaponName?.trim() ?? normalized;
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : undefined);
function coverageState(observed: number, eligible: number): EvidenceState {
  if (eligible <= 0 || observed <= 0) return 'unavailable';
  return observed / eligible >= weaponCalibration.fullCoverage ? 'available' : 'partial';
}

export interface WeaponCoverage {
  roundWeapon: { observed: number; eligible: number; coverage?: number; status: EvidenceState };
  killWeapon: { weaponLabeledKills: number; eligibleKillEvents: number; coverage?: number; status: EvidenceState };
  loadout: { observed: number; eligible: number; coverage?: number; status: EvidenceState };
  lifetimeComplete: false;
}

export interface WeaponMetrics {
  weaponKey: string; weaponName: string; category: WeaponCategory; isFirearm: boolean;
  observedWeaponRounds: number; observedWeaponRoundShare?: number; matchesWithWeaponObservation: number;
  roundWinsWhenWeaponObserved: number; roundLossesWhenWeaponObserved: number; roundWinRateWhenObserved?: number;
  avgRoundScoreWhenObserved?: number; avgLoadoutValueWhenObserved?: number;
  weaponKills: number; weaponKillShare?: number; matchesWithWeaponKill: number; weaponKillsPer100PlayedRounds?: number;
  status: EvidenceState; reasons: string[];
}

export interface WeaponGroupResult { playedRounds: number; matches: number; coverage: WeaponCoverage; weapons: WeaponMetrics[] }
export interface WeaponBreakdownRow extends WeaponGroupResult { value: string; status: EvidenceState }
export interface MemberWeaponSummary extends WeaponGroupResult { memberId: string; mostUsed?: string; mostKills?: string; firstAt?: string; lastAt?: string }

export const unsupportedWeaponMetrics = {
  weaponHeadshotPercentage: { status: 'unavailable', reason: 'kill_events 沒有逐擊殺的命中部位；比賽層級爆頭數不能分配到武器。' },
  weaponADR: { status: 'unavailable', reason: '沒有逐武器傷害證據；比賽層級傷害不能分配到武器。' },
  weaponDamage: { status: 'unavailable', reason: '沒有逐武器傷害證據。' },
  weaponAccuracy: { status: 'unavailable', reason: '沒有開槍數／命中數證據。' },
  attackDefenseSplit: { status: 'unavailable', reason: '沒有持久化的攻守方證據；不以回合序號或下包推測。' },
  weaponKillsPerObservedWeaponRound: { status: 'unavailable', reason: '回合武器（經濟快照）與擊殺武器時間語意不同，不發布跨領域效率。' },
} as const;

/** Builds the metrics for one (member, dimension, value) group from aggregate rows. */
function group(aggregates: WeaponAggregates, identify: ReturnType<typeof canonicalWeapons>, memberId: string, dim: WeaponDimension, value: string): WeaponGroupResult {
  const round = aggregates.rounds.find((row) => row.memberId === memberId && row.dim === dim && row.dimValue === value);
  const playedRounds = round?.playedRounds ?? 0;
  const byKey = new Map<string, WeaponMetrics & { scoreSum: number; scoreRounds: number; loadoutSum: number; loadoutRounds: number }>();
  const blank = (identity: WeaponIdentity) => ({ ...identity, known: undefined, observedWeaponRounds: 0, matchesWithWeaponObservation: 0, roundWinsWhenWeaponObserved: 0,
    roundLossesWhenWeaponObserved: 0, weaponKills: 0, matchesWithWeaponKill: 0, status: 'unavailable' as EvidenceState, reasons: [] as string[], scoreSum: 0, scoreRounds: 0, loadoutSum: 0, loadoutRounds: 0 });
  let observedRounds = 0;
  for (const row of aggregates.weaponRounds) {
    if (row.memberId !== memberId || row.dim !== dim || row.dimValue !== value) continue;
    const identity = identify(row.weaponId, row.weaponName);
    if (!identity) continue;
    const metrics = byKey.get(identity.weaponKey) ?? blank(identity);
    metrics.observedWeaponRounds += row.rounds;
    // Distinct matches cannot be summed across raw pairs of one canonical weapon exactly; take the max
    // (raw pairs of one weapon are the same id/name in practice, so this equals the distinct count).
    metrics.matchesWithWeaponObservation = Math.max(metrics.matchesWithWeaponObservation, row.matches);
    metrics.roundWinsWhenWeaponObserved += row.wins;
    metrics.roundLossesWhenWeaponObserved += row.losses;
    metrics.scoreSum += row.scoreSum; metrics.scoreRounds += row.scoreRounds;
    metrics.loadoutSum += row.loadoutSum; metrics.loadoutRounds += row.loadoutRounds;
    observedRounds += row.rounds;
    byKey.set(identity.weaponKey, metrics);
  }
  let labeledKills = 0;
  let eligibleKills = 0;
  for (const row of aggregates.kills) {
    if (row.memberId !== memberId || row.dim !== dim || row.dimValue !== value) continue;
    eligibleKills += row.kills;
    const identity = identify(row.weaponId, row.weaponName);
    if (!identity) continue;
    labeledKills += row.kills;
    const metrics = byKey.get(identity.weaponKey) ?? blank(identity);
    metrics.weaponKills += row.kills;
    metrics.matchesWithWeaponKill = Math.max(metrics.matchesWithWeaponKill, row.matches);
    byKey.set(identity.weaponKey, metrics);
  }
  const coverage: WeaponCoverage = {
    roundWeapon: { observed: round?.weaponObservedRounds ?? 0, eligible: playedRounds, coverage: ratio(round?.weaponObservedRounds ?? 0, playedRounds), status: coverageState(round?.weaponObservedRounds ?? 0, playedRounds) },
    killWeapon: { weaponLabeledKills: labeledKills, eligibleKillEvents: eligibleKills, coverage: ratio(labeledKills, eligibleKills), status: coverageState(labeledKills, eligibleKills) },
    loadout: { observed: round?.loadoutObservedRounds ?? 0, eligible: playedRounds, coverage: ratio(round?.loadoutObservedRounds ?? 0, playedRounds), status: coverageState(round?.loadoutObservedRounds ?? 0, playedRounds) },
    lifetimeComplete: false,
  };
  const weapons = [...byKey.values()].map(({ scoreSum, scoreRounds, loadoutSum, loadoutRounds, ...metrics }): WeaponMetrics => {
    const decided = metrics.roundWinsWhenWeaponObserved + metrics.roundLossesWhenWeaponObserved;
    const reasons: string[] = [];
    const enough = metrics.observedWeaponRounds >= weaponCalibration.weaponMinRounds || metrics.weaponKills >= weaponCalibration.weaponMinKills;
    if (!enough) reasons.push('small_sample');
    if (coverage.roundWeapon.status === 'partial') reasons.push('round_weapon_evidence_partial');
    if (coverage.killWeapon.status === 'partial') reasons.push('kill_weapon_evidence_partial');
    const { known: _known, ...rest } = metrics as WeaponMetrics & { known?: boolean };
    void _known;
    return {
      ...rest,
      ...(ratio(metrics.observedWeaponRounds, observedRounds) === undefined ? {} : { observedWeaponRoundShare: ratio(metrics.observedWeaponRounds, observedRounds) }),
      ...(ratio(metrics.roundWinsWhenWeaponObserved, decided) === undefined ? {} : { roundWinRateWhenObserved: ratio(metrics.roundWinsWhenWeaponObserved, decided) }),
      ...(scoreRounds > 0 ? { avgRoundScoreWhenObserved: scoreSum / scoreRounds } : {}),
      ...(loadoutRounds > 0 ? { avgLoadoutValueWhenObserved: loadoutSum / loadoutRounds } : {}),
      ...(ratio(metrics.weaponKills, labeledKills) === undefined ? {} : { weaponKillShare: ratio(metrics.weaponKills, labeledKills) }),
      ...(playedRounds > 0 ? { weaponKillsPer100PlayedRounds: (metrics.weaponKills / playedRounds) * 100 } : {}),
      status: !enough || reasons.length > 0 ? 'partial' : 'available',
      reasons,
    };
  }).sort((a, b) => b.observedWeaponRounds - a.observedWeaponRounds || b.weaponKills - a.weaponKills || a.weaponName.localeCompare(b.weaponName));
  return { playedRounds, matches: round?.matches ?? 0, coverage, weapons };
}

function labels(result: WeaponGroupResult): { mostUsed?: string; mostKills?: string } {
  const c = weaponCalibration;
  const used = result.coverage.roundWeapon.observed >= c.usageLabelMinMemberRounds
    ? result.weapons.filter((w) => w.observedWeaponRounds >= c.usageLabelMinWeaponRounds).sort((a, b) => b.observedWeaponRounds - a.observedWeaponRounds || a.weaponKey.localeCompare(b.weaponKey))[0] : undefined;
  const kills = result.coverage.killWeapon.weaponLabeledKills >= c.killLabelMinMemberKills
    ? result.weapons.filter((w) => w.weaponKills >= c.killLabelMinWeaponKills).sort((a, b) => b.weaponKills - a.weaponKills || a.weaponKey.localeCompare(b.weaponKey))[0] : undefined;
  return { ...(used ? { mostUsed: used.weaponKey } : {}), ...(kills ? { mostKills: kills.weaponKey } : {}) };
}

export interface WeaponScope { mode: WeaponScopeMode; status: EvidenceState; reasons: string[]; act?: string; context: { map: string; agent: string; mode: string } }

export interface WeaponAnalyticsResult {
  weaponAnalyticsVersion: typeof WEAPON_ANALYTICS_VERSION;
  weaponCatalogVersion: typeof WEAPON_CATALOG_VERSION;
  scope: WeaponScope;
  /** Every visible member (cohort comparison). Totals only. */
  members: MemberWeaponSummary[];
  /** Detailed result for the requested member, when one was requested. */
  member?: MemberWeaponSummary & { breakdowns: { maps: WeaponBreakdownRow[]; agents: WeaponBreakdownRow[]; acts: WeaponBreakdownRow[] }; accounts: { accountId: string; playedRounds: number; weaponObservedRounds: number; weaponLabeledKills: number }[] };
  unsupported: typeof unsupportedWeaponMetrics;
  calibration: typeof weaponCalibration;
}

/** Aggregates (server SQL or Demo facts) → the public weapon-analytics-v1 result. */
export function buildWeaponAnalytics(input: WeaponAggregates, options: { memberIds: string[]; memberId?: string; scope: WeaponScope }): WeaponAnalyticsResult {
  // Act dimension values are normalized public season keys; raw unknown/invalid → 'unknown'.
  const actKey = (value: string) => normalizeSeasonKey(value) ?? 'unknown';
  const aggregates: WeaponAggregates = {
    rounds: mergeActRounds(input.rounds.map((row) => (row.dim === 'act' ? { ...row, dimValue: actKey(row.dimValue) } : row))),
    weaponRounds: input.weaponRounds.map((row) => (row.dim === 'act' ? { ...row, dimValue: actKey(row.dimValue) } : row)),
    kills: input.kills.map((row) => (row.dim === 'act' ? { ...row, dimValue: actKey(row.dimValue) } : row)),
  };
  const identify = canonicalWeapons([
    ...aggregates.weaponRounds.filter((row) => row.dim === 'total').map((row) => ({ weaponId: row.weaponId, weaponName: row.weaponName, weight: row.rounds })),
    ...aggregates.kills.filter((row) => row.dim === 'total').map((row) => ({ weaponId: row.weaponId, weaponName: row.weaponName, weight: row.kills })),
  ]);
  const summary = (memberId: string): MemberWeaponSummary => {
    const result = group(aggregates, identify, memberId, 'total', '');
    const round = aggregates.rounds.find((row) => row.memberId === memberId && row.dim === 'total');
    return { memberId, ...result, ...labels(result), ...(round?.firstAt ? { firstAt: round.firstAt } : {}), ...(round?.lastAt ? { lastAt: round.lastAt } : {}) };
  };
  const members = options.memberIds.map(summary);
  const breakdown = (memberId: string, dim: 'map' | 'agent' | 'act'): WeaponBreakdownRow[] => {
    const values = [...new Set(aggregates.rounds.filter((row) => row.memberId === memberId && row.dim === dim).map((row) => row.dimValue))].sort();
    return values.map((value) => {
      const result = group(aggregates, identify, memberId, dim, value);
      const status: EvidenceState = result.playedRounds >= weaponCalibration.breakdownMinPlayedRounds && result.coverage.roundWeapon.status !== 'unavailable' ? 'available' : 'partial';
      return { value, ...result, status };
    }).sort((a, b) => b.playedRounds - a.playedRounds || a.value.localeCompare(b.value));
  };
  const member = options.memberId ? members.find((item) => item.memberId === options.memberId) : undefined;
  return {
    weaponAnalyticsVersion: WEAPON_ANALYTICS_VERSION,
    weaponCatalogVersion: WEAPON_CATALOG_VERSION,
    scope: options.scope,
    members,
    ...(options.memberId ? { member: {
      ...(member ?? summary(options.memberId)),
      breakdowns: { maps: breakdown(options.memberId, 'map'), agents: breakdown(options.memberId, 'agent'), acts: breakdown(options.memberId, 'act') },
      accounts: aggregates.rounds.filter((row) => row.memberId === options.memberId && row.dim === 'account').map((row) => ({
        accountId: row.dimValue, playedRounds: row.playedRounds, weaponObservedRounds: row.weaponObservedRounds,
        weaponLabeledKills: aggregates.kills.filter((k) => k.memberId === options.memberId && k.dim === 'account' && k.dimValue === row.dimValue && identify(k.weaponId, k.weaponName)).reduce((sum, k) => sum + k.kills, 0),
      })).sort((a, b) => b.playedRounds - a.playedRounds || a.accountId.localeCompare(b.accountId)),
    } } : {}),
    unsupported: unsupportedWeaponMetrics,
    calibration: weaponCalibration,
  };
}

/** Raw season values that normalize to one key are disjoint matches, so their counts add up. */
function mergeActRounds(rows: RoundAggRow[]): RoundAggRow[] {
  const merged = new Map<string, RoundAggRow>();
  for (const row of rows) {
    const key = JSON.stringify([row.memberId, row.dim, row.dimValue]);
    const existing = merged.get(key);
    if (!existing) { merged.set(key, { ...row }); continue; }
    existing.playedRounds += row.playedRounds; existing.weaponObservedRounds += row.weaponObservedRounds;
    existing.loadoutObservedRounds += row.loadoutObservedRounds; existing.matches += row.matches;
    if (row.firstAt && (!existing.firstAt || row.firstAt < existing.firstAt)) existing.firstAt = row.firstAt;
    if (row.lastAt && (!existing.lastAt || row.lastAt > existing.lastAt)) existing.lastAt = row.lastAt;
  }
  return [...merged.values()];
}
