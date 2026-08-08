import type { DifficultyTier } from '../../schema/rules';
import { coverFactorAt, lineOfSight } from '../los';
import { angleDifference, bearing, distance } from '../math';
import { nearestPassable } from '../pathfind';
import { isOperational, type MechEntity, type Vec2, type World } from '../types';
import { exchangeRatio, expectedDps, healthFraction, preferredRange } from './utility';

const DEGREES_TO_RADIANS = Math.PI / 180;

export type Stance = 'close' | 'hold' | 'back_off' | 'withdraw';

export function stanceFor(
  world: World,
  mech: MechEntity,
  target: MechEntity,
  withdrawing: boolean,
): Stance {
  if (withdrawing) return 'withdraw';

  const rules = world.rules.ai.positioning;
  const range = distance(mech.pos, target.pos);
  const preferred = preferredRange(world, mech, target);

  if (range > preferred + rules.rangeTolerance) return 'close';
  if (range >= preferred - rules.rangeTolerance) return 'hold';

  // Inside the preferred bracket. Giving ground costs seconds of fire, and against
  // something that can match your stride it never opens the range at all — so only
  // back off when the exchange at arm's length is clearly better than this one.
  if (target.runSpeed >= mech.runSpeed) return 'hold';

  const here = exchangeRatio(world, mech, target, range);
  const there = exchangeRatio(world, mech, target, preferred);
  return there > here * rules.backOffAdvantage ? 'back_off' : 'hold';
}

interface Candidate {
  point: Vec2;
  score: number;
}

function passableAt(world: World, point: Vec2): boolean {
  const tile = world.terrain.toTile(point);
  return world.terrain.passable(tile.column, tile.row);
}

/** True when someone other than this mech already has the target's attention. */
function targetIsEngagedElsewhere(mech: MechEntity, target: MechEntity): boolean {
  return target.targetId !== null && target.targetId !== mech.id;
}

/**
 * Samples a ring of positions and picks the one that best serves the stance —
 * cover, elevation, the range bracket the guns want, and staying off the
 * target's nose when a lancemate already has its attention.
 */
export function choosePosition(
  world: World,
  mech: MechEntity,
  target: MechEntity,
  stance: Stance,
  tier: DifficultyTier,
): Vec2 | null {
  const rules = world.rules.ai.positioning;
  const preferred = preferredRange(world, mech, target);
  const step = rules.repositionStep;

  const candidates: Candidate[] = [];

  for (let index = 0; index < rules.candidateDirections; index += 1) {
    const angle = (index / rules.candidateDirections) * Math.PI * 2;
    const raw: Vec2 = {
      x: mech.pos.x + Math.cos(angle) * step,
      y: mech.pos.y + Math.sin(angle) * step,
    };

    const tile = world.terrain.toTile(raw);
    const snapped = nearestPassable(world.terrain, tile.column, tile.row, 2);
    if (snapped === null) continue;

    const point = world.terrain.tileCentre(snapped.column, snapped.row);
    if (!passableAt(world, point)) continue;

    const range = distance(point, target.pos);
    let score = 0;

    if (stance === 'withdraw') {
      const escape = world.rules.ai.withdrawal;
      score += range * escape.openRangeWeight;
      score += coverFactorAt(world.terrain, point) < 1 ? rules.coverWeight : 0;
      if (lineOfSight(world.terrain, point, target.pos).clear) score -= escape.concealmentBonus;
      candidates.push({ point, score });
      continue;
    }

    // How much better the guns do from there than from here. Out beyond weapon
    // reach every candidate scores zero, so closing distance carries the gradient.
    score += expectedDps(world, mech, target, range) * rules.dpsWeight;
    score -= Math.abs(range - preferred) * rules.rangeErrorWeight;
    if (stance === 'close') score -= range * rules.closingWeight;
    if (stance === 'back_off') score += range * rules.closingWeight;

    if (tier.coverSeeking) {
      score += (1 - coverFactorAt(world.terrain, point)) * rules.coverWeight;
      const tileRef = world.terrain.toTile(point);
      score +=
        world.terrain.elevationAt(tileRef.column, tileRef.row) * rules.elevationWeight;
    }

    if (!lineOfSight(world.terrain, point, target.pos).clear) score -= rules.losPenalty;

    if (tier.flanking && targetIsEngagedElsewhere(mech, target)) {
      const fromTarget = bearing(target.pos, point);
      const offNose = Math.abs(angleDifference(target.facing, fromTarget));
      if (offNose > rules.flankAngleDegrees * DEGREES_TO_RADIANS) score += rules.flankWeight;
    }

    for (const mate of world.entities) {
      if (mate.id === mech.id || mate.team !== mech.team || !isOperational(mate)) continue;
      if (distance(point, mate.pos) < rules.spacingRadius) score -= rules.spacingWeight;
    }

    candidates.push({ point, score });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best === undefined) return null;

  // Only bother moving if the destination is meaningfully better than standing still.
  if (stance === 'hold' && distance(best.point, mech.pos) < step * 0.5) return null;
  return best.point;
}

