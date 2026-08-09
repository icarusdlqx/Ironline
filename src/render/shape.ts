import type { Chassis } from '../schema/chassis';
import type { MechLocation } from '../schema/common';
import type { WeaponType } from '../schema/weapon';

/** The proportions that make one chassis read differently from another. */
export type Silhouette = Chassis['silhouette'];

export interface MountArt {
  location: MechLocation;
  type: WeaponType;
  /** Weapon tonnage, which drives how much hardware is visible. */
  tonnage: number;
}

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
