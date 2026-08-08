import type { HeatRules } from '../schema/rules';
import { detonateAmmoBin } from './damage';
import { emit } from './events';
import { isOperational, type MechEntity, type World } from './types';

type HeatTier = HeatRules['tiers'][number];

export function heatTierFor(rules: HeatRules, fraction: number): HeatTier {
  let chosen = rules.tiers[0] as HeatTier;
  for (const tier of rules.tiers) {
    if (fraction >= tier.fraction) chosen = tier;
  }
  return chosen;
}

export function currentHeatTier(world: World, entity: MechEntity): HeatTier {
  return heatTierFor(world.rules.heat, entity.heat / entity.heatCapacity);
}

export function addHeat(entity: MechEntity, amount: number): void {
  entity.heat += amount;
  if (entity.heat > entity.stats.heatPeak) entity.stats.heatPeak = entity.heat;
}

export function updateHeat(world: World, entity: MechEntity): void {
  if (!isOperational(entity)) return;

  const terrain = world.terrain.typeAtPoint(entity.pos);
  const dissipated =
    entity.dissipationPerSecond * terrain.heatDissipationMultiplier * world.dt;
  entity.heat = Math.max(0, entity.heat - dissipated);

  if (entity.shutdownRemaining > 0) {
    entity.shutdownRemaining = Math.max(0, entity.shutdownRemaining - world.dt);
    if (entity.shutdownRemaining === 0) {
      emit(world.events, { type: 'restart', tick: world.tick, entityId: entity.id });
    }
    return;
  }

  const tier = currentHeatTier(world, entity);

  if (tier.forcedShutdown) {
    entity.shutdownRemaining = world.rules.heat.shutdownSeconds;
    emit(world.events, {
      type: 'shutdown',
      tick: world.tick,
      entityId: entity.id,
      forced: true,
    });
  } else if (tier.shutdownChancePerSecond > 0) {
    const override = 1 - entity.pilot.piloting * world.rules.heat.pilotingOverrideFactor;
    if (world.rng.chance(tier.shutdownChancePerSecond * Math.max(0, override) * world.dt)) {
      entity.shutdownRemaining = world.rules.heat.shutdownSeconds;
      emit(world.events, {
        type: 'shutdown',
        tick: world.tick,
        entityId: entity.id,
        forced: false,
      });
    }
  }

  if (tier.ammoExplosionChancePerSecond <= 0) return;
  if (!world.rng.chance(tier.ammoExplosionChancePerSecond * world.dt)) return;

  const live = entity.ammoBins.filter((bin) => !bin.destroyed && bin.rounds > 0);
  if (live.length === 0) return;

  const bin = world.rng.pick(live);
  if (bin.protectedByCase) {
    bin.destroyed = true;
    bin.rounds = 0;
    return;
  }
  detonateAmmoBin(world, entity, bin);
}