/** What a side still brings to the fight: how many mechs, weighted by how whole they are. */
function teamStrength(world: World, team: number): number {
  let total = 0;
  for (const entity of world.entities) {
    if (entity.team !== team || !isOperational(entity)) continue;
    total += healthFraction(entity);
  }
  return total;
}

/** True when nothing still fighting could catch this mech if it ran. */
function canOutrunPursuit(world: World, mech: MechEntity): boolean {
  let pursuers = 0;
  for (const enemy of world.entities) {
    if (enemy.team === mech.team || !isOperational(enemy)) continue;
    pursuers += 1;
    if (enemy.runSpeed >= mech.runSpeed) return false;
  }
  return pursuers > 0;
}

/**
 * Being hurt is not a reason to leave — losing is. A crippled mech in a lance
 * that is still winning falls back behind its friends and keeps shooting; it
 * only quits the field once its side no longer has the strength to finish.
 *
 * The exception is the scout. A mech nothing on the field can catch has an exit
 * available that a heavy does not, and spending it is free: it costs the lance
 * a body it was about to lose anyway.
 */
export function shouldWithdraw(
  world: World,
  mech: MechEntity,
  currentlyWithdrawing: boolean,
  structure: number,
): boolean {
  const rules = world.rules.ai.withdrawal;
  const threshold = currentlyWithdrawing ? rules.resumeStructureFraction : rules.structureFraction;
  if (structure >= threshold) return false;

  if (canOutrunPursuit(world, mech)) return true;

  const mine = teamStrength(world, mech.team);
  let theirs = 0;
  for (const team of new Set(world.entities.map((entity) => entity.team))) {
    if (team !== mech.team) theirs += teamStrength(world, team);
  }

  return mine < theirs * rules.losingStrengthRatio;
}

export function withdrawalPoint(world: World, mech: MechEntity): Vec2 {
  const enemies = world.entities.filter(
    (entity) => entity.team !== mech.team && isOperational(entity),
  );
  if (enemies.length === 0) return { x: mech.pos.x, y: mech.pos.y };

  let awayX = 0;
  let awayY = 0;
  for (const enemy of enemies) {
    awayX += mech.pos.x - enemy.pos.x;
    awayY += mech.pos.y - enemy.pos.y;
  }

  const length = Math.hypot(awayX, awayY) || 1;
  const reach = world.rules.ai.positioning.repositionStep * 3;

  const extent = {
    x: world.terrain.width * world.terrain.tileSize,
    y: world.terrain.height * world.terrain.tileSize,
  };

  return {
    x: Math.max(10, Math.min(extent.x - 10, mech.pos.x + (awayX / length) * reach)),
    y: Math.max(10, Math.min(extent.y - 10, mech.pos.y + (awayY / length) * reach)),
  };
}
