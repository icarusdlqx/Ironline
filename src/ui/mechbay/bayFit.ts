import type { Chassis } from '../../schema/chassis';
import { LOCATIONS, type MechLocation } from '../../schema/common';
import type { Design } from '../../schema/design';
import type { Equipment } from '../../schema/equipment';
import type { Catalog } from '../../schema/load';
import type { Weapon } from '../../schema/weapon';
import { computeLoadout, weaponSize, weaponSizeLabel } from '../../sim/loadout';

export type BayInventory = ReadonlyMap<string, number> | undefined;

export type WeaponFitReasonCode =
  | 'unknown_chassis'
  | 'unknown_weapon'
  | 'hardpoint_type'
  | 'hardpoint_size'
  | 'location_slots'
  | 'stock';

export interface WeaponFitReason {
  code: WeaponFitReasonCode;
  message: string;
}

export interface WeaponFit {
  ok: boolean;
  reasons: readonly WeaponFitReason[];
  requiredSlots: number;
  automaticAmmoSlots: number;
  freeSlots: number;
  stockLeft: number | null;
}

const LOCATION_NAMES: Record<MechLocation, string> = {
  head: 'Head',
  centre_torso: 'Centre Torso',
  left_torso: 'Left Torso',
  right_torso: 'Right Torso',
  left_arm: 'Left Arm',
  right_arm: 'Right Arm',
  left_leg: 'Left Leg',
  right_leg: 'Right Leg',
};

function consume(remaining: Map<string, number>, id: string, count = 1): void {
  remaining.set(id, Math.max(0, (remaining.get(id) ?? 0) - count));
}

/**
 * Campaign inventory includes the gantry's original fittings. Subtracting the
 * whole draft keeps a moved gun available while preventing the same copy from
 * being mounted twice. Ammunition stays out: campaign refits buy it by the ton
 * rather than booking bins through stores.
 */
export function remainingInventory(
  totalInventory: BayInventory,
  draft: Design,
): ReadonlyMap<string, number> | undefined {
  if (totalInventory === undefined) return undefined;

  const remaining = new Map(totalInventory);
  for (const mount of draft.mounts) consume(remaining, mount.weaponId);
  for (const fit of draft.equipment) consume(remaining, fit.equipmentId);
  consume(remaining, draft.heatSinkId, draft.heatSinks);
  return remaining;
}

function unknownFit(code: 'unknown_chassis' | 'unknown_weapon', message: string): WeaponFit {
  return {
    ok: false,
    reasons: [{ code, message }],
    requiredSlots: 0,
    automaticAmmoSlots: 0,
    freeSlots: 0,
    stockLeft: null,
  };
}

function slotPhrase(count: number): string {
  return `${count} slot${count === 1 ? '' : 's'}`;
}

/**
 * Answers only whether this shelf action can be placed at this location. Whole
 * machine tonnage remains visible in the bay instead of making useful weapons
 * disappear before the player has had a chance to trade armour for them.
 */
export function weaponFitAtLocation(
  catalog: Catalog,
  draft: Design,
  location: MechLocation,
  weaponId: string,
  totalInventory?: ReadonlyMap<string, number>,
): WeaponFit {
  const chassis = catalog.chassis.get(draft.chassisId);
  if (chassis === undefined) {
    return unknownFit('unknown_chassis', `Unknown chassis "${draft.chassisId}".`);
  }

  const weapon = catalog.weapons.get(weaponId);
  if (weapon === undefined) return unknownFit('unknown_weapon', `Unknown weapon "${weaponId}".`);

  const usage = computeLoadout(catalog, draft).perLocation[location];
  const automaticAmmoSlots =
    weapon.ammoPerTon === null ? 0 : catalog.rules.construction.ammoSlotsPerTon;
  const requiredSlots = weapon.slots + automaticAmmoSlots;
  const freeSlots = Math.max(0, usage.slotsAvailable - usage.slotsUsed);
  const remaining = remainingInventory(totalInventory, draft);
  const stockLeft = remaining === undefined ? null : (remaining.get(weapon.id) ?? 0);
  const reasons: WeaponFitReason[] = [];
  const locationName = LOCATION_NAMES[location];

  if (usage.hardpointsUsed[weapon.type] >= usage.hardpointsAvailable[weapon.type]) {
    reasons.push({
      code: 'hardpoint_type',
      message: `${locationName} has no free ${weapon.type} hardpoint.`,
    });
  }

  const size = weaponSize(catalog, weapon);
  if (size > usage.size) {
    reasons.push({
      code: 'hardpoint_size',
      message: `${weapon.name} needs a ${weaponSizeLabel(catalog, size)} hardpoint; ${locationName} takes ${weaponSizeLabel(catalog, usage.size)} weapons or smaller.`,
    });
  }

  if (requiredSlots > freeSlots) {
    const fitting =
      automaticAmmoSlots === 0
        ? `${weapon.name} needs ${slotPhrase(requiredSlots)}`
        : `${weapon.name} and its automatic ammunition need ${slotPhrase(requiredSlots)}`;
    reasons.push({
      code: 'location_slots',
      message: `${fitting}; ${locationName} has ${slotPhrase(freeSlots)} free.`,
    });
  }

  if (stockLeft !== null && stockLeft <= 0) {
    reasons.push({ code: 'stock', message: `No ${weapon.name} left in stores.` });
  }

  return {
    ok: reasons.length === 0,
    reasons,
    requiredSlots,
    automaticAmmoSlots,
    freeSlots,
    stockLeft,
  };
}

export function compatibleLocations(
  catalog: Catalog,
  draft: Design,
  weaponId: string,
  totalInventory?: ReadonlyMap<string, number>,
): MechLocation[] {
  return LOCATIONS.filter(
    (location) =>
      weaponFitAtLocation(catalog, draft, location, weaponId, totalInventory).ok,
  );
}

/** Ammo remains useful whenever its gun is mounted, even when no bin is yet fitted. */
export function ammoShelfWeapons(catalog: Catalog, draft: Design): Weapon[] {
  const mounted = new Set(draft.mounts.map((mount) => mount.weaponId));
  return [...catalog.weapons.values()].filter(
    (weapon) => mounted.has(weapon.id) && weapon.ammoPerTon !== null,
  );
}

export function equipmentFitsChassis(chassis: Chassis, equipment: Equipment): boolean {
  return equipment.category !== 'jump_jet' || chassis.jumpCapable;
}

export function equipmentShelfItems(
  catalog: Catalog,
  draft: Design,
  totalInventory?: ReadonlyMap<string, number>,
): Equipment[] {
  const chassis = catalog.chassis.get(draft.chassisId);
  if (chassis === undefined) return [];

  const remaining = remainingInventory(totalInventory, draft);
  return [...catalog.equipment.values()].filter(
    (equipment) =>
      equipment.category !== 'heat_sink' &&
      equipmentFitsChassis(chassis, equipment) &&
      (remaining === undefined || (remaining.get(equipment.id) ?? 0) > 0),
  );
}
