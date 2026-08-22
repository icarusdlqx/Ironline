import {
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import type { MechLocation } from '../schema/common';
import type { Faction } from '../schema/faction';
import { chassisBlueprint, type HardpointMap } from '../render/blueprint';
import type { Silhouette } from '../render/shape';
import { radiusFor } from '../render/shape';
import type { DamageWearTier } from './damageLedger';
import {
  createDamageWearMaterials,
  createMechMaterials,
  createWeaponMaterial,
} from './mechMaterials';
import {
  motionProfileFor,
  OPEN_STRIDE_TERRAIN,
  strideLengthFor,
  type MotionProfile,
} from './motionProfiles';
import { buildWeaponModel, type MountArt, type WeaponRig } from './weaponModels';
import {
  machineCulture,
  type HullRecoil,
  type MachineCultureProfile,
} from './machineCulture';
import type { StartupLightRig } from './startupLights';
import type { LoosePanelRig } from './damagedPanels';
import { castsMechShadow, geometryForBlueprintPart } from './mechGeometry';
import { applyModelDetail, markBlueprintDetail } from './modelDetail';
import { TACTICAL_MECH_RENDER, type MechRenderOptions } from './renderQuality';

export type { MountArt } from './weaponModels';

/** Three pivots keep the boot planted without adding another visible part. */
export interface LegRig {
  hip: Group;
  knee: Group;
  ankle: Group;
  hipRestX: number;
  hipRestY: number;
  hipRestZ: number;
}

export interface Footprint {
  minForward: number;
  maxForward: number;
  halfWidth: number;
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
  /** The articulated chain's comfortable reach in world metres. */
  legReach: number;
  /** An ankle sits above the ground even when its boot is flat. */
  ankleClearance: number;
  /** Sole bounds let contact sample the ground the visible boot actually covers. */
  footprint: Footprint;
  /** Hull yaw at this radius has to show up in the feet. */
  turnRadius: number;
  /** Presentation weight belongs to the chassis, never the movement rules. */
  motion: MotionProfile | null;
  /** Authored mounts keep their own muzzle and recoil travel after construction. */
  weapons: WeaponRig[];
  faction: Faction;
  culture: Readonly<MachineCultureProfile>;
  hullRecoil: HullRecoil;
  startup: StartupLightRig | null;
  loosePanels: LoosePanelRig[];
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
  wear: Readonly<Partial<Record<MechLocation, DamageWearTier>>> = {},
  faction: Faction = 'linewrought',
  options: Readonly<MechRenderOptions> = TACTICAL_MECH_RENDER,
): MechModel {
  const scale = radiusFor(tonnage);
  const plan = chassisBlueprint(shape, traits, fit, identity);
  const motion = motionProfileFor(shape.form, tonnage);
  const culture = machineCulture(faction);
  const shownWear = culture.revealsFieldDamage ? wear : {};
  const shownLost = culture.revealsFieldDamage ? lost : new Set<MechLocation>();
  const tones = createMechMaterials(identity, team, destroyed);
  const burnt = createMechMaterials(identity, team, true);
  const worn = Object.values(shownWear).some((tier) => tier === 1)
    ? createDamageWearMaterials(tones, 1)
    : null;
  const scorched = Object.values(shownWear).some((tier) => tier === 2)
    ? createDamageWearMaterials(tones, 2)
    : null;

  const root = new Group();
  const torso = new Group();
  root.rotation.order = 'YXZ';
  torso.rotation.order = 'YXZ';
  const weapons: WeaponRig[] = [];
  const ownedMaterials: Material[] = [
    ...Object.values(tones),
    ...Object.values(burnt),
    ...(worn === null ? [] : Object.values(worn)),
    ...(scorched === null ? [] : Object.values(scorched)),
  ];
  const boreMaterial = new MeshStandardMaterial({
    color: 0x1d2226,
    roughness: 0.5,
    metalness: 0.7,
  });
  ownedMaterials.push(boreMaterial);

  // Explicit pivots survive changes to boot and shin proportions; height-based
  // guesses made the same chassis change joints when its armour was revised.
  const rigs = new Map<'left_leg' | 'right_leg', LegRig>();
  const loosened = new Set<MechLocation>();
  const loosePanels: LoosePanelRig[] = [];
  const footprint: Footprint = { minForward: 0, maxForward: 0, halfWidth: 0 };
  let ankleClearance = plan.legs.ankleHeight * scale;
  const rigFor = (side: 'left_leg' | 'right_leg', z: number): LegRig => {
    const existing = rigs.get(side);
    if (existing !== undefined) return existing;
    const hip = new Group();
    hip.position.set(0, plan.legs.hipHeight * scale, z);
    const hipRestX = hip.position.x;
    const hipRestY = hip.position.y;
    const hipRestZ = hip.position.z;
    const knee = new Group();
    knee.position.set(plan.legs.kneeForward * scale, (plan.legs.kneeHeight - plan.legs.hipHeight) * scale, 0);
    const ankle = new Group();
    ankle.position.set(
      (plan.legs.ankleForward - plan.legs.kneeForward) * scale,
      (plan.legs.ankleHeight - plan.legs.kneeHeight) * scale,
      0,
    );
    knee.add(ankle);
    hip.add(knee);
    root.add(hip);
    const rig = { hip, knee, ankle, hipRestX, hipRestY, hipRestZ };
    rigs.set(side, rig);
    return rig;
  };

  for (const part of plan.parts) {
    // An arm or a head that has been blown off is gone: nothing tells a player
    // a mech has stopped being dangerous like watching the arm leave. A torso
    // or a leg stays — the machine is standing on it — but it stays burnt.
    const gone = part.location !== null && shownLost.has(part.location);
    const shed = gone && (part.location === 'left_arm' || part.location === 'right_arm' || part.location === 'head');
    if (shed) continue;

    const tier = part.location === null ? 0 : (shownWear[part.location] ?? 0);
    const finish = tier === 2 && scorched !== null
      ? scorched
      : tier === 1 && worn !== null
        ? worn
        : tones;
    const mesh = new Mesh(
      geometryForBlueprintPart(part, scale, options.geometry),
      gone ? burnt[part.tone] : finish[part.tone],
    );
    mesh.userData.damageLocation = part.location;
    mesh.position.set(part.at[0] * scale, part.at[1] * scale, part.at[2] * scale);
    if (part.tilt !== undefined) mesh.rotation.z = part.tilt;
    if (
      tier === 2 &&
      part.location !== null &&
      part.location !== 'left_leg' &&
      part.location !== 'right_leg' &&
      !loosened.has(part.location)
    ) {
      const direction = part.location.startsWith('left') ? 1 : -1;
      mesh.rotation.x = direction * 0.16;
      mesh.rotation.z += direction * 0.12;
      mesh.position.y -= scale * 0.045;
      mesh.userData.loosePanel = true;
      loosePanels.push({
        mesh,
        restX: mesh.rotation.x,
        restZ: mesh.rotation.z,
        phase: loosePanels.length * 1.83 + scale * 0.07,
      });
      loosened.add(part.location);
    }
    mesh.castShadow = castsMechShadow(mesh);
    markBlueprintDetail(mesh, part.detail);

    const running = part.location === 'left_leg' || part.location === 'right_leg';

    if (running && plan.articulated) {
      const rig = rigFor(part.location as 'left_leg' | 'right_leg', part.at[2] * scale);
      const joint = part.joint === 'ankle' ? rig.ankle : part.joint === 'knee' ? rig.knee : rig.hip;
      mesh.position.sub(jointWorld(joint, rig));
      mesh.position.z = 0;
      joint.add(mesh);
      if (part.joint === 'ankle' && part.profile !== undefined) {
        mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox;
        if (bounds !== null) {
          footprint.minForward = Math.min(footprint.minForward, mesh.position.x + bounds.min.x);
          footprint.maxForward = Math.max(footprint.maxForward, mesh.position.x + bounds.max.x);
          footprint.halfWidth = Math.max(footprint.halfWidth, Math.abs(bounds.min.z), bounds.max.z);
          ankleClearance = Math.max(ankleClearance, -(mesh.position.y + bounds.min.y));
        }
      }
    } else if (part.location === null || part.fixed === true || running) {
      // Hull, running gear, and anything else bolted down. It still belongs to
      // a location for damage, but it stays put while the guns traverse.
      root.add(mesh);
    } else {
      torso.add(mesh);
    }
  }

  const startupLights: Mesh[] = [];
  if (faction === 'aurelian' && !destroyed) {
    const head = plan.parts.find((part) => part.location === 'head');
    if (head !== undefined) {
      const geometry = new SphereGeometry(scale * 0.042, 8, 6);
      const material = new MeshStandardMaterial({
        color: 0xb9fff2,
        emissive: 0x72e8d7,
        emissiveIntensity: 2.4,
        roughness: 0.24,
      });
      ownedMaterials.push(material);
      for (let index = 0; index < 3; index += 1) {
        const light = new Mesh(geometry, material);
        light.name = `startup-light:${index}`;
        light.position.set(
          (head.at[0] + head.size[0] * 0.52) * scale,
          head.at[1] * scale,
          (head.at[2] + (index - 1) * head.size[2] * 0.22) * scale,
        );
        light.visible = false;
        torso.add(light);
        startupLights.push(light);
      }
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
      if (child instanceof Mesh) child.castShadow = castsMechShadow(child);
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
  applyModelDetail(root, options.detail);
  root.userData.ownedMaterials = ownedMaterials;

  return {
    root,
    torso,
    height: plan.height * scale,
    legs: [...rigs.values()],
    torsoRestY: plan.torsoY * scale,
    strideLength: motion === null
      ? 0
      : strideLengthFor(plan.legs.stanceReach * scale, motion, OPEN_STRIDE_TERRAIN),
    legReach: plan.legs.stanceReach * scale,
    ankleClearance,
    footprint,
    turnRadius: plan.legs.stanceWidth * scale,
    motion,
    weapons,
    faction,
    culture,
    hullRecoil: { kick: 0, travel: scale * 0.018 },
    startup: startupLights.length === 0
      ? null
      : { lights: startupLights, elapsed: 0, running: true },
    loosePanels,
  };
}

/** Where a joint sits in the model's own frame, for re-parenting leg plates. */
function jointWorld(joint: Group, rig: LegRig): import('three').Vector3 {
  if (joint === rig.ankle) {
    return rig.hip.position.clone().add(rig.knee.position).add(rig.ankle.position);
  }
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
