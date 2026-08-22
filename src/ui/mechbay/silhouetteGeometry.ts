import type { Profile, Tone } from '../../render/blueprint';
import { mix, shade } from '../../render/palette';

const TONES: Record<Tone, number> = {
  plate: 0x8a97a2,
  deep: 0x4e5a63,
  trim: 0x5c8299,
  glass: 0xa9e4ff,
  accent: 0xa8b5bf,
};

const BACKDROP = 0x141c22;
const HIGHLIGHT = 0xffc857;
const FACE = { top: 1.2, front: 0.95, side: 0.68 } as const;
export type Face = keyof typeof FACE;

// A shallow oblique view separates both legs without smearing a siege hull
// across the whole panel.
const SKEW_X = 0.34;
const SKEW_Y = 0.2;

export interface Point {
  x: number;
  y: number;
}

export interface Facet {
  points: string;
  fill: string;
  outline: boolean;
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
  outline: boolean;
}

export interface Piece {
  key: string;
  depth: number;
  facets: Facet[];
  ellipses: Ellipse[];
  spin: string | undefined;
}

export const RECTANGLE: Profile = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

export function project(x: number, y: number, z: number): Point {
  return { x: x - z * SKEW_X, y: -y + z * SKEW_Y };
}

export function depth(x: number, y: number, z: number): number {
  return x * SKEW_X + y * SKEW_Y + z;
}

export function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function partPaint(tone: Tone, lit: boolean, far: boolean) {
  return (face: Face): string => {
    const shaded = shade(lit ? HIGHLIGHT : TONES[tone], FACE[face]);
    const colour = far ? mix(shaded, BACKDROP, 0.45) : shaded;
    return `#${colour.toString(16).padStart(6, '0')}`;
  };
}

function points(list: readonly Point[]): string {
  return list.map((point) => `${round(point.x)},${round(point.y)}`).join(' ');
}

/** Cut a plate to its blueprint profile and expose only faces toward the eye. */
export function prismFacets(
  at: readonly [number, number, number],
  size: readonly [number, number, number],
  profile: Profile,
  paint: (face: Face) => string,
): Facet[] {
  const [cx, cy, cz] = at;
  const hz = size[2] / 2;
  const corner = (px: number, py: number, dz: number): Point =>
    project(cx + px * size[0], cy + py * size[1], cz + dz);
  const facets: Facet[] = [];

  for (let index = 0; index < profile.length; index += 1) {
    const from = profile[index];
    const to = profile[(index + 1) % profile.length];
    if (from === undefined || to === undefined) continue;

    const edgeX = (to[0] - from[0]) * size[0];
    const edgeY = (to[1] - from[1]) * size[1];
    const normalX = edgeY;
    const normalY = -edgeX;
    if (normalX * SKEW_X + normalY * SKEW_Y <= 0) continue;

    facets.push({
      points: points([
        corner(from[0], from[1], -hz),
        corner(to[0], to[1], -hz),
        corner(to[0], to[1], hz),
        corner(from[0], from[1], hz),
      ]),
      fill: paint(normalY > Math.abs(normalX) * 0.6 ? 'top' : 'front'),
      outline: true,
    });
  }

  facets.push({
    points: points(profile.map(([px, py]) => corner(px, py, hz))),
    fill: paint('side'),
    outline: true,
  });
  return facets;
}

/** Shade a tapered limb as a round member rather than a flat plank. */
export function limbFacets(
  at: readonly [number, number, number],
  size: readonly [number, number, number],
  paint: (face: Face) => string,
): Facet[] {
  const [cx, cy, cz] = at;
  const top = size[0] / 2;
  const bottom = size[2] / 2;
  const half = size[1] / 2;
  const band = (from: number, to: number): string =>
    points([
      project(cx + top * from, cy + half, cz),
      project(cx + top * to, cy + half, cz),
      project(cx + bottom * to, cy - half, cz),
      project(cx + bottom * from, cy - half, cz),
    ]);

  return [
    { points: band(-1, 1), fill: paint('front'), outline: true },
    { points: band(-1, -0.25), fill: paint('top'), outline: false },
    { points: band(0.45, 1), fill: paint('side'), outline: false },
  ];
}
