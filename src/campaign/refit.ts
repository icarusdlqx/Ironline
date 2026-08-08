import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Design } from '../schema/design';
import type { Catalog } from '../schema/load';
import { computeLoadout, maximiseArmour } from '../sim/loadout';
import { pristineCondition } from './repair';
import { addToStore, takeFromStore, type CampaignState, type MechRecord } from './types';

export interface RefitResult {
  ok: boolean;
  reason: string | null;
  location: MechLocation | null;
}

function copy(design: Design): Design {
  return JSON.parse(JSON.stringify(design)) as Design;
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
  mech.condition = pristineCondition(catalog, plan.design);
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

  const next = copy(mech.design);
  next.mounts.splice(mountIndex, 1);

  mech.design = maximiseArmour(catalog, next);
  mech.condition = pristineCondition(catalog, mech.design);
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
