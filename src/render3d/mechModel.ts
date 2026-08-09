import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import type { MechLocation } from '../schema/common';
import type { WeaponType } from '../schema/weapon';
import type { Silhouette } from '../render/shape';
import { radiusFor } from '../render/shape';
import { mix, shade } from '../render/palette';

export interface MountArt {
  location: MechLocation;
  type: WeaponType;
  tonnage: number;
}

export interface MechModel {
  root: Group;
  /** Turns with the torso; the legs stay with the hull. */
  torso: Group;
  /** Metres from the ground to the top of the hull, for HUD markers. */
  height: number;
}

const WEAPON_COLOURS: Record<WeaponType, number> = {
  energy: 0x7fd4ff,
  ballistic: 0xd8c48a,
  missile: 0xff9a6b,
};

function panel(colour: number): MeshLambertMaterial {
  return new MeshLambertMaterial({ color: colour, flatShading: true });
}

function box(
  width: number,
  height: number,
  depth: number,
  material: MeshLambertMaterial,
  at: [number, number, number],
): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = true;
  return mesh;
}

/**
 * A mech built out of the same silhouette numbers the flat art used, so a
 * Colossus still reads as a Colossus once it has depth. Nothing here is a
 * loaded model: the geometry is generated per chassis and shared between every
 * mech of that chassis and team.
 *
 * The hull faces +X, matching a facing of zero in the simulation.
 */
export function buildMechModel(
  shape: Silhouette,
  tonnage: number,
  team: number,
  mounts: readonly MountArt[],
): MechModel {
  const radius = radiusFor(tonnage);
  const steel = 0x555f66;
  const plate = panel(mix(steel, team, 0.5));
  const deep = panel(shade(mix(steel, team, 0.5), 0.62));
  const trim = panel(shade(team, 1.45));

  const root = new Group();
  const torso = new Group();

  const legLength = radius * 0.95 * shape.legLength;
  const hip = radius * 0.4 * shape.stance;
  const long = radius * 1.05 * shape.torsoLength;
  const wide = radius * 0.9 * shape.torsoWidth;
  const shoulder = radius * 0.62 * shape.shoulder;

  // ------------------------------------------------------------------ legs
  const squat = shape.form === 'siege' || shape.form === 'squat';
  const digitigrade = shape.form === 'bird' || shape.form === 'scout';

  for (const side of [-1, 1]) {
    const thighHeight = legLength * (digitigrade ? 0.5 : 0.58);
    const shinHeight = legLength * (digitigrade ? 0.55 : 0.46);

    root.add(box(radius * 0.3, thighHeight, radius * 0.32, deep, [
      digitigrade ? -radius * 0.12 : 0,
      legLength - thighHeight / 2,
      side * hip,
    ]));
    root.add(box(radius * 0.26, shinHeight, radius * 0.28, plate, [
      digitigrade ? radius * 0.1 : 0,
      shinHeight / 2,
      side * hip,
    ]));
    // Foot, wide enough to look like it carries the tonnage.
    root.add(box(radius * 0.5, radius * 0.14, radius * 0.34, deep, [
      radius * 0.08,
      radius * 0.07,
      side * hip,
    ]));
  }

  // ----------------------------------------------------------------- torso
  const hullHeight = radius * (squat ? 0.62 : 0.78);
  const hull = box(long, hullHeight, wide, plate, [0, 0, 0]);
  torso.add(hull);

  // A canted glacis at the front, so the nose reads as the nose from above.
  const glacis = box(long * 0.3, hullHeight * 0.62, wide * 0.78, trim, [
    long * 0.42,
    hullHeight * 0.1,
    0,
  ]);
  glacis.rotation.z = -0.35;
  torso.add(glacis);

  // Cockpit: the one part that says which way it is looking.
  const cockpit = new Mesh(new SphereGeometry(radius * 0.2, 10, 8), panel(0x9fdcff));
  cockpit.position.set(long * 0.3, hullHeight * 0.55, 0);
  torso.add(cockpit);

  // ------------------------------------------------------------------ arms
  const armLength = long * 0.9;
  for (const side of [-1, 1]) {
    const arm = box(armLength, radius * 0.26, radius * 0.26, deep, [
      long * 0.12,
      -hullHeight * 0.1,
      side * shoulder,
    ]);
    torso.add(arm);
    torso.add(box(radius * 0.22, radius * 0.34, radius * 0.34, plate, [
      -long * 0.22,
      -hullHeight * 0.05,
      side * shoulder,
    ]));
  }

  // --------------------------------------------------------------- weapons
  // What the mech is carrying, bolted where the design says it is carried.
  const perLocation = new Map<MechLocation, number>();
  for (const mount of mounts) {
    const seen = perLocation.get(mount.location) ?? 0;
    perLocation.set(mount.location, seen + 1);

    const anchor = weaponAnchor(mount.location, long, wide, shoulder, hullHeight);
    if (anchor === null) continue;

    const bore = radius * (0.06 + Math.min(0.1, mount.tonnage * 0.008));
    const barrel = new Mesh(
      new CylinderGeometry(bore, bore * 1.15, long * 0.7, 7),
      panel(WEAPON_COLOURS[mount.type]),
    );
    // Cylinders stand up by default; lay it along the hull's nose.
    barrel.rotation.z = -Math.PI / 2;
    barrel.position.set(
      anchor[0] + long * 0.3,
      anchor[1] + seen * radius * 0.12,
      anchor[2],
    );
    barrel.castShadow = true;
    torso.add(barrel);
  }

  torso.position.y = legLength + hullHeight * 0.5;
  root.add(torso);

  return { root, torso, height: legLength + hullHeight * 1.2 };
}

/** Where on the hull a mount of this location hangs, or null if it is not visible. */
function weaponAnchor(
  location: MechLocation,
  long: number,
  wide: number,
  shoulder: number,
  hullHeight: number,
): [number, number, number] | null {
  switch (location) {
    case 'left_arm':
      return [long * 0.2, -hullHeight * 0.1, -shoulder];
    case 'right_arm':
      return [long * 0.2, -hullHeight * 0.1, shoulder];
    case 'left_torso':
      return [0, hullHeight * 0.3, -wide * 0.42];
    case 'right_torso':
      return [0, hullHeight * 0.3, wide * 0.42];
    case 'centre_torso':
      return [0, hullHeight * 0.42, 0];
    default:
      return null;
  }
}

/** Frees the geometry a model owns. Materials are shared and left alone. */
export function disposeModel(root: Object3D): void {
  root.traverse((child) => {
    if (child instanceof Mesh) child.geometry.dispose();
  });
}
