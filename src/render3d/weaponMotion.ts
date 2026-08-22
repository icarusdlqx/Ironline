import type { Group, Object3D } from 'three';
import type { Weapon } from '../schema/weapon';
import type { Faction } from '../schema/faction';
import type { WeaponBuildParts, WeaponRig } from './weaponModelTypes';

export function createWeaponRig(
  weaponId: string,
  nativeFaction: Faction,
  visual: Weapon['visual'],
  slide: Group,
  muzzle: Object3D,
  breech: Object3D,
  travel: number,
  parts: WeaponBuildParts,
): WeaponRig {
  return {
    weaponId,
    nativeFaction,
    visual,
    slide,
    muzzle,
    breech,
    kick: 0,
    travel,
    cycle: 0,
    feed: parts.feed ?? null,
    feedKind: parts.feedKind ?? 'stroke',
    feedRestX: parts.feed?.position.x ?? 0,
    feedRestTurn: parts.feed?.rotation.x ?? 0,
    feedTravel: parts.feedTravel ?? 0,
    aperture: parts.aperture ?? null,
    apertureRestScale: parts.aperture?.scale.y ?? 1,
    apertureTravel: parts.apertureTravel ?? 0,
  };
}

export function triggerWeaponMotion(rig: WeaponRig): void {
  if (rig.nativeFaction === 'linewrought') {
    rig.kick = Math.max(rig.kick, rig.travel);
  }
  rig.cycle = 1;
  applyWeaponMotion(rig, false);
}

/** Every moving piece already exists; sustained fire only changes scalar transforms. */
export function advanceWeaponMotion(
  rig: WeaponRig,
  deltaSeconds: number,
  reducedMotion = false,
  lowFx = false,
): void {
  const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  rig.kick *= Math.exp(-delta * 13);
  rig.cycle = lowFx ? 0 : rig.cycle * Math.exp(-delta * (reducedMotion ? 18 : 9));
  if (rig.kick < 0.005) rig.kick = 0;
  if (rig.cycle < 0.002) rig.cycle = 0;
  applyWeaponMotion(rig, lowFx);
}

function applyWeaponMotion(rig: WeaponRig, lowFx: boolean): void {
  rig.slide.position.x = rig.nativeFaction === 'linewrought' && rig.kick !== 0 ? -rig.kick : 0;
  const cycle = lowFx ? 0 : rig.cycle;
  if (rig.feed !== null && rig.feedKind === 'spin') {
    rig.feed.rotation.x = rig.feedRestTurn + rig.feedTravel * cycle;
  } else if (rig.feed !== null) {
    rig.feed.position.x = rig.feedRestX - rig.feedTravel * cycle;
  }
  if (rig.aperture === null) return;
  const scale = rig.apertureRestScale * (1 - rig.apertureTravel * cycle);
  rig.aperture.scale.y = scale;
  rig.aperture.scale.z = scale;
}
