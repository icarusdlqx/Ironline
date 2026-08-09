import type { Graphics } from 'pixi.js';
import type { MechLocation } from '../schema/common';
import type { Chassis } from '../schema/chassis';
import type { WeaponType } from '../schema/weapon';
import type { MechEntity } from '../sim/types';
import { shade } from './palette';

export type Silhouette = Chassis['silhouette'];

export interface MountArt {
  location: MechLocation;
  type: WeaponType;
  /** Weapon tonnage, which drives how much hardware is visible. */
  tonnage: number;
  destroyed: boolean;
}

export type WeaponArtLookup = (weaponId: string) => { type: WeaponType; tonnage: number } | undefined;

export const DEFAULT_SILHOUETTE: Silhouette = {
  form: 'humanoid',
  torsoLength: 1,
  torsoWidth: 1,
  shoulder: 1,
  legLength: 1,
  stance: 1,
};

/** Size reads before shape: a 25-tonne scout is half the width of a hundred-tonne assault. */
export function radiusFor(tonnage: number): number {
  return 8 + tonnage * 0.14;
}

interface Palette {
  plate: number;
  deep: number;
  light: number;
  trim: number;
  alpha: number;
}

function paletteFor(entity: MechEntity, team: number, alpha: number): Palette {
  let current = 0;
  let maximum = 0;
  for (const state of Object.values(entity.locations)) {
    current += state.armour + state.internal;
    maximum += state.armourMax + state.internalMax;
  }
  const health = maximum === 0 ? 0 : current / maximum;

  // Hulls are Sarn plate, not team paint. The team shows in the trim, which is
  // how a lance is actually marked, and it reads far better against terrain.
  const base = entity.destroyed ? 0x2b2b2d : shade(0x555f66, 0.55 + 0.45 * health);
  return {
    plate: base,
    deep: shade(base, 0.6),
    light: shade(base, 1.45),
    trim: entity.destroyed ? 0x50494a : team,
    alpha,
  };
}

function fill(colour: number, alpha: number): { color: number; alpha: number } {
  return { color: colour, alpha };
}

// ---------------------------------------------------------------- legs

export function drawLegs(
  hull: Graphics,
  entity: MechEntity,
  shape: Silhouette,
  radius: number,
  team: number,
  alpha: number,
): void {
  const p = paletteFor(entity, team, alpha);
  const spread = 0.44 * radius * shape.stance;
  const reach = 0.6 * radius * shape.legLength;
  const width = 0.3 * radius * shape.stance;

  const leg = (side: number, destroyed: boolean): void => {
    if (destroyed) {
      // A severed hip stub, so a legged mech reads as legged.
      hull.rect(-0.1 * radius, side * spread - width * 0.4, 0.22 * radius, width * 0.8)
        .fill(fill(p.deep, alpha));
      return;
    }
    const y = side * spread;

    if (shape.form === 'bird' || shape.form === 'scout') {
      hull.poly([
        -0.05 * radius, y - width * 0.34,
        -reach * 0.95, y - width * 0.16,
        -reach * 0.82, y + width * 0.34,
        0.0, y + width * 0.38,
      ]).fill(fill(p.plate, alpha));
      hull.poly([
        -reach * 0.95, y - width * 0.2,
        -reach * 0.45, y - width * 0.52,
        -reach * 0.3, y + width * 0.1,
        -reach * 0.82, y + width * 0.34,
      ]).fill(fill(p.deep, alpha));
      hull.rect(-reach * 0.62, y - width * 0.62, reach * 0.42, width * 0.26).fill(fill(p.light, alpha));
      return;
    }

    if (shape.form === 'siege' || shape.form === 'squat') {
      hull.rect(-reach * 0.9, y - width * 0.72, reach * 1.05, width * 1.44).fill(fill(p.plate, alpha));
      hull.rect(-reach * 1.12, y - width * 0.92, reach * 0.42, width * 1.84).fill(fill(p.deep, alpha));
      // Knee blocks, the visual weight that makes an assault look planted.
      hull.rect(-reach * 0.34, y - width * 0.86, reach * 0.3, width * 1.72).fill(fill(p.light, alpha));
      return;
    }

    hull.rect(-reach * 0.95, y - width * 0.46, reach * 1.1, width * 0.92).fill(fill(p.plate, alpha));
    hull.rect(-reach * 0.5, y - width * 0.6, reach * 0.26, width * 1.2).fill(fill(p.light, alpha));
    hull.rect(-reach * 1.05, y - width * 0.6, reach * 0.3, width * 1.2).fill(fill(p.deep, alpha));
  };

  leg(-1, entity.locations.left_leg.destroyed);
  leg(1, entity.locations.right_leg.destroyed);

  // Hip yoke ties the legs together and marks the hull's true heading.
  hull.rect(-0.28 * radius, -spread * 0.95, 0.42 * radius, spread * 1.9).fill(fill(p.deep, alpha));
  hull.moveTo(0, 0).lineTo(1.25 * radius, 0)
    .stroke({ width: 1, color: p.trim, alpha: alpha * 0.35 });
}

