import { abilityFactor } from './abilities';
import type { StabilityRules } from '../schema/rules';
import type { Weapon } from '../schema/weapon';
import { emit } from './events';
import { isDown, isOperational, type MechEntity, type World } from './types';

/**
 * The shove a single impact carries. Small hits carry none at all: the floor is
 * what makes knockdown a property of big guns rather than of volume, so a
 * missile boat putting twenty warheads into a mech never rocks it, and one
 * autocannon shell does.
 *
 * Recoil separates guns that land the same damage. A gauss slug and a large
 * laser can put the same hole in a plate; only one of them moves the mech
 * behind it.
 */
export function impulseOf(rules: StabilityRules, absorbed: number, weapon: Weapon | null): number {
  const over = absorbed - rules.impactFloor;
  if (over <= 0) return 0;
  return over * (1 + (weapon?.recoil ?? 0) * rules.recoilWeight);
}

/**
 * Puts shove into a mech and settles what that does to it. Callers pass raw
 * impulse; the pilot's hands and the mech's mass are applied here so nobody has
 * to remember to.
 *
 * Knockdown needs the mech to have been staggered *before* the hit landed, and
 * the pool is capped at the knockdown threshold, so no single shot ever takes a
 * steady mech off its feet. Staggering is a warning the player gets to answer.
 */
export function addStabilityImpulse(
  world: World,
  entity: MechEntity,
  raw: number,
  attackerId: number | null = null,
): void {
  if (raw <= 0 || !isOperational(entity)) return;
  // Nothing shoves a hull that is sitting on its tracks, or bolted to a pad.
  if (!entity.knockable) return;

  // A braced pilot has set their feet for exactly this.
  const impulse = raw * abilityFactor(world, entity, 'stability');
  if (impulse <= 0) return;

  const rules = world.rules.stability;

  // Already down: nothing left to knock over. Just got up: a moment of solid
  // footing, or a mech under sustained heavy fire would never stand again.
  if (isDown(entity) || world.tick < entity.footingUntilTick) return;

  // Nothing stops an arc once it starts, and that cuts both ways — a mech in
  // the air cannot be shoved off feet it is not standing on.
  if (entity.jump !== null) return;

  const grip = Math.max(0, 1 - entity.pilot.piloting * rules.pilotingResistFactor);
  const mass = rules.referenceTonnage / entity.tonnage;
  const shove = impulse * grip * mass;
  if (shove <= 0) return;

  const wasStaggered = entity.stability >= rules.staggerThreshold;
  entity.stability = Math.min(rules.knockdownThreshold, entity.stability + shove);

  if (wasStaggered && entity.stability >= rules.knockdownThreshold) {
    knockDown(world, entity, attackerId);
  } else if (!wasStaggered && entity.stability >= rules.staggerThreshold) {
    emit(world.events, { type: 'staggered', tick: world.tick, entityId: entity.id });
  }
}

function knockDown(world: World, entity: MechEntity, attackerId: number | null): void {
  const rules = world.rules.stability;

  entity.downRemaining = rules.downSeconds;
  entity.motion = 'stationary';
  entity.intendedMotion = entity.motion;
  entity.path = [];
  entity.pathIndex = 0;

  emit(world.events, {
    type: 'knocked_down',
    tick: world.tick,
    entityId: entity.id,
    attackerId,
  });

  // The same grip that keeps a good pilot upright keeps them in the seat when
  // the mech goes over.
  const grip = Math.max(0, 1 - entity.pilot.piloting * rules.pilotingResistFactor);
  if (!world.rng.chance(rules.pilotInjuryChance * grip)) return;

  entity.pilot.wounds += 1;
  entity.outgoingAccuracyFactor *= rules.woundAccuracyFactor;
  emit(world.events, {
    type: 'pilot_injured',
    tick: world.tick,
    entityId: entity.id,
    wounds: entity.pilot.wounds,
  });
}

/**
 * Bleeds the shove away, and counts a downed mech back onto its feet. Nothing
 * recovers while on the ground — you cannot steady yourself on your back — and
 * standing clears the pool outright, because carrying it over is exactly what
 * would make a mech that never gets up again.
 */
export function updateStability(world: World, entity: MechEntity): void {
  if (!isOperational(entity)) return;

  if (entity.downRemaining > 0) {
    entity.downRemaining = Math.max(0, entity.downRemaining - world.dt);
    if (entity.downRemaining > 0) return;

    entity.stability = 0;
    entity.footingUntilTick = world.tick + Math.ceil(world.rules.stability.footingSeconds / world.dt);
    emit(world.events, { type: 'stood_up', tick: world.tick, entityId: entity.id });
    return;
  }

  entity.stability = Math.max(0, entity.stability - world.rules.stability.recoveryPerSecond * world.dt);
}
