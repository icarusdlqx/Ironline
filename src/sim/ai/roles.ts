import { distance } from '../math';
import { isOperational, type MechEntity, type World } from '../types';

/** How a mech wants to fight, read off what it is actually carrying. */
export type CombatRole = 'brawler' | 'skirmisher' | 'sniper' | 'missile_boat' | 'scout';

export interface RoleProfile {
  role: CombatRole;
  /** Above 1 the mech presses; below 1 it gives ground and lets others lead. */
  aggression: number;
  /** How far behind the lance's leading edge this mech prefers to sit, in metres. */
  standoff: number;
}

// Standoff is a preference, not a leash: enough to put the right machines in the
// right rank, small enough that a lance still closes and settles the fight.
const PROFILES: Record<CombatRole, { aggression: number; standoff: number }> = {
  brawler: { aggression: 1.35, standoff: -30 },
  skirmisher: { aggression: 1.1, standoff: 0 },
  sniper: { aggression: 0.85, standoff: 45 },
  missile_boat: { aggression: 0.7, standoff: 70 },
  scout: { aggression: 0.8, standoff: 35 },
};

/**
 * Classifies by where a mech's damage actually lives. A hull carrying an AC/20
 * and a pair of SRM racks has no business behaving like one carrying an LRM 20,
 * and until this existed they behaved identically.
 */
export function roleOf(world: World, mech: MechEntity): RoleProfile {
  let short = 0;
  let long = 0;
  let indirect = 0;
  let total = 0;
  let minimumRange = 0;

  for (const mount of mech.weapons) {
    if (mount.destroyed) continue;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;

    const output = (weapon.damage * weapon.projectiles) / weapon.cooldown;
    total += output;
    if (weapon.range.long <= 200) short += output;
    if (weapon.range.long >= 330) long += output;
    if (weapon.tags.includes('indirect_fire')) indirect += output;
    minimumRange = Math.max(minimumRange, weapon.range.min);
  }

  const role = classify({ short, long, indirect, total, minimumRange, mech });
  const profile = PROFILES[role];
  return { role, aggression: profile.aggression, standoff: profile.standoff };
}

function classify(input: {
  short: number;
  long: number;
  indirect: number;
  total: number;
  minimumRange: number;
  mech: MechEntity;
}): CombatRole {
  const { short, long, indirect, total, minimumRange, mech } = input;

  // Nothing worth shooting with: whatever else it is, it is a spotter now.
  if (total <= 0) return 'scout';
  if (indirect / total > 0.5) return 'missile_boat';
  if (long / total > 0.55 || minimumRange >= 60) return 'sniper';
  if (short / total > 0.6) return mech.tonnage >= 55 ? 'brawler' : 'skirmisher';
  if (mech.tonnage <= 35) return 'scout';
  return 'skirmisher';
}

/**
 * How far forward the lance's leading edge is, measured toward the enemy. Used
 * to hold the long-range machines behind the ones built to absorb fire.
 */
export function lanceFrontage(world: World, mech: MechEntity, target: MechEntity): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const mate of world.entities) {
    if (mate.team !== mech.team || !isOperational(mate)) continue;
    nearest = Math.min(nearest, distance(mate.pos, target.pos));
  }
  return Number.isFinite(nearest) ? nearest : distance(mech.pos, target.pos);
}
