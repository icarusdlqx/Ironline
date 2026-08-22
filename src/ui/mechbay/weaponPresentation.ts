import type { Faction } from '../../schema/faction';
import type { Catalog } from '../../schema/load';
import type { Weapon } from '../../schema/weapon';

export const WEAPON_CATEGORIES = [
  { id: 'machine-guns', label: 'Machine Guns' },
  { id: 'flamers', label: 'Flamers' },
  { id: 'short-range-missiles', label: 'Short-Range Missiles' },
  { id: 'autocannons', label: 'Autocannons' },
  { id: 'medium-range-missiles', label: 'Medium-Range Missiles' },
  { id: 'lasers', label: 'Lasers' },
  { id: 'particle-weapons', label: 'Particle Weapons' },
  { id: 'railguns', label: 'Railguns' },
  { id: 'long-range-missiles', label: 'Long-Range Missiles' },
] as const;

export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number]['id'];

export interface WeaponMetrics {
  /** Damage delivered per second when the weapon cycles continuously. */
  damage: number;
  /** End of the authored long-range bracket, in metres. */
  reach: number;
  /** Heat added per second when the weapon cycles continuously. */
  heat: number;
}

export interface NormalisedWeaponMetrics {
  damage: number;
  reach: number;
  heat: number;
}

const FACTION_PRESENTATION: Record<Faction, { label: string; className: string }> = {
  linewrought: { label: 'Linewrought', className: 'faction-linewrought' },
  aurelian: { label: 'Aurelian Stock', className: 'faction-aurelian' },
};

export function weaponCategory(catalog: Catalog, weapon: Weapon): WeaponCategory {
  if (weapon.visual.style === 'flame') return 'flamers';

  if (weapon.type === 'missile') {
    if (
      weapon.tags.includes('indirect_fire') ||
      weapon.range.long >= catalog.rules.ai.roles.longRangeMetres
    ) {
      return 'long-range-missiles';
    }
    if (weapon.range.long <= catalog.rules.ai.roles.shortRangeMetres) {
      return 'short-range-missiles';
    }
    return 'medium-range-missiles';
  }

  if (weapon.type === 'ballistic') {
    if (weapon.id === 'machine_gun') return 'machine-guns';
    if (weapon.visual.style === 'slug') return 'railguns';
    return 'autocannons';
  }

  return weapon.visual.style === 'bolt' ? 'particle-weapons' : 'lasers';
}

export function weaponCategoryLabel(category: WeaponCategory): string {
  return WEAPON_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
}

export function weaponsByCategory(
  catalog: Catalog,
  weapons: readonly Weapon[],
): ReadonlyMap<WeaponCategory, readonly Weapon[]> {
  const groups = new Map<WeaponCategory, Weapon[]>();
  for (const category of WEAPON_CATEGORIES) groups.set(category.id, []);
  for (const weapon of weapons) groups.get(weaponCategory(catalog, weapon))?.push(weapon);
  return groups;
}

export function weaponMetrics(weapon: Weapon): WeaponMetrics {
  return {
    damage: (weapon.damage * weapon.projectiles) / weapon.cooldown,
    reach: weapon.range.long,
    heat: weapon.heat / weapon.cooldown,
  };
}

export function weaponMetricMaxima(catalog: Catalog): WeaponMetrics {
  const maxima: WeaponMetrics = { damage: 0, reach: 0, heat: 0 };
  for (const weapon of catalog.weapons.values()) {
    const metrics = weaponMetrics(weapon);
    maxima.damage = Math.max(maxima.damage, metrics.damage);
    maxima.reach = Math.max(maxima.reach, metrics.reach);
    maxima.heat = Math.max(maxima.heat, metrics.heat);
  }
  return maxima;
}

function normalise(value: number, maximum: number): number {
  if (maximum <= 0) return 0;
  return Math.max(0, Math.min(1, value / maximum));
}

export function normalisedWeaponMetrics(
  weapon: Weapon,
  maxima: WeaponMetrics,
): NormalisedWeaponMetrics {
  const metrics = weaponMetrics(weapon);
  return {
    damage: normalise(metrics.damage, maxima.damage),
    reach: normalise(metrics.reach, maxima.reach),
    heat: normalise(metrics.heat, maxima.heat),
  };
}

export function formatWeaponNumber(value: number, places = 2): string {
  return value.toFixed(places).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function noun(value: number, singular: string): string {
  return `${formatWeaponNumber(value)} ${singular}${value === 1 ? '' : 's'}`;
}

export function ammoEnduranceSeconds(weapon: Weapon): number | null {
  return weapon.ammoPerTon === null ? null : weapon.ammoPerTon * weapon.cooldown;
}

export function weaponCostLine(weapon: Weapon): string {
  const endurance = ammoEnduranceSeconds(weapon);
  const ammunition =
    weapon.visual.style === 'flame'
      ? 'no separate fuel bin is tracked'
      : endurance === null
        ? 'needs no ammunition'
        : `1 ton of ammo lasts ${formatWeaponNumber(endurance)}s at full cycle`;
  return `${noun(weapon.tonnage, 'ton')}, ${noun(weapon.slots, 'slot')}; adds ${formatWeaponNumber(weaponMetrics(weapon).heat)} heat/s; ${ammunition}.`;
}

export function weaponOperatingLine(weapon: Weapon): string {
  if (weapon.visual.style === 'flame') {
    return 'Close-range heat weapon; the loadout tracks no separate fuel bin.';
  }
  if (weapon.type === 'energy') {
    return 'Needs no ammunition; sustained fire is limited by heat.';
  }
  if (weapon.type === 'missile') {
    return 'Travelling cluster with a finite magazine; line of sight is still required.';
  }
  return 'Cooler sustained fire with a finite magazine and a vulnerable ammunition bin.';
}

export function weaponTraitLines(catalog: Catalog, weapon: Weapon): readonly string[] {
  const traits: string[] = [];
  if (weapon.projectiles > 1) traits.push(`${weapon.projectiles}-hit spread`);
  if (weapon.accuracy !== 1) {
    const difference = Math.round(Math.abs(weapon.accuracy - 1) * 100);
    traits.push(`${difference}% ${weapon.accuracy > 1 ? 'better' : 'worse'} tracking`);
  }
  if (weapon.range.min > 0) {
    traits.push(
      `${Math.round(catalog.rules.combat.minimumRangeFactor * 100)}% accuracy inside ${weapon.range.min}m`,
    );
  }
  if (weapon.targetHeat > 0) {
    traits.push(`Adds ${formatWeaponNumber(weapon.targetHeat)} heat to the target`);
  }
  if (weapon.tags.includes('volatile')) traits.push('Mount can detonate when breached');
  return traits;
}

export function factionPresentation(faction: Faction): { label: string; className: string } {
  return FACTION_PRESENTATION[faction];
}

export function isForeignPattern(weapon: Weapon, chassisFaction: Faction | undefined): boolean {
  return chassisFaction !== undefined && weapon.faction !== chassisFaction;
}
