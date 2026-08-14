import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Design } from '../schema/design';
import type { Catalog } from '../schema/load';
import { computeLoadout, maximiseArmour } from '../sim/loadout';
import { pristineCondition } from './repair';
import { addToStore, storeCount, takeFromStore, type CampaignState, type MechRecord } from './types';

export interface RefitResult {
  ok: boolean;
  reason: string | null;
  location: MechLocation | null;
}

function copy(design: Design): Design {
  return JSON.parse(JSON.stringify(design)) as Design;
}

/**
 * Refitting rewrites the armour maxima, which leaves the recorded condition
 * pointing at the old numbers. Rescale it rather than replacing it: a refit is
 * bolting a gun on, not a free rebuild, and the damage has to survive it.
 */
function rescaleCondition(catalog: Catalog, mech: MechRecord, design: Design): void {
  const fresh = pristineCondition(catalog, design);
  const next = { ...fresh };

  for (const location of LOCATIONS) {
    const was = mech.condition[location];
    const now = fresh[location];
    if (was === undefined || now === undefined) continue;
    next[location] = {
      armour: Math.min(was.armour, now.armour),
      rearArmour: Math.min(was.rearArmour, now.rearArmour),
      internal: Math.min(was.internal, now.internal),
      destroyed: was.destroyed,
    };
  }

  mech.condition = next;
}

function withWeapon(design: Design, weaponId: string, location: MechLocation): Design {
  const next = copy(design);
  next.mounts.push({ weaponId, location });
  return next;
}

function withAmmo(design: Design, weaponId: string, location: MechLocation): Design {
  const next = copy(design);
  const existing = next.ammo.find(
    (entry) => entry.weaponId === weaponId && entry.location === location,
  );
  if (existing === undefined) next.ammo.push({ weaponId, location, tons: 1 });
  else existing.tons += 1;
  return next;
}

/**
 * Finds a location where this weapon fits once armour is re-spread. Returns the
 * finished design so the caller does not have to redo the search.
 */
export function planFit(
  catalog: Catalog,
  design: Design,
  weaponId: string,
): { location: MechLocation; design: Design } | null {
  const weapon = catalog.weapons.get(weaponId);
  if (weapon === undefined) return null;

  for (const location of LOCATIONS) {
    let candidate = withWeapon(design, weaponId, location);

    if (weapon.ammoPerTon !== null && !candidate.ammo.some((e) => e.weaponId === weaponId)) {
      const withRounds = withAmmo(candidate, weaponId, location);
      if (computeLoadout(catalog, maximiseArmour(catalog, withRounds)).valid) {
        candidate = withRounds;
      }
    }

    const balanced = maximiseArmour(catalog, candidate);
    if (computeLoadout(catalog, balanced).valid) return { location, design: balanced };
  }

  return null;
}

/** Moves a weapon out of the store and onto a mech, re-spreading armour to pay for it. */
export function fitFromStore(
  catalog: Catalog,
  state: CampaignState,
  mech: MechRecord,
  weaponId: string,
): RefitResult {
  if (mech.status === 'hulk') {
    return { ok: false, reason: 'rebuild the chassis before refitting it', location: null };
  }
  if (mech.status === 'repairing') {
    return { ok: false, reason: 'this mech is in the repair bay', location: null };
  }

  const plan = planFit(catalog, mech.design, weaponId);
  if (plan === null) {
    return { ok: false, reason: 'no location on this chassis can take it', location: null };
  }

  if (!takeFromStore(state, 'weapon', weaponId)) {
    return { ok: false, reason: 'none of those in stores', location: null };
  }

  mech.design = plan.design;
  rescaleCondition(catalog, mech, plan.design);
  return { ok: true, reason: null, location: plan.location };
}

/** Strips a mounted weapon back into stores. */
export function stripToStore(
  catalog: Catalog,
  state: CampaignState,
  mech: MechRecord,
  mountIndex: number,
): RefitResult {
  const mount = mech.design.mounts[mountIndex];
  if (mount === undefined) return { ok: false, reason: 'no such mount', location: null };
  if (mech.status !== 'ready') {
    return { ok: false, reason: 'this mech is not in the bay', location: null };
  }

  // A design with no weapons fails DesignSchema, and the campaign is serialised
  // without validation — stripping the last mount wrote a save that would not
  // load, silently discarding the run on the next start.
  if (mech.design.mounts.length <= 1) {
    return { ok: false, reason: 'a mech needs at least one weapon', location: null };
  }

  const next = copy(mech.design);
  next.mounts.splice(mountIndex, 1);

  mech.design = maximiseArmour(catalog, next);
  rescaleCondition(catalog, mech, mech.design);
  addToStore(state, 'weapon', mount.weaponId);

  return { ok: true, reason: null, location: mount.location };
}

