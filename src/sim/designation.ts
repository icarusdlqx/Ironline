import { lineOfSight } from './los';
import { distance } from './math';
import { findEntity, isOperational, type World } from './types';

/**
 * TAG and NARC paint a target for the whole lance rather than for the carrier
 * alone — that is the entire point of carrying one. TAG needs to keep the beam
 * on; a NARC pod stays stuck to the hull long after the spotter has moved on.
 */
export function updateDesignation(world: World): void {
  for (const spotter of world.entities) {
    if (spotter.designatorRange <= 0 || !isOperational(spotter)) continue;
    if (spotter.shutdownRemaining > 0) continue;

    const target = findEntity(world, spotter.targetId);
    if (target === null || !isOperational(target)) continue;
    if (distance(spotter.pos, target.pos) > spotter.designatorRange) continue;
    if (!lineOfSight(world.terrain, spotter.pos, target.pos).clear) continue;

    const until = world.tick + Math.round(spotter.designatorSeconds / world.dt);
    if (until > target.designatedUntilTick) target.designatedUntilTick = until;
  }
}

export function isDesignated(world: World, entityId: number): boolean {
  const entity = findEntity(world, entityId);
  return entity !== null && world.tick <= entity.designatedUntilTick;
}
