import { distance } from '../math';
import { setGroupEnabled } from '../orders';
import { findPath } from '../pathfind';
import { isVisibleTo } from '../sensors';
import { isOperational, type MechEntity, type World } from '../types';
import { preferredRange } from './utility';

/**
 * The reference for competent play: pick the nearest thing you can see, manage
 * your range bracket, and stop shooting before you cook yourself. No cover
 * work, no focus fire, no flanking, no withdrawal — everything the tactical
 * controller adds on top is what Phase 6 is measuring.
 */
export function decideBaseline(world: World, mech: MechEntity): void {
  if (!isOperational(mech) || mech.shutdownRemaining > 0) {
    mech.path = [];
    mech.pathIndex = 0;
    mech.motion = 'stationary';
    return;
  }

  let target: MechEntity | null = null;
  let bestRange = Number.POSITIVE_INFINITY;

  for (const candidate of world.entities) {
    if (candidate.team === mech.team || !isOperational(candidate)) continue;
    if (world.vision?.team === mech.team && !isVisibleTo(world.vision, candidate)) continue;

    const range = distance(mech.pos, candidate.pos);
    if (range < bestRange) {
      target = candidate;
      bestRange = range;
    }
  }

  if (target === null) {
    mech.targetId = null;
    mech.path = [];
    mech.pathIndex = 0;
    mech.motion = 'stationary';
    return;
  }

  mech.targetId = target.id;
  mech.calledShot = null;

  const heatFraction = mech.heat / mech.heatCapacity;
  const heatRules = world.rules.ai.heat;

  if (mech.ai.coolingDown) {
    if (heatFraction <= heatRules.resumeFraction) {
      mech.ai.coolingDown = false;
      for (let group = 1; group <= mech.groupEnabled.length; group += 1) {
        setGroupEnabled(mech, group, true);
      }
    }
  } else if (heatFraction >= heatRules.holdFireFraction) {
    mech.ai.coolingDown = true;
    for (let group = 1; group <= mech.groupEnabled.length; group += 1) {
      setGroupEnabled(mech, group, false);
    }
  }

  const preferred = preferredRange(world, mech, target);
  const tolerance = world.rules.ai.positioning.rangeTolerance;

  if (Math.abs(bestRange - preferred) <= tolerance) {
    mech.path = [];
    mech.pathIndex = 0;
    mech.motion = 'stationary';
    return;
  }

  const toward = bestRange > preferred;
  const step = world.rules.ai.positioning.repositionStep;
  const dx = (target.pos.x - mech.pos.x) / (bestRange || 1);
  const dy = (target.pos.y - mech.pos.y) / (bestRange || 1);
  const sign = toward ? 1 : -1;

  const destination = toward
    ? { x: target.pos.x, y: target.pos.y }
    : { x: mech.pos.x + dx * sign * step, y: mech.pos.y + dy * sign * step };

  const path = findPath(
    world.terrain,
    mech.pos,
    destination,
    world.rules.simulation.pathfindMaxNodes,
  );

  mech.path = path ?? [];
  mech.pathIndex = 0;
  mech.nextPathTick = world.tick + world.rules.simulation.aiPathIntervalTicks;
  mech.motion =
    mech.path.length === 0 ? 'stationary' : bestRange > preferred * 2 ? 'run' : 'walk';
}
