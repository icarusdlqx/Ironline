export const TERRAIN_COLOURS: Record<string, number> = {
  open: 0x2f3a2c,
  rough: 0x46402f,
  forest: 0x1d3220,
  water: 0x1b3247,
  road: 0x4a4438,
  building: 0x57524b,
  impassable: 0x24262a,
};

export const TEAM_COLOURS: readonly number[] = [0x4fa3d1, 0xd15a4f, 0xc8a94f, 0x6bbf59];

export const UI = {
  background: 0x0d1013,
  grid: 0x000000,
  selection: 0x8ce0ff,
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

export function shade(colour: number, factor: number): number {
  const r = Math.min(255, Math.round(((colour >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((colour >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((colour & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}
