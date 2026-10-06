/**
 * weapon-catalog-v2 — classifies/canonicalizes OBSERVED weapon evidence only.
 * v2 (TASK-WEAPON-01.1): adds Warden as a Rifle (Riot VALORANT Patch Notes 13.06, Weapon Class: Rifle).
 * Classification only; weapon-analytics-v1 formulas are unchanged. A catalog entry never
 * manufactures evidence; unknown provider ids/names stay explicit as Other / Unknown.
 * Server-safe module (`.js`-free, no browser APIs).
 */
export const WEAPON_CATALOG_VERSION = 'weapon-catalog-v2' as const;

export type WeaponCategory = 'Sidearm' | 'SMG' | 'Shotgun' | 'Rifle' | 'Sniper' | 'MachineGun' | 'Melee' | 'Other';

export const weaponCategoryLabels: Record<WeaponCategory, string> = {
  Sidearm: '手槍', SMG: '衝鋒槍', Shotgun: '霰彈槍', Rifle: '步槍', Sniper: '狙擊槍', MachineGun: '機槍', Melee: '近戰', Other: '其他／未知方式',
};

interface CatalogEntry { slug: string; name: string; category: WeaponCategory }

/** Standard VALORANT loadout weapons, keyed by normalized display name (provider ids are not hard-coded). */
const entries: CatalogEntry[] = [
  ['classic', 'Classic', 'Sidearm'], ['shorty', 'Shorty', 'Sidearm'], ['frenzy', 'Frenzy', 'Sidearm'], ['ghost', 'Ghost', 'Sidearm'],
  ['sheriff', 'Sheriff', 'Sidearm'], ['bandit', 'Bandit', 'Sidearm'],
  ['stinger', 'Stinger', 'SMG'], ['spectre', 'Spectre', 'SMG'],
  ['bucky', 'Bucky', 'Shotgun'], ['judge', 'Judge', 'Shotgun'],
  ['bulldog', 'Bulldog', 'Rifle'], ['guardian', 'Guardian', 'Rifle'], ['phantom', 'Phantom', 'Rifle'], ['vandal', 'Vandal', 'Rifle'],
  ['warden', 'Warden', 'Rifle'],
  ['marshal', 'Marshal', 'Sniper'], ['outlaw', 'Outlaw', 'Sniper'], ['operator', 'Operator', 'Sniper'],
  ['ares', 'Ares', 'MachineGun'], ['odin', 'Odin', 'MachineGun'],
  ['melee', 'Melee', 'Melee'], ['knife', 'Melee', 'Melee'], ['tactical knife', 'Melee', 'Melee'],
].map(([slug, name, category]) => ({ slug: slug!.replace(/ /gu, '-'), name: name!, category: category as WeaponCategory }));
const byName = new Map(entries.map((entry) => [entry.slug.replace(/-/gu, ' '), entry]));

export const firearmCategories: ReadonlySet<WeaponCategory> = new Set(['Sidearm', 'SMG', 'Shotgun', 'Rifle', 'Sniper', 'MachineGun']);

export function normalizeWeaponName(name: string | null | undefined): string | undefined {
  if (typeof name !== 'string') return undefined;
  const value = name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
  return value.length > 0 && value.length <= 64 ? value : undefined;
}

/** A provider weapon id is usable when it is a short opaque token (game content ids are UUID-like). */
export function usableWeaponId(id: string | null | undefined): string | undefined {
  if (typeof id !== 'string') return undefined;
  const value = id.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value) ? value : undefined;
}

export function catalogEntry(name: string | null | undefined): CatalogEntry | undefined {
  const normalized = normalizeWeaponName(name);
  return normalized ? byName.get(normalized) : undefined;
}

/** Deterministic short hash (FNV-1a 32) so unknown provider ids never appear verbatim publicly. */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}
