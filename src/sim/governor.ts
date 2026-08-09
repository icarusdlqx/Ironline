import { type MechEntity, type World } from './types';

interface GroupLoad {
  group: number;
  heatPerSecond: number;
  damagePerHeat: number;
}

/** What each weapon group costs to run flat out, and what it buys per point of heat. */
function groupLoads(world: World, mech: MechEntity): GroupLoad[] {
  const totals = new Map<number, { heat: number; damage: number }>();

  for (const mount of mech.weapons) {
    if (mount.destroyed) continue;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;
    const entry = totals.get(mount.group) ?? { heat: 0, damage: 0 };
    entry.heat += weapon.heat / weapon.cooldown;
    entry.damage += (weapon.damage * weapon.projectiles) / weapon.cooldown;
    totals.set(mount.group, entry);
  }

  return [...totals]
    .map(([group, total]) => ({
      group,
      heatPerSecond: total.heat,
      damagePerHeat: total.heat === 0 ? Number.POSITIVE_INFINITY : total.damage / total.heat,
    }))
    .sort((a, b) => (b.damagePerHeat === a.damagePerHeat
      ? a.group - b.group
      : b.damagePerHeat - a.damagePerHeat));
}

/**
 * Heat discipline is a dial, not a switch. Running hot, a pilot sheds the guns
 * that cost the most heat per point of damage and keeps firing the rest — going
 * fully dark to save four heat is how a duel outlives the mission clock.
 */
export function applyHeatGovernor(world: World, mech: MechEntity, targetNearlyDead: boolean): void {
  const rules = world.rules.ai.heat;
  const fraction = mech.heat / mech.heatCapacity;

  if (targetNearlyDead && fraction < 1) {
    restoreIntent(mech);
    mech.ai.coolingDown = false;
    return;
  }

  if (fraction <= rules.resumeFraction) {
    mech.ai.coolingDown = false;
    restoreIntent(mech);
    return;
  }

  // Between the two thresholds, leave the current selection alone: flipping guns
  // on and off every half second is worse than either choice.
  if (!mech.ai.coolingDown && fraction < rules.holdFireFraction) return;

  mech.ai.coolingDown = true;

  const budget = mech.dissipationPerSecond * rules.sustainFactor;
  let spent = 0;

  for (let index = 0; index < mech.groupEnabled.length; index += 1) {
    mech.groupEnabled[index] = false;
  }

  for (const load of groupLoads(world, mech)) {
    // Never fire a group the pilot switched off, whatever the heat budget allows.
    if (mech.groupIntent[load.group - 1] !== true) continue;
    if (spent + load.heatPerSecond > budget) continue;
    spent += load.heatPerSecond;
    mech.groupEnabled[load.group - 1] = true;
  }
}

/** Hands the guns back to the pilot's last order. */
export function restoreIntent(mech: MechEntity): void {
  for (let index = 0; index < mech.groupEnabled.length; index += 1) {
    mech.groupEnabled[index] = mech.groupIntent[index] === true;
  }
}
