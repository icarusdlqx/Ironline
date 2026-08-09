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
import { chassisBlueprint, type BlueprintPart, type Tone } from '../render/blueprint';
import type { Silhouette } from '../render/shape';
import { radiusFor } from '../render/shape';
import { mix, shade } from '../render/palette';

export interface MountArt {
  location: MechLocation;
  type: WeaponType;
  tonnage: number;
  /** Missile racks are boxes of tubes; the rest are barrels. */
  projectiles: number;
}

export interface MechModel {
  root: Group;
  /** Turns with the torso; the legs stay with the hull. */
  torso: Group;
  /** Metres from the ground to the top of the hull, for HUD markers. */
  height: number;
}

const WEAPON_COLOURS: Record<WeaponType, number> = {
  energy: 0x9fe6ff,
  ballistic: 0xcfd6dc,
  missile: 0xffb08a,
};

function palette(team: number, destroyed: boolean): Record<Tone, MeshLambertMaterial> {
  const steel = destroyed ? 0x2b2b2d : mix(0x555f66, team, 0.5);
  const make = (colour: number): MeshLambertMaterial =>
    new MeshLambertMaterial({ color: colour, flatShading: true });

  return {
    plate: make(steel),
    deep: make(shade(steel, 0.62)),
    trim: make(destroyed ? 0x50494a : shade(team, 1.4)),
    glass: make(destroyed ? 0x2c3136 : 0x9fdcff),
    accent: make(destroyed ? 0x3a3a3c : shade(steel, 1.5)),
  };
}

function geometryFor(part: BlueprintPart, scale: number): BoxGeometry | CylinderGeometry | SphereGeometry {
  const [w, h, d] = part.size;
  if (part.shape === 'cylinder') {
    return new CylinderGeometry((w * scale) / 2, (w * scale) / 2, h * scale, 8);
  }
  if (part.shape === 'sphere') return new SphereGeometry((w * scale) / 2, 10, 8);
  return new BoxGeometry(w * scale, h * scale, d * scale);
}

/**
 * The mech as the blueprint describes it, at battlefield scale. The blueprint
 * is shared with the mechbay, so the machine the player kits out in the bay is
 * the same shape as the one that walks onto the field.
 *
 * The hull faces +X, matching a facing of zero in the simulation.
 */
export function buildMechModel(
  shape: Silhouette,
  traits: readonly string[],
  tonnage: number,
  team: number,
  destroyed: boolean,
  mounts: readonly MountArt[],
): MechModel {
  const scale = radiusFor(tonnage);
  const plan = chassisBlueprint(shape, traits);
  const tones = palette(team, destroyed);

  const root = new Group();
  const torso = new Group();

  for (const part of plan.parts) {
    const mesh = new Mesh(geometryFor(part, scale), tones[part.tone]);
    mesh.position.set(part.at[0] * scale, part.at[1] * scale, part.at[2] * scale);
    if (part.tilt !== undefined) mesh.rotation.z = part.tilt;
    mesh.castShadow = true;

    // Legs and hips stay with the hull; everything above the waist turns.
    if (part.location === 'left_leg' || part.location === 'right_leg' || part.location === null) {
      root.add(mesh);
    } else {
      torso.add(mesh);
    }
  }

  // --------------------------------------------------------------- weapons
  const stacked = new Map<MechLocation, number>();
  for (const mount of mounts) {
    const anchor = plan.hardpoints[mount.location];
    if (anchor === undefined) continue;

    const index = stacked.get(mount.location) ?? 0;
    stacked.set(mount.location, index + 1);

    const material = new MeshLambertMaterial({
      color: WEAPON_COLOURS[mount.type],
      flatShading: true,
    });
    const heft = 0.5 + Math.min(1, mount.tonnage / 14);
    const piece = weaponPiece(mount, heft, scale, material);

    piece.position.set(
      anchor[0] * scale,
      (anchor[1] + index * 0.22) * scale,
      anchor[2] * scale,
    );
    piece.castShadow = true;
    torso.add(piece);
  }

  torso.position.y = plan.torsoY * scale;
  root.add(torso);

  return { root, torso, height: plan.height * scale };
}

/** A gun that looks like its kind: a barrel, a heavy tube, or a rack of cells. */
function weaponPiece(
  mount: MountArt,
  heft: number,
  scale: number,
  material: MeshLambertMaterial,
): Mesh {
  if (mount.type === 'missile') {
    // A launcher is a box of tubes, and a bigger rack is a bigger box.
    const cells = Math.max(2, Math.min(6, Math.round(Math.sqrt(mount.projectiles))));
    const mesh = new Mesh(
      new BoxGeometry(0.3 * heft * scale, 0.12 * cells * scale, 0.14 * cells * scale),
      material,
    );
    return mesh;
  }

  const bore = (mount.type === 'ballistic' ? 0.09 : 0.06) * heft * scale;
  const length = (mount.type === 'ballistic' ? 0.95 : 0.75) * heft * scale;
  const mesh = new Mesh(new CylinderGeometry(bore, bore * 1.2, length, 8), material);
  // Cylinders stand up by default; lay it along the hull's nose.
  mesh.rotation.z = -Math.PI / 2;
  return mesh;
}

/** Frees the geometry and materials a model owns. */
export function disposeModel(root: Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) child.material.forEach((entry) => entry.dispose());
    else child.material.dispose();
  });
}
