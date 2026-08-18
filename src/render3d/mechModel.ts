import {
  BufferGeometry,
  CylinderGeometry,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { armourShell, chamferedBox, hullSlab, taperedLimb } from './panels';
import type { MechLocation } from '../schema/common';
import { chassisBlueprint, type BlueprintPart, type HardpointMap } from '../render/blueprint';
import type { Silhouette } from '../render/shape';
import { radiusFor } from '../render/shape';
import { createMechMaterials, createWeaponMaterial } from './mechMaterials';
import { buildWeaponModel, type MountArt, type WeaponRig } from './weaponModels';

export type { MountArt } from './weaponModels';

/** One articulated leg: the hip swings the whole leg, the knee bends the shin. */
export interface LegRig {
  hip: Group;
  knee: Group;
}

export interface MechModel {
  root: Group;
  /** Turns with the torso; the legs stay with the hull. */
  torso: Group;
  /** Metres from the ground to the top of the hull, for HUD markers. */
  height: number;
  /** Left and right legs, hung from real pivots so the mech can walk. */
  legs: LegRig[];
  /** Where the torso rests, so a walk bob has a base to come back to. */
  torsoRestY: number;
  /** One full stride, in world metres, for pacing the walk cycle. */
  strideLength: number;
  /** Authored mounts keep their own muzzle and recoil travel after construction. */
  weapons: WeaponRig[];
}

/**
 * Whether a part is worth a place in the shadow pass. A mech is dozens of
 * plates, and every caster is another draw call when the sun renders its
 * map — but the shadow a fist-sized greeble throws is invisible at tactical
 * zoom. Only the slabs that make the silhouette pay their way.
 */
const SHADOW_CASTER_MIN_RADIUS = 2.4;

function castsShadow(mesh: Mesh): boolean {
  const geometry = mesh.geometry;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  return (geometry.boundingSphere?.radius ?? 0) >= SHADOW_CASTER_MIN_RADIUS;
}

function geometryFor(part: BlueprintPart, scale: number): BufferGeometry {
  const [w, h, d] = part.size;
  // A shaped plate is cut to its own outline. Everything else falls back to
  // the primitives, so a part only pays for a profile when it earns one.
  if (part.profile !== undefined && part.transverse !== undefined) {
    return armourShell(
      part.profile.map(([x, y]) => [x * w * scale, y * h * scale] as [number, number]),
      d * scale,
      part.transverse,
    );
  }
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
  /** What each location is wired for, which shapes the structure built there. */
  fit: HardpointMap = {},
  /** Render-only construction key; combat continues to care about the chassis id elsewhere. */
  identity: string | null = null,
): MechModel {
  const scale = radiusFor(tonnage);
  const plan = chassisBlueprint(shape, traits, fit, identity);
  const tones = createMechMaterials(identity, team, destroyed);
  const burnt = createMechMaterials(identity, team, true);

  const root = new Group();
  const torso = new Group();
  const weapons: WeaponRig[] = [];
  const ownedMaterials: Material[] = [...Object.values(tones), ...Object.values(burnt)];
  const boreMaterial = new MeshStandardMaterial({
    color: 0x1d2226,
    roughness: 0.5,
    metalness: 0.7,
  });
  ownedMaterials.push(boreMaterial);

  // Each leg hangs from a hip pivot, with the shin and foot on a knee pivot
  // inside it, so the walk cycle can swing and bend them like a machine
  // walking rather than sliding the whole statue across the ground.
  const rigs = new Map<'left_leg' | 'right_leg', LegRig>();
  const rigFor = (side: 'left_leg' | 'right_leg', z: number): LegRig => {
    const existing = rigs.get(side);
    if (existing !== undefined) return existing;
    const hip = new Group();
    hip.position.set(0, plan.legs.hipHeight * scale, z);
    const knee = new Group();
    knee.position.set(plan.legs.kneeForward * scale, (plan.legs.kneeHeight - plan.legs.hipHeight) * scale, 0);
    hip.add(knee);
    root.add(hip);
    const rig = { hip, knee };
    rigs.set(side, rig);
    return rig;
  };

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
    mesh.castShadow = castsShadow(mesh);

    const running = part.location === 'left_leg' || part.location === 'right_leg';

    if (running && plan.articulated) {
      const rig = rigFor(part.location as 'left_leg' | 'right_leg', part.at[2] * scale);
      // Everything at or below the knee bends with it; the thigh only swings.
      const joint = part.at[1] <= plan.legs.kneeHeight + 0.01 ? rig.knee : rig.hip;
      mesh.position.sub(jointWorld(joint, rig));
      mesh.position.z = 0;
      joint.add(mesh);
    } else if (part.location === null || part.fixed === true || running) {
      // Hull, running gear, and anything else bolted down. It still belongs to
      // a location for damage, but it stays put while the guns traverse.
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

    const material = createWeaponMaterial(mount.type);
    ownedMaterials.push(material);
    const heft = 0.5 + Math.min(1, mount.tonnage / 14);
    const weapon = buildWeaponModel(mount, heft, scale, material, boreMaterial);
    weapon.root.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = castsShadow(child);
    });

    const hardpoint = new Group();
    hardpoint.position.set(
      anchor[0] * scale,
      (anchor[1] + index * 0.22) * scale,
      anchor[2] * scale,
    );
    hardpoint.add(weapon.root);
    torso.add(hardpoint);
    weapons.push(weapon.rig);
  }

  torso.position.y = plan.torsoY * scale;
  root.add(torso);
  root.userData.ownedMaterials = ownedMaterials;

  return {
    root,
    torso,
    height: plan.height * scale,
    legs: [...rigs.values()],
    torsoRestY: plan.torsoY * scale,
    // A stride is roughly what the legs can reach: comfortable, not maximal.
    strideLength: plan.legs.hipHeight * scale * 1.15,
    weapons,
  };
}

/** Where a joint sits in the model's own frame, for re-parenting leg plates. */
function jointWorld(joint: Group, rig: LegRig): import('three').Vector3 {
  if (joint === rig.knee) {
    return rig.hip.position.clone().add(rig.knee.position);
  }
  return rig.hip.position.clone();
}

/** Frees the geometry and materials a model owns. */
export function disposeModel(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    geometries.add(child.geometry);
    if (Array.isArray(child.material)) child.material.forEach((entry) => materials.add(entry));
    else materials.add(child.material);
  });
  const owned = root.userData.ownedMaterials;
  if (Array.isArray(owned)) {
    for (const entry of owned) if (entry instanceof Material) materials.add(entry);
  }
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
