import type { Catalog } from '../schema/load';
import type { Weapon, WeaponType } from '../schema/weapon';

export interface WeaponEfficiency {
  weaponId: string;
  name: string;
  type: WeaponType;
  dps: number;
  heatPerSecond: number;
  effectiveTons: number;
  damagePerTonPerHeat: number;
}

export interface BalanceEntry extends WeaponEfficiency {
  /** Signed fraction away from the class median: +0.3 means 30% above it. */
  deviation: number;
  withinBand: boolean;
}

export interface ClassBalance {
  type: WeaponType;
  median: number;
  band: number;
  entries: BalanceEntry[];
}

/**
 * A mount costs you its own tonnage plus the heat sinks needed to keep it
 * firing. Damage per second measured against that combined mass is what §11
 * means by damage-per-ton-per-heat: tonnage and heat are the same currency,
 * and cooldown cancels out, so rate of fire stays free for feel.
 *
 * Accuracy is folded into the numerator — a gun that lands 15% more of its
 * shots delivers 15% more damage, so pulse and Streak launchers have to pay
 * for their aim in raw damage rather than getting it free.
 */
export function weaponEfficiency(catalog: Catalog, weapon: Weapon): WeaponEfficiency {
  const perSink = catalog.rules.heat.dissipationPerSinkPerSecond;
  const dps = (weapon.damage * weapon.projectiles * weapon.accuracy) / weapon.cooldown;
  const heatPerSecond = weapon.heat / weapon.cooldown;
  const effectiveTons = weapon.tonnage + heatPerSecond / perSink;

  return {
    weaponId: weapon.id,
    name: weapon.name,
    type: weapon.type,
    dps,
    heatPerSecond,
    effectiveTons,
    damagePerTonPerHeat: effectiveTons === 0 ? 0 : dps / effectiveTons,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Every weapon scored against the median of its own class. */
export function balanceByClass(catalog: Catalog): ClassBalance[] {
  const band = catalog.rules.balance.weaponBandFraction;
  const byType = new Map<WeaponType, WeaponEfficiency[]>();

  for (const weapon of catalog.weapons.values()) {
    const entry = weaponEfficiency(catalog, weapon);
    const bucket = byType.get(entry.type) ?? [];
    bucket.push(entry);
    byType.set(entry.type, bucket);
  }

  return [...byType.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, entries]) => {
      const centre = median(entries.map((entry) => entry.damagePerTonPerHeat));
      return {
        type,
        median: centre,
        band,
        entries: entries
          .map((entry) => {
            const deviation =
              centre === 0 ? 0 : (entry.damagePerTonPerHeat - centre) / centre;
            return { ...entry, deviation, withinBand: Math.abs(deviation) <= band };
          })
          .sort((a, b) => a.weaponId.localeCompare(b.weaponId)),
      };
    });
}

/** Weapons the acceptance test would reject, most out-of-band first. */
export function balanceOutliers(catalog: Catalog): BalanceEntry[] {
  return balanceByClass(catalog)
    .flatMap((group) => group.entries)
    .filter((entry) => !entry.withinBand)
    .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
}
