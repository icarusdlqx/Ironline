import {
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { chamferedBox, hullSlab, taperedLimb } from './panels';
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

/**
 * Painted steel, not plastic. A little metalness with a lot of roughness gives
 * the plates a gradient across a curved edge instead of one flat tone, which is
 * what stops chamfered geometry from looking like a flat-shaded box anyway.
 */
function palette(team: number, destroyed: boolean): Record<Tone, MeshStandardMaterial> {
  const steel = destroyed ? 0x2b2b2d : mix(0x555f66, team, 0.5);
  const make = (colour: number, roughness: number, metalness: number): MeshStandardMaterial =>
    new MeshStandardMaterial({ color: colour, roughness, metalness });

  return {
    plate: make(steel, 0.62, 0.35),
    deep: make(shade(steel, 0.62), 0.72, 0.3),
    trim: make(destroyed ? 0x50494a : shade(team, 1.4), 0.5, 0.45),
    glass: make(destroyed ? 0x2c3136 : 0x9fdcff, 0.15, 0.1),
    accent: make(destroyed ? 0x3a3a3c : shade(steel, 1.5), 0.45, 0.6),
  };
}

function geometryFor(part: BlueprintPart, scale: number): BufferGeometry {
  const [w, h, d] = part.size;
  // A shaped plate is cut to its own outline. Everything else falls back to
  // the primitives, so a part only pays for a profile when it earns one.
  if (part.profile !== undefined) {
    return hullSlab(
      part.profile.map(([x, y]) => [x * w * scale, y * h * scale] as [number, number]),
      d * scale,
    );
  }
  if (part.shape === 'cylinder') {
    return new CylinderGeometry((w * scale) / 2, (w * scale) / 2, h * scale, 12);
  }
  if (part.shape === 'sphere') return new SphereGeometry((w * scale) / 2, 16, 12);
  if (part.shape === 'limb') return taperedLimb((w * scale) / 2, (d * scale) / 2, h * scale);
  return chamferedBox(w * scale, h * scale, d * scale);
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
  /** Locations shot off. Limbs go missing; the rest is left burnt in place. */
  lost: ReadonlySet<MechLocation> = new Set(),
): MechModel {
  const scale = radiusFor(tonnage);
  const plan = chassisBlueprint(shape, traits);
  const tones = palette(team, destroyed);
  const burnt = palette(team, true);

  const root = new Group();
  const torso = new Group();

  for (const part of plan.parts) {
    // An arm or a head that has been blown off is gone: nothing tells a player
    // a mech has stopped being dangerous like watching the arm leave. A torso
    // or a leg stays — the machine is standing on it — but it stays burnt.
    const gone = part.location !== null && lost.has(part.location);
    const shed = gone && (part.location === 'left_arm' || part.location === 'right_arm' || part.location === 'head');
    if (shed) continue;

    const mesh = new Mesh(geometryFor(part, scale), gone ? burnt[part.tone] : tones[part.tone]);
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

    const material = new MeshStandardMaterial({
      color: WEAPON_COLOURS[mount.type],
      roughness: 0.4,
      metalness: 0.55,
    });
    const heft = 0.5 + Math.min(1, mount.tonnage / 14);
    const piece = weaponPiece(mount, heft, scale, material);
    piece.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = true;
    });

    piece.position.set(
      anchor[0] * scale,
      (anchor[1] + index * 0.22) * scale,
      anchor[2] * scale,
    );
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
  material: MeshStandardMaterial,
): Group {
  const piece = new Group();

  if (mount.type === 'missile') {
    // A launcher is a box of tubes, and a bigger rack is a bigger box. The
    // tube faces are drilled in so it reads as a launcher and not a crate.
    const cells = Math.max(2, Math.min(5, Math.round(Math.sqrt(mount.projectiles))));
    const height = 0.13 * cells * scale;
    const width = 0.15 * cells * scale;
    const body = new Mesh(chamferedBox(0.34 * heft * scale, height, width), material);
    piece.add(body);

    const bore = Math.min(height, width) / (cells * 2.4);
    for (let row = 0; row < cells; row += 1) {
      for (let column = 0; column < cells; column += 1) {
        const tube = new Mesh(new CylinderGeometry(bore, bore, 0.08 * scale, 6), MUZZLE_MATERIAL);
        tube.rotation.z = -Math.PI / 2;
        tube.position.set(
          0.18 * heft * scale,
          (row / (cells - 1 || 1) - 0.5) * height * 0.66,
          (column / (cells - 1 || 1) - 0.5) * width * 0.66,
        );
        piece.add(tube);
      }
    }
    return piece;
  }

  const bore = (mount.type === 'ballistic' ? 0.085 : 0.055) * heft * scale;
  const length = (mount.type === 'ballistic' ? 0.95 : 0.8) * heft * scale;

  // Housing at the breech, barrel out of it, and a muzzle ring at the end —
  // enough shape that a gun is not a floating stick.
  const housing = new Mesh(chamferedBox(length * 0.42, bore * 3.4, bore * 3.4), material);
  housing.position.x = -length * 0.22;
  piece.add(housing);

  const barrel = new Mesh(new CylinderGeometry(bore * 0.82, bore, length, 12), material);
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.x = length * 0.2;
  piece.add(barrel);

  const muzzle = new Mesh(new CylinderGeometry(bore * 1.25, bore * 1.25, bore * 1.2, 12), MUZZLE_MATERIAL);
  muzzle.rotation.z = -Math.PI / 2;
  muzzle.position.x = length * 0.68;
  piece.add(muzzle);

  return piece;
}

/** Shared dark metal for bores and muzzle rings; never tinted by team. */
const MUZZLE_MATERIAL = new MeshStandardMaterial({
  color: 0x1d2226,
  roughness: 0.5,
  metalness: 0.7,
});

/** Frees the geometry and materials a model owns. */
export function disposeModel(root: Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) child.material.forEach((entry) => entry.dispose());
    else child.material.dispose();
  });
}
