import type { HeatRules } from '../schema/rules';
import { isDown, isOperational, type MechEntity, type World } from '../sim/types';
import type {
  HeatBandTone,
  ReactorSnapshot,
  StabilitySnapshot,
  TimedActionSnapshot,
} from './store';

export function formatReadoutSeconds(value: number): string {
  return value < 10 ? `${value.toFixed(1)}s` : `${Math.ceil(value)}s`;
}

export function actionStatus(action: TimedActionSnapshot): string {
  if (action.activeRemaining > 0) {
    return `ACTIVE ${formatReadoutSeconds(action.activeRemaining)}`;
  }
  if (action.ready) return 'READY';
  if (action.cooldownRemaining > 0) {
    return `${formatReadoutSeconds(action.cooldownRemaining)} COOLDOWN`;
  }
  return 'UNAVAILABLE';
}

function timeUntil(world: World, tick: number, inclusive = false): number {
  const ticks = tick - world.tick + (inclusive && tick >= world.tick ? 1 : 0);
  return Math.max(0, ticks * world.dt);
}

function canAct(entity: MechEntity): boolean {
  return isOperational(entity) && entity.shutdownRemaining <= 0 && !isDown(entity);
}

function fallbackLabel(id: string): string {
  return id
    .split('_')
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
}

export function abilityReadout(world: World, entity: MechEntity): TimedActionSnapshot {
  const ability = world.rules.abilities.entries[entity.ability.id];
  return {
    label: ability?.label ?? fallbackLabel(entity.ability.id),
    note: ability?.note ?? 'No field note is available.',
    ready: world.tick >= entity.ability.readyAtTick && canAct(entity),
    activeRemaining: timeUntil(world, entity.ability.activeUntilTick, true),
    cooldownRemaining: timeUntil(world, entity.ability.readyAtTick),
  };
}

function chargedAlphaHeat(world: World, entity: MechEntity): number {
  const windowTicks = Math.round(world.rules.heat.alphaStrikeSeconds / world.dt);
  const waitTicks = Math.max(0, entity.alphaReadyAtTick - world.tick);
  const rounds = new Map<string, number>();
  for (const bin of entity.ammoBins) {
    if (bin.destroyed || bin.rounds <= 0) continue;
    rounds.set(bin.weaponId, (rounds.get(bin.weaponId) ?? 0) + bin.rounds);
  }
  let heat = 0;

  for (const mount of entity.weapons) {
    if (mount.destroyed) continue;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;
    const cooldownTicks = Math.ceil(mount.cooldown / world.dt - Number.EPSILON);
    const firstShotTick = Math.max(1, cooldownTicks - waitTicks);
    if (firstShotTick > windowTicks) continue;
    const cycleTicks = Math.max(1, Math.ceil(weapon.cooldown / world.dt - Number.EPSILON));
    let shots = 1 + Math.floor((windowTicks - firstShotTick) / cycleTicks);
    if (weapon.ammoPerTon !== null) {
      const available = rounds.get(weapon.id) ?? 0;
      shots = Math.min(shots, available);
      rounds.set(weapon.id, available - shots);
    }
    heat += weapon.heat * shots;
  }

  return heat;
}

function heatBand(
  rules: HeatRules,
  fraction: number,
  piloting: number,
): { label: string; tone: HeatBandTone } {
  let band = rules.tiers[0];
  for (const candidate of rules.tiers) {
    if (fraction >= candidate.fraction) band = candidate;
  }

  if (band === undefined) return { label: 'within operating limits', tone: 'ok' };
  if (band.forcedShutdown) return { label: 'forced-shutdown band', tone: 'critical' };

  const risks: string[] = [];
  if (band.shutdownChancePerSecond > 0) {
    const override = Math.max(0, 1 - piloting * rules.pilotingOverrideFactor);
    risks.push(`${Math.round(band.shutdownChancePerSecond * override * 100)}% shutdown risk/s`);
  }
  if (band.ammoExplosionChancePerSecond > 0) {
    risks.push(`${Math.round(band.ammoExplosionChancePerSecond * 100)}% ammunition risk/s`);
  }
  if (risks.length > 0) return { label: risks.join(' · '), tone: 'danger' };

  const penalties: string[] = [];
  if (band.accuracyFactor < 1) {
    penalties.push(`−${Math.round((1 - band.accuracyFactor) * 100)}% accuracy`);
  }
  if (band.movementFactor < 1) {
    penalties.push(`−${Math.round((1 - band.movementFactor) * 100)}% speed`);
  }
  if (penalties.length > 0) return { label: penalties.join(' · '), tone: 'warn' };
  return { label: 'within operating limits', tone: 'ok' };
}

export function alphaReadout(world: World, entity: MechEntity): TimedActionSnapshot {
  const seconds = world.rules.heat.alphaStrikeSeconds;
  return {
    label: 'Alpha Strike',
    note: `If the target stays in range and arc, every charged gun fires for ${seconds.toFixed(1)}s. The reactor capacity gate is ignored.`,
    ready: world.tick >= entity.alphaReadyAtTick && canAct(entity),
    activeRemaining: timeUntil(world, entity.alphaUntilTick, true),
    cooldownRemaining: timeUntil(world, entity.alphaReadyAtTick),
  };
}

export function stabilityReadout(world: World, entity: MechEntity): StabilitySnapshot {
  return {
    value: entity.stability,
    staggerAt: world.rules.stability.staggerThreshold,
    knockdownAt: world.rules.stability.knockdownThreshold,
    footingRemaining: timeUntil(world, entity.footingUntilTick),
  };
}

export function reactorReadout(world: World, entity: MechEntity): ReactorSnapshot {
  const alphaHeat = chargedAlphaHeat(world, entity);
  const projectedFraction =
    entity.heatCapacity === 0 ? 0 : (entity.heat + alphaHeat) / entity.heatCapacity;
  const projected = heatBand(world.rules.heat, projectedFraction, entity.pilot.piloting);
  const shedGroups = entity.groupIntent.flatMap((asked, index) =>
    asked && entity.groupEnabled[index] !== true ? [index + 1] : [],
  );

  return {
    alphaHeat,
    projectedFraction,
    projectedBand: projected.label,
    projectedTone: projected.tone,
    governorHoldAt: world.rules.ai.heat.holdFireFraction,
    governorResumeAt: world.rules.ai.heat.resumeFraction,
    shedGroups,
  };
}
