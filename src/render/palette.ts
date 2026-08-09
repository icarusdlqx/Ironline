// Ground tones for Tessell: dry upland grass, exposed shale, deep conifer,
// cold meltwater. Distinct enough to read at a glance without going lurid.
export const TERRAIN_COLOURS: Record<string, number> = {
  open: 0x3c4a33,
  rough: 0x5c5340,
  forest: 0x1f3a24,
  water: 0x1d3f5c,
  road: 0x59513f,
  building: 0x5f5a53,
  impassable: 0x24262a,
};

export const TEAM_COLOURS: readonly number[] = [0x4fa3d1, 0xd15a4f, 0xc8a94f, 0x6bbf59];

export const UI = {
  background: 0x0d1013,
  grid: 0x000000,
  selection: 0x8ce0ff,
  friendly: 0x6fd7ff,
  hostile: 0xff4d3a,
  moveMarker: 0x8ce0ff,
  attackMarker: 0xff8a6b,
  ghost: 0x8892a0,
  beamEnergy: 0x9fe6ff,
  tracerBallistic: 0xffd489,
  missile: 0xff9d5c,
  explosion: 0xffb457,
  smoke: 0x8b8b8b,
  fogUnexplored: 0x05070a,
  fogRemembered: 0x05070a,
} as const;

export function teamColour(team: number): number {
  return TEAM_COLOURS[team % TEAM_COLOURS.length] ?? 0xffffff;
}

/** Blends two colours; t=0 is all of a, t=1 is all of b. */
export function mix(a: number, b: number, t: number): number {
  const clamp = Math.max(0, Math.min(1, t));
  const channel = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * (1 - clamp) + ((b >> shift) & 0xff) * clamp);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function shade(colour: number, factor: number): number {
  const r = Math.min(255, Math.round(((colour >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((colour >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((colour & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}
