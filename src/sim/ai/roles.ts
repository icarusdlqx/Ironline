import type { AiRules } from '../../schema/rules';
import { distance } from '../math';
import { isOperational, type MechEntity, type World } from '../types';

export { COMBAT_ROLES, type CombatRole } from '../../schema/rules';
import type { CombatRole } from '../../schema/rules';

export interface RoleProfile {
  role: CombatRole;
  /** Above 1 the mech presses; below 1 it gives ground and lets others lead. */
  aggression: number;
  /** How far behind the lance's leading edge this mech prefers to sit, in metres. */
  standoff: number;
  /**
   * How much return fire counts when picking a range to fight at. Near zero is
   * a machine that will trade all day; high is one that only shoots from where
   * it cannot be shot back.
   */
  caution: number;
}

interface Battery {
  short: number;
  long: number;
  indirect: number;
  total: number;
  minimumRange: number;
  tonnage: number;
}

/** Where a mech's output sits, by range bracket and by whether it can arc over cover. */
function batteryOf(world: World, mech: MechEntity): Battery {
  const rules = world.rules.ai.roles;
  const battery: Battery = {
    short: 0,
    long: 0,
    indirect: 0,
    total: 0,
    minimumRange: 0,
    tonnage: mech.tonnage,
  };

  for (const mount of mech.weapons) {
    if (mount.destroyed) continue;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;

    const output = (weapon.damage * weapon.projectiles) / weapon.cooldown;
    battery.total += output;
    if (weapon.range.long <= rules.shortRangeMetres) battery.short += output;
    if (weapon.range.long >= rules.longRangeMetres) battery.long += output;
    if (weapon.tags.includes('indirect_fire')) battery.indirect += output;
    battery.minimumRange = Math.max(battery.minimumRange, weapon.range.min);
  }

  return battery;
}

/**
 * Classifies by where a mech's damage actually lives. A hull carrying an AC/20
 * and a pair of SRM racks has no business behaving like one carrying an LRM 20,
 * and until this existed they behaved identically.
 */
export function roleOf(world: World, mech: MechEntity): RoleProfile {
  const rules = world.rules.ai.roles;
  const role = classify(rules, batteryOf(world, mech));
  const profile = rules.profiles[role];
  return {
    role,
    aggression: profile.aggression,
    standoff: profile.standoff,
    caution: profile.caution,
  };
}

/**
 * Order matters here. Long-range and indirect overlap almost completely — an LRM
 * is both — so the direct-fire long guns are claimed first and only what is left
 * over counts as a missile boat. The light check runs before either, because a
 * scout hull carrying one launcher is a spotter, not artillery.
 */
function classify(rules: AiRules['roles'], battery: Battery): CombatRole {
  const { short, long, indirect, total, minimumRange, tonnage } = battery;

  // Nothing worth shooting with: whatever else it is, it is a spotter now.
  if (total <= 0) return 'scout';
  if (tonnage <= rules.scoutTonnage && long / total < rules.longShare) return 'scout';
  if (long / total >= rules.longShare) return 'sniper';
  if (indirect / total >= rules.indirectShare) return 'missile_boat';
  if (minimumRange >= rules.minimumRangeMetres) return 'sniper';
  if (short / total >= rules.shortShare) {
    return tonnage >= rules.brawlerTonnage ? 'brawler' : 'skirmisher';
  }
  return 'skirmisher';
}

/**
 * How far forward the lance's leading edge is, measured toward the enemy. Used
 * to hold the long-range machines behind the ones built to absorb fire.
 */
export function lanceFrontage(world: World, mech: MechEntity, target: MechEntity): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const mate of world.entities) {
    // Measured over the REST of the lance. Counting the mech itself made the
    // frontage its own range, so whichever machine was already at the front got
    // told to stand its own standoff closer than wherever it happened to be —
    // a pull with no fixed point, renewed every decision.
    if (mate.id === mech.id || mate.team !== mech.team || !isOperational(mate)) continue;
    nearest = Math.min(nearest, distance(mate.pos, target.pos));
  }
  return Number.isFinite(nearest) ? nearest : distance(mech.pos, target.pos);
}