/** Turns a salvaged wreck into a mech that can be repaired and flown. */
export function rebuildHulk(
  catalog: Catalog,
  state: CampaignState,
  mech: MechRecord,
): RefitResult {
  if (mech.status !== 'hulk') {
    return { ok: false, reason: 'this chassis is not a wreck', location: null };
  }
  if (mech.rebuildCost > state.cbills) {
    return { ok: false, reason: `rebuild costs ${mech.rebuildCost} C-bills`, location: null };
  }

  state.cbills -= mech.rebuildCost;
  mech.rebuildCost = 0;
  mech.status = 'repairing';
  mech.readyOnDay = state.day + catalog.rules.salvage.hulkRebuildDays;
  return { ok: true, reason: null, location: null };
}

/** How many of each item a design has bolted to it, by item id. */
function billOfMaterials(design: Design): Map<string, number> {
  const bill = new Map<string, number>();
  const add = (id: string, count = 1): void => {
    bill.set(id, (bill.get(id) ?? 0) + count);
  };
  for (const mount of design.mounts) add(mount.weaponId);
  for (const fit of design.equipment) add(fit.equipmentId);
  return bill;
}

/** What the company can put on a mech: its stores, plus what is already on it. */
export function refitInventory(
  state: CampaignState,
  mech: MechRecord,
): Map<string, number> {
  const available = new Map<string, number>();
  for (const item of state.store) {
    available.set(item.itemId, (available.get(item.itemId) ?? 0) + item.count);
  }
  // Anything already bolted on is available to move: taking it off puts it in
  // the player's hand, not on the shelf, and the bay works from one list.
  for (const [id, count] of billOfMaterials(mech.design)) {
    available.set(id, (available.get(id) ?? 0) + count);
  }
  return available;
}

/**
 * Books a finished refit through the company's stores.
 *
 * The bay hands back a whole design rather than a sequence of edits, so this
 * works out the difference: what came off goes back on the shelf, what went on
 * comes off it, and a refit the company cannot pay for is refused before
 * anything is written. Ammunition is not stock — it is bought by the ton with
 * the contract, the way a quartermaster would.
 */
export function applyRefit(
  catalog: Catalog,
  state: CampaignState,
  mech: MechRecord,
  next: Design,
): RefitResult {
  if (mech.status === 'hulk') {
    return { ok: false, reason: 'rebuild the chassis before refitting it', location: null };
  }
  if (mech.status === 'repairing') {
    return { ok: false, reason: 'this mech is in the repair bay', location: null };
  }
  if (next.chassisId !== mech.design.chassisId) {
    return { ok: false, reason: 'that build is for a different chassis', location: null };
  }

  const loadout = computeLoadout(catalog, next);
  if (!loadout.valid) {
    return { ok: false, reason: loadout.issues[0]?.message ?? 'the build is not legal', location: null };
  }

  const before = billOfMaterials(mech.design);
  const after = billOfMaterials(next);
  const ids = new Set([...before.keys(), ...after.keys()]);

  // Check the whole bill before moving any of it, so a refused refit leaves
  // the stores exactly as it found them.
  const wanted: { id: string; count: number }[] = [];
  for (const id of ids) {
    const short = (after.get(id) ?? 0) - (before.get(id) ?? 0);
    if (short <= 0) continue;
    const kind = catalog.weapons.has(id) ? 'weapon' : 'equipment';
    if (storeCount(state, kind, id) < short) {
      const name = catalog.weapons.get(id)?.name ?? catalog.equipment.get(id)?.name ?? id;
      return {
        ok: false,
        reason: `stores hold ${storeCount(state, kind, id)} × ${name}; the build needs ${short} more`,
        location: null,
      };
    }
    wanted.push({ id, count: short });
  }

  for (const { id, count } of wanted) {
    takeFromStore(state, catalog.weapons.has(id) ? 'weapon' : 'equipment', id, count);
  }
  for (const id of ids) {
    const spare = (before.get(id) ?? 0) - (after.get(id) ?? 0);
    if (spare > 0) addToStore(state, catalog.weapons.has(id) ? 'weapon' : 'equipment', id, spare);
  }

  mech.design = JSON.parse(JSON.stringify(next)) as Design;
  rescaleCondition(catalog, mech, mech.design);
  return { ok: true, reason: null, location: null };
}
