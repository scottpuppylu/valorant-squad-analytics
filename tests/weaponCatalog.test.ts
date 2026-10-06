import { describe, expect, it } from 'vitest';
import { catalogEntry, firearmCategories, WEAPON_CATALOG_VERSION } from '../src/analytics/weapons/catalog';
import { aggregateWeaponFacts, buildWeaponAnalytics, canonicalWeapons, type WeaponMatchFact } from '../src/analytics/weapons/engine';

/**
 * TASK-WEAPON-01.1: Warden is a Rifle (Riot VALORANT Patch Notes 13.06, Weapon Class: Rifle).
 * Classification-only correction (weapon-catalog-v2); weapon-analytics-v1 formulas are unchanged.
 */
const scope = { mode: 'all' as const, status: 'available' as const, reasons: [], context: { map: 'all', agent: 'all', mode: 'Competitive' } };

/** Fictional evidence: rifle/other weapons plus Warden in both evidence domains, id+name and name-only. */
function facts(nameOnlySecondMatch = true): WeaponMatchFact[] {
  const secondId = nameOnlySecondMatch ? null : 'fictional-warden-id';
  const round = (won: boolean, weaponId: string | null, weaponName: string | null, score: number, loadout: number) => ({
    won, weaponStatus: 'observed' as const, weaponId, weaponName, loadoutStatus: 'observed' as const, loadoutValue: loadout, statsStatus: 'observed' as const, score });
  return [
    { memberId: 'm', accountId: 'a1', matchId: 'x1', map: 'Ascent', agent: 'Sova', act: 'e11a5', startedAt: '2026-10-01T00:00:00.000Z',
      rounds: [round(true, 'fictional-warden-id', 'Warden', 300, 4800), round(false, 'fictional-warden-id', 'Warden', 200, 4800), round(true, 'v-id', 'Vandal', 250, 3900), round(true, null, 'Hot Hands', 0, 800)],
      kills: [{ weaponId: 'fictional-warden-id', weaponName: 'Warden' }, { weaponId: 'v-id', weaponName: 'Vandal' }, { weaponId: null, weaponName: 'Blade Storm' }] },
    { memberId: 'm', accountId: 'a2', matchId: 'x2', map: 'Bind', agent: 'Jett', act: 'e11a5', startedAt: '2026-10-02T00:00:00.000Z',
      rounds: [round(false, secondId, ' warden ', 280, 4700), round(true, secondId, 'WARDEN', 150, 4700)],
      kills: [{ weaponId: secondId, weaponName: 'Warden' }, { weaponId: null, weaponName: 'Paint Shells' }] },
  ];
}