// ---------------------------------------------------------------- weapons

/** Draws the hardware a mount actually represents, sized by its tonnage. */
function drawMount(body: Graphics, mount: MountArt, radius: number, p: Palette, shape: Silhouette): void {
  const long = radius * shape.torsoLength;
  const wide = 0.46 * radius * shape.torsoWidth;
  const heft = Math.min(1.6, 0.45 + mount.tonnage * 0.075);
  const colour = mount.destroyed ? p.deep : p.light;
  const a = p.alpha * (mount.destroyed ? 0.5 : 1);

  const side =
    mount.location === 'left_arm' || mount.location === 'left_torso'
      ? -1
      : mount.location === 'right_arm' || mount.location === 'right_torso'
        ? 1
        : 0;

  const armMount = mount.location === 'left_arm' || mount.location === 'right_arm';
  const y = side * (armMount ? 0.68 : 0.42) * radius * shape.shoulder;
  const rootX = armMount ? 0.35 * long : 0.1 * long;

  if (mount.type === 'missile') {
    // Launcher: a block of tubes. More tonnage, more tubes.
    const rows = mount.tonnage >= 7 ? 3 : 2;
    const columns = mount.tonnage >= 5 ? 3 : 2;
    const cell = 0.11 * radius * heft;
    body.rect(rootX, y - rows * cell, cell * columns * 2.1, rows * cell * 2).fill(fill(p.deep, a));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        body.circle(rootX + cell * (column * 2.1 + 1), y - rows * cell + cell * (row * 2 + 1), cell * 0.62)
          .fill(fill(colour, a));
      }
    }
    return;
  }

  if (mount.type === 'ballistic') {
    // Barrel plus receiver. A Gauss rifle should look like fifteen tonnes.
    const length = 0.5 * long * heft;
    const bore = 0.09 * radius * heft;
    body.rect(rootX - 0.1 * long, y - bore * 1.7, 0.3 * long, bore * 3.4).fill(fill(p.deep, a));
    body.rect(rootX, y - bore, length, bore * 2).fill(fill(colour, a));
    body.rect(rootX + length - bore * 0.8, y - bore * 1.5, bore * 1.6, bore * 3).fill(fill(p.light, a));
    return;
  }

  // Energy: a stubby emitter with a bright lens.
  const length = 0.3 * long * heft;
  const bore = 0.075 * radius * heft;
  body.rect(rootX, y - bore, length, bore * 2).fill(fill(p.deep, a));
  body.circle(rootX + length, y, bore * 1.25).fill(fill(mount.destroyed ? p.deep : p.trim, a));
  void wide;
}

// ---------------------------------------------------------------- torso

