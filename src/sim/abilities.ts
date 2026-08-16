import type { Ability, AbilityRules } from '../schema/rules';
import { emit } from './events';
import { isDown, isOperational, type MechEntity, type World } from './types';

/**
 * One thing every pilot can DO, on a cooldown.
 *
 * Traits already make pilots differ, but only as numbers quietly multiplying
 * other numbers — nobody ever felt clever because their gunner had a 1.1
 * accuracy factor. An ability is the same difference expressed as a button:
 * a moment in the fight where the player spends something and watches it work.
 * Which one a pilot carries comes from the specialities they hold, so the
 * roster screen and the battlefield finally talk about the same person.
 *
 * Everything here is simulation state, driven by an order and resolved on the
 * tick, so a replay of the same seed and the same orders plays out identically.
 */

/** The ability a pilot's specialities have earned them. First match wins. */
export function abilityIdFor(rules: AbilityRules, traits: readonly string[]): string {
  for (const trait of traits) {
    const earned = rules.byTrait[trait];
    if (earned !== undefined && rules.entries[earned] !== undefined) return earned;
  }
  return rules.default;
}

export function abilityOf(world: World, entity: MechEntity): Ability | null {
  return world.rules.abilities.entries[entity.ability.id] ?? null;
}

/** True while the ability's effect is running. */
export function abilityActive(world: World, entity: MechEntity): boolean {
  return world.tick <= entity.ability.activeUntilTick;
}

export function abilityReady(world: World, entity: MechEntity): boolean {
  return (
    world.tick >= entity.ability.readyAtTick &&
    isOperational(entity) &&
    entity.shutdownRemaining <= 0 &&
    !isDown(entity)
  );
}

/**
 * Multipliers the ability contributes right now. One function rather than
 * scattered state, so nothing has to be unwound when the effect lapses — an
 * effect that ends is simply an effect that stops being asked about.
 */
export function abilityFactor(
  world: World,
  entity: MechEntity,
  kind: 'accuracy' | 'incoming' | 'speed' | 'sensor' | 'damageTaken' | 'stability',
): number {
  if (!abilityActive(world, entity)) return 1;
  const ability = abilityOf(world, entity);
  if (ability === null) return 1;

  switch (kind) {
    case 'accuracy':
      return ability.accuracyFactor;
    case 'incoming':
      return ability.incomingAccuracyFactor;
    case 'speed':
      return ability.speedFactor;
    case 'sensor':
      return ability.sensorRangeFactor;
    case 'damageTaken':
      return ability.damageTakenFactor;
    case 'stability':
      return ability.stabilityFactor;
    default:
      return 1;
  }
}

/**
 * Spends the ability. Returns false when it is not the pilot's to spend yet —
 * the caller says so out loud rather than leaving the button feeling broken.
 */
export function useAbility(world: World, entity: MechEntity): boolean {
  if (!abilityReady(world, entity)) return false;
  const ability = abilityOf(world, entity);
  if (ability === null) return false;

  const rules = world.rules.abilities;
  entity.ability.readyAtTick = world.tick + Math.round(rules.cooldownSeconds / world.dt);
  entity.ability.activeUntilTick =
    world.tick + Math.round(ability.durationSeconds / world.dt);

  // Instant effects happen on the spot; there is nothing to run down.
  if (ability.heatShedFraction > 0) {
    entity.heat = Math.max(0, entity.heat * (1 - ability.heatShedFraction));
  }

  emit(world.events, {
    type: 'ability_used',
    tick: world.tick,
    entityId: entity.id,
    abilityId: entity.ability.id,
  });
  return true;
}
