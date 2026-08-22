import { LOCATIONS } from '../schema/common';
import type { Faction } from '../schema/faction';
import { angleDifference, clamp, normaliseAngle } from '../sim/math';
import type { MechEntity, World } from '../sim/types';
import { damageWearTier } from './damageLedger';
import { machineCulture } from './machineCulture';

export interface VisualPose {
  x: number;
  y: number;
  facing: number;
  torso: number;
}

export interface VisualMotionSample {
  prev: VisualPose;
  cur: VisualPose;
}

export function modelDamageSignature(entity: MechEntity, faction: Faction): number {
  let bits = (entity.destroyed ? 17 : 7) ^ (entity.team + 1);
  if (!machineCulture(faction).revealsFieldDamage) return bits >>> 0;

  for (let index = 0; index < LOCATIONS.length; index += 1) {
    const location = LOCATIONS[index];
    if (location === undefined) continue;
    const state = entity.locations[location];
    const mark = damageWearTier(state) + (state.destroyed ? 4 : 0);
    bits = Math.imul(bits ^ ((index + 1) * 11 + mark), 16777619);
  }
  for (let index = 0; index < entity.weapons.length; index += 1) {
    if (entity.weapons[index]?.destroyed === true) bits = Math.imul(bits ^ (index + 17), 16777619);
  }
  return bits >>> 0;
}

export function writeInterpolatedPose(
  out: VisualPose,
  sample: VisualMotionSample,
  alpha: number,
  faction: Faction,
): void {
  out.x = sample.prev.x + (sample.cur.x - sample.prev.x) * alpha;
  out.y = sample.prev.y + (sample.cur.y - sample.prev.y) * alpha;
  out.facing = normaliseAngle(
    sample.prev.facing + angleDifference(sample.prev.facing, sample.cur.facing) * alpha,
  );
  out.torso = machineCulture(faction).instantTorsoTracking
    ? sample.cur.torso
    : sample.prev.torso + (sample.cur.torso - sample.prev.torso) * alpha;
}

export function sealedTargetOffset(
  world: World,
  entity: MechEntity,
  displayed: VisualPose,
): number {
  if (
    !machineCulture(world.catalog.chassis.get(entity.chassisId)?.faction ?? 'linewrought')
      .instantTorsoTracking ||
    entity.destroyed ||
    entity.shutdownRemaining > 0 ||
    entity.downRemaining > 0 ||
    entity.targetId === null
  ) return entity.torsoOffset;

  let target: MechEntity | null = null;
  for (const candidate of world.entities) {
    if (candidate.id === entity.targetId) {
      target = candidate;
      break;
    }
  }
  if (target === null || target.destroyed || target.withdrawn) return entity.torsoOffset;
  const targetBearing = Math.atan2(target.pos.y - displayed.y, target.pos.x - displayed.x);
  return clamp(
    angleDifference(displayed.facing, targetBearing),
    -entity.twistLimit,
    entity.twistLimit,
  );
}