export function drawTorso(
  body: Graphics,
  entity: MechEntity,
  shape: Silhouette,
  radius: number,
  team: number,
  alpha: number,
  mounts: readonly MountArt[],
): void {
  const p = paletteFor(entity, team, alpha);
  const long = radius * shape.torsoLength;
  const wide = 0.46 * radius * shape.torsoWidth;
  const shoulder = 0.62 * radius * shape.shoulder;

  const arm = (side: number, destroyed: boolean): void => {
    if (destroyed) return;
    const y = side * shoulder;
    const depth = 0.24 * radius * shape.shoulder;

    if (shape.form === 'siege' || shape.form === 'squat') {
      body.rect(-0.3 * long, y - depth * 1.15, 1.0 * long, depth * 2.3).fill(fill(p.plate, alpha));
      body.rect(-0.3 * long, y - depth * 1.15, 0.22 * long, depth * 2.3).fill(fill(p.trim, alpha * 0.85));
      body.rect(0.2 * long, y - depth * 0.5, 0.55 * long, depth).fill(fill(p.deep, alpha));
      return;
    }

    body.rect(-0.24 * long, y - depth * 0.78, 0.82 * long, depth * 1.56).fill(fill(p.plate, alpha));
    body.rect(-0.24 * long, y - depth * 0.78, 0.16 * long, depth * 1.56).fill(fill(p.trim, alpha * 0.8));
  };

  arm(-1, entity.locations.left_arm.destroyed);
  arm(1, entity.locations.right_arm.destroyed);

  switch (shape.form) {
    case 'scout':
      body.poly([-0.55 * long, -wide * 0.62, 0.5 * long, -wide * 0.46,
        0.98 * long, 0, 0.5 * long, wide * 0.46, -0.55 * long, wide * 0.62]).fill(fill(p.plate, alpha));
      body.poly([-0.55 * long, -wide * 0.2, -0.1 * long, -wide * 0.3,
        -0.1 * long, wide * 0.3, -0.55 * long, wide * 0.2]).fill(fill(p.trim, alpha * 0.8));
      // Sensor mast: the reason the hull is worth its tonnage.
      body.rect(-0.62 * long, -0.05 * radius, 0.34 * long, 0.1 * radius).fill(fill(p.deep, alpha));
      body.circle(-0.66 * long, 0, 0.09 * radius).fill(fill(p.trim, alpha));
      break;

    case 'bird':
      body.poly([-0.6 * long, -wide * 0.5, 0.3 * long, -wide * 0.98, 1.05 * long, -wide * 0.26,
        1.05 * long, wide * 0.26, 0.3 * long, wide * 0.98, -0.6 * long, wide * 0.5])
        .fill(fill(p.plate, alpha));
      body.poly([0.3 * long, -wide * 0.98, 1.05 * long, -wide * 0.26, 0.75 * long, -wide * 0.2,
        0.2 * long, -wide * 0.6]).fill(fill(p.light, alpha * 0.55));
      // Intake stripes across the shoulders.
      body.rect(-0.36 * long, -wide * 0.75, 0.16 * long, wide * 1.5).fill(fill(p.trim, alpha * 0.85));
      break;

    case 'squat':
      body.rect(-0.6 * long, -wide, 1.4 * long, wide * 2).fill(fill(p.plate, alpha));
      body.poly([0.8 * long, -wide, 1.18 * long, -wide * 0.4,
        1.18 * long, wide * 0.4, 0.8 * long, wide]).fill(fill(p.light, alpha * 0.6));
      body.rect(-0.6 * long, -wide, 0.2 * long, wide * 2).fill(fill(p.trim, alpha * 0.85));
      // Armour skirt over the hips.
      body.rect(-0.72 * long, -wide * 0.72, 0.16 * long, wide * 1.44).fill(fill(p.deep, alpha));
      break;

    case 'siege':
      body.rect(-0.68 * long, -wide, 1.36 * long, wide * 2).fill(fill(p.plate, alpha));
      // Mantlet: the slab bolted over the glazing everybody shoots at.
      body.rect(0.6 * long, -wide * 1.12, 0.34 * long, wide * 2.24).fill(fill(p.deep, alpha));
      body.rect(0.66 * long, -wide * 0.9, 0.1 * long, wide * 1.8).fill(fill(p.light, alpha * 0.7));
      body.rect(-0.68 * long, -wide * 0.9, 0.18 * long, wide * 1.8).fill(fill(p.trim, alpha * 0.9));
      // Exhaust stacks.
      body.rect(-0.8 * long, -wide * 0.55, 0.16 * long, wide * 0.3).fill(fill(p.deep, alpha));
      body.rect(-0.8 * long, wide * 0.25, 0.16 * long, wide * 0.3).fill(fill(p.deep, alpha));
      break;

    default:
      body.poly([-0.55 * long, -wide * 0.82, 0.45 * long, -wide,
        0.95 * long, 0, 0.45 * long, wide, -0.55 * long, wide * 0.82]).fill(fill(p.plate, alpha));
      body.rect(-0.55 * long, -wide * 0.5, 0.2 * long, wide).fill(fill(p.trim, alpha * 0.85));
      body.rect(0.1 * long, -wide * 0.86, 0.3 * long, wide * 0.2).fill(fill(p.deep, alpha));
      body.rect(0.1 * long, wide * 0.66, 0.3 * long, wide * 0.2).fill(fill(p.deep, alpha));
      break;
  }

  body.stroke({ width: 1, color: 0x05070a, alpha: alpha * 0.75 });

  for (const mount of mounts) drawMount(body, mount, radius, p, shape);

  // Cockpit last so nothing paints over it — the eye lands here first.
  const dead = entity.locations.head.destroyed;
  const cockpitX = shape.form === 'bird' ? 0.62 * long : shape.form === 'siege' ? 0.5 * long : 0.46 * long;
  body.circle(cockpitX, 0, 0.2 * radius).fill(fill(dead ? 0x3a1414 : p.deep, alpha));
  body.circle(cockpitX, 0, 0.13 * radius)
    .fill(fill(dead ? 0x8c2b2b : shade(p.trim, 1.5), alpha));
}
