import { Group, Object3D } from 'three';
import type { MechGeometryQuality } from './renderQuality';
import { weaponArtFor } from './weaponArt';
import { buildMissileWeapon } from './weaponMissileModels';
import type {
  MountArt,
  WeaponBuildContext,
  WeaponModel,
  WeaponModelFamily,
  WeaponRig,
} from './weaponModelTypes';
import { buildAurelianWeapon } from './weaponModelsAurelian';
import { buildLineWeapon } from './weaponModelsLine';
import { advanceWeaponMotion, createWeaponRig, triggerWeaponMotion } from './weaponMotion';

export type {
  MountArt,
  WeaponModel,
  WeaponModelFamily,
  WeaponRig,
} from './weaponModelTypes';

export function weaponModelFamily(
  mount: Pick<MountArt, 'weaponId' | 'type' | 'projectiles' | 'visual'>,
): WeaponModelFamily {
  return weaponArtFor(mount).family;
}

export function buildWeaponModel(
  mount: MountArt,
  heft: number,
  scale: number,
  material: WeaponBuildContext['material'],
  boreMaterial: WeaponBuildContext['boreMaterial'],
  quality: MechGeometryQuality = 'tactical',
): WeaponModel {
  const root = new Group();
  const art = weaponArtFor(mount);
  const context: WeaponBuildContext = {
    root,
    mount,
    art,
    heft,
    scale,
    material,
    boreMaterial,
    quality,
  };
  const parts = art.family.startsWith('missile-')
    ? buildMissileWeapon(context)
    : art.nativeFaction === 'aurelian'
      ? buildAurelianWeapon(context)
      : buildLineWeapon(context);
  const breech = anchor(`breech:${mount.weaponId}`, parts.breechX);
  const muzzle = anchor(`muzzle:${mount.weaponId}`, parts.muzzleX);
  root.add(breech, muzzle);
  root.name = `weapon:${mount.weaponId}`;
  root.userData.weaponId = mount.weaponId;
  root.userData.weaponFamily = art.family;
  root.userData.nativeFaction = art.nativeFaction;
  root.userData.authoredWeaponArt = art.authored;
  root.userData.geometryQuality = quality;
  return {
    root,
    rig: createWeaponRig(
      mount.weaponId,
      art.nativeFaction,
      mount.visual,
      root,
      muzzle,
      breech,
      scale * mount.recoil * 0.28,
      parts,
    ),
  };
}

export function triggerWeaponRecoil(rig: WeaponRig): void {
  triggerWeaponMotion(rig);
}

export function advanceWeaponRecoil(
  rig: WeaponRig,
  deltaSeconds: number,
  reducedMotion = false,
  lowFx = false,
): void {
  advanceWeaponMotion(rig, deltaSeconds, reducedMotion, lowFx);
}

function anchor(name: string, x: number): Object3D {
  const result = new Object3D();
  result.name = name;
  result.position.x = x;
  return result;
}
