import type { Graphics } from 'pixi.js';
import type { Chassis } from '../schema/chassis';
import type { MechEntity } from '../sim/types';
import { shade } from './palette';

export type Silhouette = Chassis['silhouette'];

export const DEFAULT_SILHOUETTE: Silhouette = {
  form: 'humanoid',
  torsoLength: 1,
  torsoWidth: 1,
  shoulder: 1,
  legLength: 1,
  stance: 1,
};

/**
 * Size reads before shape does, so the spread is wide and linear in tonnage:
 * a 25-tonne scout comes out at half the width of a hundred-tonne assault.
 */
export function radiusFor(tonnage: number): number {
  return 8 + tonnage * 0.14;
}

type Fill = { color: number; alpha: number };

/** Everything is drawn nose-first along +x; the container carries the facing. */
export function drawLegs(
  hull: Graphics,
  entity: MechEntity,
  shape: Silhouette,
  radius: number,
  fill: Fill,
): void {
  const spread = 0.42 * radius * shape.stance;
  const reach = 0.55 * radius * shape.legLength;
  const thickness = 0.3 * radius * shape.stance;

  const leg = (side: number, destroyed: boolean): void => {
    if (destroyed) return;
    const y = side * spread;

    if (shape.form === 'bird' || shape.form === 'scout') {
      // Reverse-jointed: thigh rakes back, shin drives forward to a splayed foot.
      hull
        .poly([
          -0.15 * radius, y - thickness * 0.35,
          -reach * 1.1, y - thickness * 0.2,
          -reach * 0.95, y + thickness * 0.35,
          -0.1 * radius, y + thickness * 0.4,
        ])
        .fill(fill);
      hull.rect(-reach * 1.25, y - thickness * 0.5, reach * 0.5, thickness).fill(fill);
      return;
    }

    if (shape.form === 'siege' || shape.form === 'squat') {
      // Short, wide, planted — a firing platform rather than a walker.
      hull.rect(-reach * 0.9, y - thickness * 0.7, reach * 1.1, thickness * 1.4).fill(fill);
      hull.rect(-reach * 1.15, y - thickness * 0.85, reach * 0.4, thickness * 1.7).fill(fill);
      return;
    }

    hull.rect(-reach, y - thickness * 0.5, reach * 1.15, thickness).fill(fill);
  };

  leg(-1, entity.locations.left_leg.destroyed);
  leg(1, entity.locations.right_leg.destroyed);
}

export function drawTorso(
  body: Graphics,
  entity: MechEntity,
  shape: Silhouette,
  radius: number,
  fill: Fill,
  colour: number,
  alpha: number,
): void {
  const long = radius * shape.torsoLength;
  const wide = 0.46 * radius * shape.torsoWidth;
  const shoulder = 0.62 * radius * shape.shoulder;

  const arm = (side: number, destroyed: boolean): void => {
    if (destroyed) return;
    const y = side * shoulder;
    const depth = 0.26 * radius * shape.shoulder;

    if (shape.form === 'siege' || shape.form === 'squat') {
      // Weapon blocks rather than arms: the guns are the shoulders.
      body.rect(-0.25 * long, y - depth, 0.95 * long, depth * 2).fill(fill);
      body.rect(0.55 * long, y - depth * 0.6, 0.35 * long, depth * 1.2)
        .fill({ color: shade(colour, 1.25), alpha });
      return;
    }

    body.rect(-0.2 * long, y - depth * 0.7, 0.85 * long, depth * 1.4).fill(fill);
  };

  arm(-1, entity.locations.left_arm.destroyed);
  arm(1, entity.locations.right_arm.destroyed);

  switch (shape.form) {
    case 'scout':
      body.poly([-0.5 * long, -wide * 0.7, 0.55 * long, -wide * 0.5,
        0.95 * long, 0, 0.55 * long, wide * 0.5, -0.5 * long, wide * 0.7]).fill(fill);
      // Sensor mast — the reason a scout is worth its tonnage.
      body.rect(-0.45 * long, -0.06 * radius, 0.28 * long, 0.12 * radius)
        .fill({ color: shade(colour, 1.6), alpha });
      break;

    case 'bird':
      // Forward-leaning cockpit block over a tapered body.
      body.poly([-0.55 * long, -wide * 0.55, 0.35 * long, -wide, 1.0 * long, -wide * 0.3,
        1.0 * long, wide * 0.3, 0.35 * long, wide, -0.55 * long, wide * 0.55]).fill(fill);
      break;

    case 'squat':
      body.rect(-0.55 * long, -wide, 1.35 * long, wide * 2).fill(fill);
      body.poly([0.8 * long, -wide, 1.15 * long, -wide * 0.45,
        1.15 * long, wide * 0.45, 0.8 * long, wide]).fill(fill);
      break;

    case 'siege':
      body.rect(-0.6 * long, -wide, 1.3 * long, wide * 2).fill(fill);
      // Mantlet: a slab of armour bolted across the front.
      body.rect(0.7 * long, -wide * 1.05, 0.3 * long, wide * 2.1)
        .fill({ color: shade(colour, 0.8), alpha });
      break;

    default:
      body.poly([-0.5 * long, -wide * 0.8, 0.5 * long, -wide,
        0.95 * long, 0, 0.5 * long, wide, -0.5 * long, wide * 0.8]).fill(fill);
      break;
  }

  body.stroke({ width: 1, color: 0x000000, alpha: 0.45 });

  const cockpit = entity.locations.head.destroyed ? 0x772222 : shade(colour, 1.4);
  const cockpitX = shape.form === 'bird' ? 0.6 * long : 0.42 * long;
  body.circle(cockpitX, 0, 0.17 * radius).fill({ color: cockpit, alpha });

  // Nose flash so facing reads at a glance even on the widest hulls.
  body
    .poly([0.95 * long, -0.12 * radius, 1.35 * long, 0, 0.95 * long, 0.12 * radius])
    .fill({ color: shade(colour, 1.55), alpha });
}
