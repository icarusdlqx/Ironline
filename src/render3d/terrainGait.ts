export interface GaitProfile {
  stride: number;
  swing: number;
  knee: number;
  bob: number;
}

const GAITS: Record<string, GaitProfile> = {
  open: { stride: 1, swing: 0.42, knee: 0.5, bob: 1 },
  road: { stride: 1.08, swing: 0.43, knee: 0.46, bob: 0.9 },
  forest: { stride: 0.74, swing: 0.32, knee: 0.68, bob: 0.68 },
  rough: { stride: 0.84, swing: 0.36, knee: 0.6, bob: 0.78 },
  water: { stride: 0.7, swing: 0.28, knee: 0.72, bob: 0.52 },
  building: { stride: 0.9, swing: 0.37, knee: 0.55, bob: 0.82 },
};

const OPEN = GAITS.open ?? { stride: 1, swing: 0.42, knee: 0.5, bob: 1 };

export function gaitForTerrain(terrainId: string): GaitProfile {
  return GAITS[terrainId] ?? OPEN;
}

export function responseBlend(rate: number, deltaSeconds: number): number {
  return 1 - Math.exp(-Math.max(0, deltaSeconds) * rate);
}

export function advanceGait(
  current: GaitProfile,
  target: GaitProfile,
  deltaSeconds: number,
): void {
  const blend = responseBlend(7, deltaSeconds);
  current.stride += (target.stride - current.stride) * blend;
  current.swing += (target.swing - current.swing) * blend;
  current.knee += (target.knee - current.knee) * blend;
  current.bob += (target.bob - current.bob) * blend;
}
