import { MeshStandardMaterial } from 'three';
import type { Tone } from '../render/blueprint';
import type { WeaponType } from '../schema/weapon';
import { mix, shade } from '../render/palette';

export type MechMaterials = Record<Tone, MeshStandardMaterial>;

const DEFAULT_BODY_COLOUR = 0x626a6e;

/** Neutral finishes let construction identify a chassis before team markings do. */
const CHASSIS_BODY_COLOURS: Readonly<Record<string, number>> = {
  bulwark_bwk3: 0x62685b,
  cairn_crn3: 0x746957,
  colossus_cls1: 0x555d64,
  courser_crs1: 0x70695c,
  drover_dvr2: 0x62655a,
  falchion_fal2: 0x655e59,
  halberd_hlb4: 0x5c646c,
  hornet_hnt2: 0x556b65,
  rampart_rmp4: 0x6a6155,
  redoubt_rdt1: 0x69645e,
  sentinel_snl2: 0x596b73,
  warden_wrd5: 0x665a62,
  wisp_wsp1: 0x68747c,
};

const INDUSTRIAL_FINISHES: readonly number[] = [
  0x596970,
  0x62675c,
  0x706657,
  0x645b61,
];

const WEAPON_ACCENTS: Record<WeaponType, number> = {
  energy: 0x78cce8,
  ballistic: 0xc4cbd0,
  missile: 0xd9855f,
};

function finishIndex(identity: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % INDUSTRIAL_FINISHES.length;
}

export function chassisBodyColour(identity: string | null): number {
  if (identity === null) return DEFAULT_BODY_COLOUR;
  const known = CHASSIS_BODY_COLOURS[identity];
  if (known !== undefined) return known;
  return INDUSTRIAL_FINISHES[finishIndex(identity)] ?? DEFAULT_BODY_COLOUR;
}

function material(
  colour: number,
  roughness: number,
  metalness: number,
  emissive = 0x000000,
  emissiveIntensity = 0,
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: colour,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
  });
}

export function createMechMaterials(
  identity: string | null,
  team: number,
  destroyed: boolean,
): MechMaterials {
  if (destroyed) {
    return {
      plate: material(0x2b2b2d, 0.82, 0.18),
      deep: material(0x181a1c, 0.76, 0.52),
      trim: material(0x50494a, 0.78, 0.14),
      glass: material(0x242a2e, 0.64, 0.08),
      accent: material(0x3a3a3c, 0.72, 0.3),
    };
  }

  const body = chassisBodyColour(identity);
  return {
    plate: material(body, 0.68, 0.12),
    deep: material(mix(shade(body, 0.36), team, 0.44), 0.48, 0.7),
    trim: material(team, 0.56, 0.14),
    glass: material(0x8edfff, 0.14, 0.04, 0x17688f, 1.55),
    accent: material(mix(body, 0xb8b3a5, 0.34), 0.52, 0.28),
  };
}

/** Weapon housings remain readable against painted armour under coloured light. */
export function createWeaponMaterial(type: WeaponType): MeshStandardMaterial {
  return material(mix(0x343b40, WEAPON_ACCENTS[type], 0.18), 0.4, 0.72);
}
