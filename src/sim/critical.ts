import type { MechLocation } from '../schema/common';
import type { ArmourFace } from './arcs';
import { detonateAmmoBin } from './damage';
import { emit } from './events';
import type { MechEntity, World } from './types';

/**
 * What a critical hit found behind the armour. Named for what the pilot would
 * be told over the radio, because that is what the event log prints.
 */
export type CriticalComponent = 'weapon' | 'ammunition' | 'actuator' | 'sensors' | 'heat sink';

/**
 * Whether a shot is going to reach the frame. Armour is what stops criticals:
 * a plate that still has anything left on it takes the hit as a plate, however
 * hard the round was travelling.
 */
export function penetrates(
  target: MechEntity,
  location: MechLocation,
  damage: number,
  face: ArmourFace = 'front',
): boolean {
  const state = target.locations[location];
  if (state.destroyed) return true;

  // Against the plate the shot actually meets. Testing the glacis would let an
  // intact front keep criticals out of a mech being shot in the back, which is
  // most of what having a back is for.
  const plate = face === 'rear' && state.rearArmourMax > 0 ? state.rearArmour : state.armour;
  return damage > plate;
}

/**
 * Wrecks one of the things fitted in a location. Everything actually mounted
 * there is a candidate, plus the frame itself — so a crit in an empty leg is
 * still a ruined actuator rather than nothing at all.
 *
 * Returns what it hit, or null when the location had already lost everything
 * worth losing.
 */
export function wreckComponent(
  world: World,
  target: MechEntity,
  location: MechLocation,
): CriticalComponent | null {
  const mounts = target.weapons.filter(
    (mount) => mount.location === location && !mount.destroyed,
  );
  const bins = target.ammoBins.filter((bin) => bin.location === location && !bin.destroyed);

  const candidates: CriticalComponent[] = [
    ...mounts.map((): CriticalComponent => 'weapon'),
    ...bins.map((): CriticalComponent => 'ammunition'),
    structureOf(location),
  ];

  const picked = world.rng.pick(candidates);
  if (picked === undefined) return null;

  if (picked === 'weapon') {
    const mount = world.rng.pick(mounts);
    if (mount === undefined) return null;
    mount.destroyed = true;
    return 'weapon';
  }

  if (picked === 'ammunition') {
    const bin = world.rng.pick(bins);
    if (bin === undefined) return null;
    if (bin.protectedByCase) {
      // The blow-out panels do their job: the bin is gone, the mech is not.
      bin.destroyed = true;
      bin.rounds = 0;
      return 'ammunition';
    }
    detonateAmmoBin(world, target, bin);
    return 'ammunition';
  }

  return damageStructure(world, target, location, picked);
}

/** What a crit finds in a location carrying nothing else: the frame itself. */
function structureOf(location: MechLocation): CriticalComponent {
  if (location === 'head') return 'sensors';
  if (location === 'left_arm' || location === 'right_arm') return 'actuator';
  if (location === 'left_leg' || location === 'right_leg') return 'actuator';
  return 'heat sink';
}

function damageStructure(
  world: World,
  target: MechEntity,
  location: MechLocation,
  component: CriticalComponent,
): CriticalComponent | null {
  const rules = world.rules.damage.critical;

  if (component === 'sensors') {
    target.outgoingAccuracyFactor *= rules.sensorAccuracyFactor;
    return 'sensors';
  }

  if (component === 'actuator') {
    if (location === 'left_leg' || location === 'right_leg') {
      target.walkSpeed *= rules.actuatorSpeedFactor;
      target.runSpeed *= rules.actuatorSpeedFactor;
    } else {
      target.outgoingAccuracyFactor *= rules.actuatorAccuracyFactor;
    }
    return 'actuator';
  }

  // A sink bank in the torso. The last one is not takeable: a mech with no
  // dissipation at all cooks itself in seconds and stops being a fight.
  if (target.heatSinks <= 1) return null;
  target.dissipationPerSecond *= (target.heatSinks - 1) / target.heatSinks;
  target.heatSinks -= 1;
  return 'heat sink';
}

/**
 * Resolves one critical hit: the shot is worth more, and it may have taken
 * something with it. Returns the damage multiplier to apply.
 */
export function resolveCritical(
  world: World,
  target: MechEntity,
  location: MechLocation,
  shooterId: number | null,
): number {
  const rules = world.rules.damage.critical;
  const component = world.rng.chance(rules.componentChance)
    ? wreckComponent(world, target, location)
    : null;

  emit(world.events, {
    type: 'critical_hit',
    tick: world.tick,
    entityId: target.id,
    shooterId,
    location,
    component,
  });

  return rules.damageMultiplier;
}
