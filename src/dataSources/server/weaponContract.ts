import type { WeaponAnalyticsResult } from '../../analytics/weapons/engine';

/** TASK-WEAPON-01 `view=analysis&feature=weaponAnalytics` response (schema 6, weapon-analytics-v2, weapon-catalog-v2). */
export type WeaponAnalyticsResponse = WeaponAnalyticsResult & { ok: true; schemaVersion: 6; view: 'analysis'; feature: 'weaponAnalytics' };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value));
const numericKeys = ['observedWeaponRounds', 'observedWeaponRoundShare', 'matchesWithWeaponObservation', 'roundWinsWhenWeaponObserved', 'roundLossesWhenWeaponObserved',
  'roundWinRateWhenObserved', 'avgRoundScoreWhenObserved', 'avgLoadoutValueWhenObserved', 'weaponKills', 'weaponKillShare', 'matchesWithWeaponKill', 'weaponKillsPer100PlayedRounds'];
const forbidden = new Set(['weaponHeadshotPercentage', 'headshotPercentage', 'adr', 'damage', 'accuracy', 'weaponId']);

function validWeapons(value: unknown): boolean {
  return Array.isArray(value) && value.every((weapon) => isRecord(weapon) && typeof weapon.weaponKey === 'string' && typeof weapon.weaponName === 'string'
    && typeof weapon.category === 'string' && numericKeys.every((key) => finite(weapon[key])) && !Object.keys(weapon).some((key) => forbidden.has(key)));
}
function validGroup(value: unknown): boolean {
  return isRecord(value) && finite(value.playedRounds) && isRecord(value.coverage) && value.coverage.lifetimeComplete === false && validWeapons(value.weapons);
}

/** Rejects other versions, lifetime-completeness claims, unsupported per-weapon metrics and non-finite numbers. */
export function isWeaponAnalyticsResponse(value: unknown): value is WeaponAnalyticsResponse {
  if (!isRecord(value) || value.ok !== true || value.schemaVersion !== 6 || value.view !== 'analysis' || value.feature !== 'weaponAnalytics') return false;
  if (value.weaponAnalyticsVersion !== 'weapon-analytics-v2' || value.weaponCatalogVersion !== 'weapon-catalog-v2') return false;
  if (!isRecord(value.scope) || !['all', 'current', 'act'].includes(String(value.scope.mode))) return false;
  if (!Array.isArray(value.members) || !value.members.every((member) => validGroup(member) && typeof member.memberId === 'string')) return false;
  if (value.member !== undefined) {
    const member = value.member;
    if (!isRecord(member) || !validGroup(member) || !isRecord(member.breakdowns)) return false;
    for (const rows of [member.breakdowns.maps, member.breakdowns.agents, member.breakdowns.acts]) if (!Array.isArray(rows) || !rows.every(validGroup)) return false;
  }
  return isRecord(value.unsupported);
}
