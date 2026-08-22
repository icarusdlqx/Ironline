import type { Group, MeshStandardMaterial, Object3D } from 'three';
import type { MechLocation } from '../schema/common';
import type { Faction } from '../schema/faction';
import type { Weapon, WeaponType } from '../schema/weapon';
import type { MechGeometryQuality } from './renderQuality';

export interface MountArt {
  weaponId: string;
  location: MechLocation;
  type: WeaponType;
  tonnage: number;
  projectiles: number;
  recoil: number;
  visual: Weapon['visual'];
}

export type WeaponModelFamily =
  | 'beam'
  | 'pulse'
  | 'projector'
  | 'flame'
  | 'cannon'
  | 'rapid-cannon'
  | 'rotary-cannon'
  | 'scatter-cannon'
  | 'rail'
  | 'missile-flat'
  | 'missile-loft'
  | 'missile-seeker'
  | 'missile-heavy';

export type WeaponArtAccent =
  | 'compact'
  | 'standard'
  | 'focused'
  | 'burst'
  | 'smelter'
  | 'arc'
  | 'plasma'
  | 'field'
  | 'siege'
  | 'rotary'
  | 'scatter'
  | 'rail'
  | 'flame'
  | 'shortbow'
  | 'longshot'
  | 'volley'
  | 'seeker';

export interface WeaponArtSpec {
  family: WeaponModelFamily;
  nativeFaction: Faction;
  accent: WeaponArtAccent;
  bulk: number;
  barrels: number;
  ports: number;
}

export interface ResolvedWeaponArt extends WeaponArtSpec {
  authored: boolean;
}

export interface WeaponRig {
  weaponId: string;
  nativeFaction: Faction;
  visual: Weapon['visual'];
  slide: Group;
  muzzle: Object3D;
  breech: Object3D;
  kick: number;
  travel: number;
  cycle: number;
  feed: Object3D | null;
  feedKind: 'stroke' | 'spin';
  feedRestX: number;
  feedRestTurn: number;
  feedTravel: number;
  aperture: Object3D | null;
  apertureRestScale: number;
  apertureTravel: number;
}

export interface WeaponModel {
  root: Group;
  rig: WeaponRig;
}

export interface WeaponBuildContext {
  root: Group;
  mount: MountArt;
  art: ResolvedWeaponArt;
  heft: number;
  scale: number;
  material: MeshStandardMaterial;
  boreMaterial: MeshStandardMaterial;
  quality: MechGeometryQuality;
}

export interface WeaponBuildParts {
  breechX: number;
  muzzleX: number;
  feed?: Object3D;
  feedKind?: 'stroke' | 'spin';
  feedTravel?: number;
  aperture?: Object3D;
  apertureTravel?: number;
}
