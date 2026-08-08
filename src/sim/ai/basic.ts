import { lineOfSight } from '../los';
import { distance } from '../math';
import { findAmmoBin, isOperational, type MechEntity, type World } from '../types';
import { findPath } from '../pathfind';

function nearestEnemy(world: World, entity: MechEntity): MechEntity | null {
  let best: MechEntity | null = null;
  let bestRange = Number.POSITIVE_INFINITY;

  for (const candidate of world.entities) {
    if (candidate.team === entity.team || !isOperational(candidate)) continue;
    const range = distance(entity.pos, candidate.pos);
    if (range < bestRange) {
      best = candidate;
      bestRange = range;
    }
  }

  return best;
}

// Close until most weapons sit inside their short band, then stand and fight.
function preferredRange(world: World, entity: MechEntity): number {
  let preferred = 0;

  for (const mount of entity.weapons) {
    if (mount.destroyed) continue;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;
    if (weapon.ammoPerTon !== null && findAmmoBin(entity, weapon.id) === null) continue;
    preferred = Math.max(preferred, weapon.range.short);
  }

  return preferred;
}

export function runBasicAi(world: World, entity: MechEntity): void {
  if (!isOperational(entity) || entity.shutdownRemaining > 0) {
    entity.path = [];
    entity.pathIndex = 0;
    entity.motion = 'stationary';
    return;
  }

  const target = nearestEnemy(world, entity);
  entity.targetId = target?.id ?? null;

  if (target === null) {
    entity.path = [];
    entity.pathIndex = 0;
    entity.motion = 'stationary';
    return;
  }

  const range = distance(entity.pos, target.pos);
  const preferred = preferredRange(world, entity);
  const canSee = lineOfSight(world.terrain, entity.pos, target.pos).clear;

  // Holding at preferred range behind a building is a stalemate, not a firing position.
  if (range <= preferred && canSee) {
    entity.path = [];
    entity.pathIndex = 0;
    entity.motion = 'stationary';
    return;
  }

  if (entity.path.length === 0 || world.tick >= entity.nextPathTick) {
    entity.path = findPath(
      world.terrain,
      entity.pos,
      target.pos,
      world.rules.simulation.pathfindMaxNodes,
    ) ?? [];
    entity.pathIndex = 0;
    entity.nextPathTick = world.tick + world.rules.simulation.aiPathIntervalTicks;
  }

  entity.motion = entity.path.length === 0 ? 'stationary' : range > preferred * 2 ? 'run' : 'walk';
}