describe('weapon-catalog-v2 Warden classification', () => {
  it('classifies Warden as a Rifle firearm through the central catalog', () => {
    expect(WEAPON_CATALOG_VERSION).toBe('weapon-catalog-v2');
    expect(catalogEntry('Warden')).toEqual({ slug: 'warden', name: 'Warden', category: 'Rifle' });
    expect(firearmCategories.has(catalogEntry('Warden')!.category)).toBe(true);
    for (const variant of ['warden', ' WARDEN ', 'Warden']) expect(catalogEntry(variant)?.category).toBe('Rifle');
    // No fuzzy matching.
    for (const near of ['Wardens', 'Warden X', 'Ward en']) expect(catalogEntry(near)).toBeUndefined();
  });

  it('resolves id+name, name-only and case/space variants of Warden to one Rifle weapon', () => {
    const identify = canonicalWeapons([{ weaponId: 'fictional-warden-id', weaponName: 'Warden', weight: 2 }, { weaponId: null, weaponName: ' warden ', weight: 1 }]);
    for (const [id, name] of [['fictional-warden-id', 'Warden'], [null, 'Warden'], [null, 'WARDEN'], ['fictional-warden-id', null]] as const) {
      expect(identify(id, name)).toEqual({ weaponKey: 'warden', weaponName: 'Warden', category: 'Rifle', isFirearm: true, known: true });
    }
    const result = buildWeaponAnalytics(aggregateWeaponFacts(facts()), { memberIds: ['m'], memberId: 'm', scope });
    expect(result.weaponCatalogVersion).toBe('weapon-catalog-v2');
    expect(result.weaponAnalyticsVersion).toBe('weapon-analytics-v1');
    const warden = result.member!.weapons.find((w) => w.weaponName === 'Warden')!;
    expect(warden).toMatchObject({ weaponKey: 'warden', category: 'Rifle', isFirearm: true });
    for (const row of [...result.member!.breakdowns.maps, ...result.member!.breakdowns.agents, ...result.member!.breakdowns.acts]) {
      for (const weapon of row.weapons.filter((w) => w.weaponName === 'Warden')) expect(weapon).toMatchObject({ weaponKey: 'warden', category: 'Rifle', isFirearm: true });
    }
    expect(result.members[0]!.weapons.find((w) => w.weaponName === 'Warden')).toMatchObject({ category: 'Rifle', isFirearm: true });
  });

  it('preserves every Warden numeric metric and total evidence; only classification moves Other → Rifle', () => {
    // ID-bearing evidence in both matches (as production carries provider ids). A weapon seen with an id in
    // some rows and name-only in others keeps the documented v1 distinct-match approximation (unchanged here).
    const result = buildWeaponAnalytics(aggregateWeaponFacts(facts(false)), { memberIds: ['m'], memberId: 'm', scope });
    const member = result.member!;
    const warden = member.weapons.find((w) => w.weaponName === 'Warden')!;
    // Hand-calculated from the facts (identical before and after the catalog change).
    expect(warden).toMatchObject({ observedWeaponRounds: 4, observedWeaponRoundShare: 4 / 6, matchesWithWeaponObservation: 2, roundWinsWhenWeaponObserved: 2,
      roundLossesWhenWeaponObserved: 2, roundWinRateWhenObserved: 0.5, avgRoundScoreWhenObserved: (300 + 200 + 280 + 150) / 4, avgLoadoutValueWhenObserved: (4800 * 2 + 4700 * 2) / 4,
      weaponKills: 2, weaponKillShare: 2 / 5, matchesWithWeaponKill: 2, weaponKillsPer100PlayedRounds: (2 / 6) * 100 });
    const byCategory = (category: string) => member.weapons.filter((w) => w.category === category).reduce((sum, w) => ({ rounds: sum.rounds + w.observedWeaponRounds, kills: sum.kills + w.weaponKills }), { rounds: 0, kills: 0 });
    expect(byCategory('Rifle')).toEqual({ rounds: 4 + 1, kills: 2 + 1 });
    expect(byCategory('Other')).toEqual({ rounds: 1, kills: 2 });
    expect(member.weapons.reduce((sum, w) => sum + w.observedWeaponRounds, 0)).toBe(6);
    expect(member.weapons.reduce((sum, w) => sum + w.weaponKills, 0)).toBe(5);
    expect(member.coverage.roundWeapon).toMatchObject({ observed: 6, eligible: 6 });
  });

  it('leaves every other catalog entry, unknown names and ability kill methods unchanged', () => {
    const expected: [string, string][] = [['Classic', 'Sidearm'], ['Ghost', 'Sidearm'], ['Sheriff', 'Sidearm'], ['Spectre', 'SMG'], ['Judge', 'Shotgun'], ['Phantom', 'Rifle'],
      ['Vandal', 'Rifle'], ['Operator', 'Sniper'], ['Ares', 'MachineGun'], ['Odin', 'MachineGun'], ['Melee', 'Melee'], ['Knife', 'Melee']];
    for (const [name, category] of expected) expect(catalogEntry(name)?.category, name).toBe(category);
    const identify = canonicalWeapons([{ weaponId: null, weaponName: 'Fictional Unreleased Gun', weight: 1 }, { weaponId: null, weaponName: 'Blade Storm', weight: 1 },
      { weaponId: null, weaponName: 'Hot Hands', weight: 1 }, { weaponId: null, weaponName: 'Paint Shells', weight: 1 }]);
    for (const name of ['Fictional Unreleased Gun', 'Blade Storm', 'Hot Hands', 'Paint Shells']) {
      expect(identify(null, name), name).toMatchObject({ category: 'Other', isFirearm: false, known: false });
    }
  });
});
