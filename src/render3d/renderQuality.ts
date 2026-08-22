import type { BlueprintDetail } from '../render/blueprint/types';

export type MechGeometryQuality = 'tactical' | 'hero';
export type ModelDetail = BlueprintDetail;

export interface MechRenderOptions {
  geometry: MechGeometryQuality;
  detail: ModelDetail;
}

export const TACTICAL_MECH_RENDER: Readonly<MechRenderOptions> = Object.freeze({
  geometry: 'tactical',
  detail: 'structure',
});

export const HERO_MECH_RENDER: Readonly<MechRenderOptions> = Object.freeze({
  geometry: 'hero',
  detail: 'hero',
});

export const SURFACE_DETAIL_ENTER_DISTANCE = 300;
export const SURFACE_DETAIL_LEAVE_DISTANCE = 340;

/** Hysteresis keeps a wheel resting on the boundary from flickering detail. */
export function battlefieldDetailForDistance(
  distance: number,
  lowFx: boolean,
  previous: ModelDetail = 'structure',
): ModelDetail {
  if (lowFx || !Number.isFinite(distance)) return 'structure';
  if (previous !== 'structure') {
    return distance < SURFACE_DETAIL_LEAVE_DISTANCE ? 'surface' : 'structure';
  }
  return distance <= SURFACE_DETAIL_ENTER_DISTANCE ? 'surface' : 'structure';
}

export function includesDetail(level: ModelDetail, wanted: BlueprintDetail): boolean {
  const rank: Record<ModelDetail, number> = { structure: 0, surface: 1, hero: 2 };
  return rank[wanted] <= rank[level];
}
