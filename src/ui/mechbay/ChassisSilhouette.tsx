import type { Chassis } from '../../schema/chassis';
import type { MechLocation } from '../../schema/common';
import type { Design } from '../../schema/design';
import { chassisBlueprint, type BlueprintPart, type Tone } from '../../render/blueprint';
import { mix, shade } from '../../render/palette';

/**
 * Painted steel under the bay lights, one colour per blueprint tone. On the
 * battlefield `trim` carries the team colour; here there is no team, and a
 * mantlet is a large plate, so it is a muted blue rather than a signal flare.
 */
const TONES: Record<Tone, number> = {
  plate: 0x8a97a2,
  deep: 0x4e5a63,
  trim: 0x5c8299,
  glass: 0xa9e4ff,
  accent: 0xa8b5bf,
};

/** What the far side of the machine is blended toward, so it sits back. */
const BACKDROP = 0x141c22;
const HIGHLIGHT = 0xffc857;

/**
 * Lit from above and a little in front, so the three faces of a plate are three
 * different values. This is the whole reason the machine reads as a machine
 * rather than as one grey area with a couple of notches in it.
 */
const FACE = { top: 1.2, front: 0.95, side: 0.68 } as const;
type Face = keyof typeof FACE;

/**
 * An oblique view from front, above, and the mech's right. The nose points to
 * the right of the panel; the near flank drops down and to the left, so the far
 * side of every plate recedes up and to the right.
 *
 * Shallow on purpose. A flat elevation puts both legs in exactly the same
 * place, and a deep three-quarter view smears a hundred-tonne siege hull across
 * the panel until the legs vanish under it.
 */
const SKEW_X = 0.34;
const SKEW_Y = 0.2;

interface Point {
  x: number;
  y: number;
}

function project(x: number, y: number, z: number): Point {
  return { x: x - z * SKEW_X, y: -y + z * SKEW_Y };
}

/**
 * How near a point is to the eye. Along the projection direction, so a chest
 * plate bolted to the nose draws over the hull behind it and the near leg draws
 * over the far one, whatever order the blueprint listed them in.
 */
function depth(x: number, y: number, z: number): number {
  return x * SKEW_X + y * SKEW_Y + z;
}

function css(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function points(list: readonly Point[]): string {
  return list.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

interface Facet {
  points: string;
  fill: string;
  /** Only the outer faces are outlined; interior shading is drawn flush. */
  outline: boolean;
}

interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
  outline: boolean;
}

interface Piece {
  key: string;
  depth: number;
  facets: Facet[];
  ellipses: Ellipse[];
  /** Screen-space rotation for a tilted plate, about its own centre. */
  spin: string | undefined;
}

/** The three faces of an axis-aligned plate that the eye can actually see. */
function boxFacets(at: readonly [number, number, number], size: readonly [number, number, number], paint: (face: Face) => string): Facet[] {
  const [cx, cy, cz] = at;
  const hx = size[0] / 2;
  const hy = size[1] / 2;
  const hz = size[2] / 2;
  const corner = (dx: number, dy: number, dz: number): Point => project(cx + dx, cy + dy, cz + dz);

  return [
    {
      points: points([corner(-hx, hy, hz), corner(hx, hy, hz), corner(hx, -hy, hz), corner(-hx, -hy, hz)]),
      fill: paint('side'),
      outline: true,
    },
    {
      points: points([corner(-hx, hy, -hz), corner(hx, hy, -hz), corner(hx, hy, hz), corner(-hx, hy, hz)]),
      fill: paint('top'),
      outline: true,
    },
    {
      points: points([corner(hx, hy, -hz), corner(hx, hy, hz), corner(hx, -hy, hz), corner(hx, -hy, -hz)]),
      fill: paint('front'),
      outline: true,
    },
  ];
}

/**
 * A tapered round limb: a trapezoid for the silhouette, with a lit band down
 * the near edge and a shaded one down the far edge so it reads as a cylinder
 * rather than a plank. Blueprint limbs are wide at the top and narrow at the
 * end, or the reverse — size is [top width, length, bottom width].
 */
function limbFacets(at: readonly [number, number, number], size: readonly [number, number, number], paint: (face: Face) => string): Facet[] {
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

interface Props {
  chassis: Chassis;
  design: Design;
  /** Highlighted while the player is working on one location. */
  active?: MechLocation | null;
}

/**
 * The chassis drawn from the same blueprint the battlefield builds its models
 * from, so the machine the player kits out is visibly the machine that walks
 * out of the bay. Mounted weapons show on the hardpoint they are bolted to,
 * which is the quickest way to see that a build is all in one arm.
 */
export function ChassisSilhouette({ chassis, design, active = null }: Props) {
  const plan = chassisBlueprint(chassis.silhouette, chassis.traits);

  // Leg and hip parts are already measured from the ground; everything above
  // the waist is measured from the torso pivot.
  const lift = (part: BlueprintPart): number =>
    part.location === 'left_leg' || part.location === 'right_leg' || part.location === null
      ? 0
      : plan.torsoY;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const cover = (point: Point): void => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  };

  const pieces: Piece[] = plan.parts.map((part, index) => {
    const at: [number, number, number] = [part.at[0], part.at[1] + lift(part), part.at[2]];
    const far = part.at[2] < -0.01;
    const lit = active !== null && part.location === active;
    const paint = (face: Face): string => {
      const shaded = shade(lit ? HIGHLIGHT : TONES[part.tone], FACE[face]);
      return css(far ? mix(shaded, BACKDROP, 0.45) : shaded);
    };

    const centre = project(at[0], at[1], at[2]);
    const facets: Facet[] = [];
    const ellipses: Ellipse[] = [];

    if (part.shape === 'sphere' || part.shape === 'cylinder') {
      const rx = part.size[0] / 2;
      const ry = part.size[1] / 2;
      ellipses.push({ cx: centre.x, cy: centre.y, rx, ry, fill: paint('front'), outline: true });
      // A joint is round: one offset highlight is enough to say so.
      ellipses.push({
        cx: centre.x - rx * 0.3,
        cy: centre.y - ry * 0.3,
        rx: rx * 0.52,
        ry: ry * 0.52,
        fill: paint('top'),
        outline: false,
      });
      cover({ x: centre.x - rx, y: centre.y - ry });
      cover({ x: centre.x + rx, y: centre.y + ry });
    } else if (part.shape === 'limb') {
      facets.push(...limbFacets(at, part.size, paint));
    } else {
      facets.push(...boxFacets(at, part.size, paint));
    }

    for (const facet of facets) {
      if (!facet.outline) continue;
      for (const pair of facet.points.split(' ')) {
        const [x, y] = pair.split(',');
        cover({ x: Number(x), y: Number(y) });
      }
    }

    return {
      key: `${part.location ?? 'frame'}-${index}`,
      depth: depth(at[0], at[1], at[2]),
      facets,
      ellipses,
      // A tilted plate is rotated on screen about its own centre. Blueprint
      // tilt turns the nose up about the lateral axis, which is anticlockwise
      // in the world and so a negative angle in a y-down coordinate system.
      spin:
        part.tilt === undefined
          ? undefined
          : `rotate(${round((-part.tilt * 180) / Math.PI)} ${round(centre.x)} ${round(centre.y)})`,
    };
  });

  // Far side first, so the near side of the machine reads on top of it.
  pieces.sort((a, b) => a.depth - b.depth);

  const mounted = new Map<MechLocation, number>();
  for (const mount of design.mounts) {
    mounted.set(mount.location, (mounted.get(mount.location) ?? 0) + 1);
  }

  // Markers are drawn in blueprint units, so they have to be sized against the
  // machine or they swamp a wide siege hull and vanish on a light scout.
  const markerRadius = Math.max(maxX - minX, maxY - minY) * 0.058;
  const badges = [...mounted.entries()].flatMap(([location, count]) => {
    const anchor = plan.hardpoints[location];
    if (anchor === undefined) return [];
    const home = project(anchor[0], anchor[1] + plan.torsoY, anchor[2]);
    return [{ location, count, home, at: { ...home } }];
  });

  // Arm and torso hardpoints land within a badge of each other on a chassis
  // with short arms. Rather than fanning every badge out on principle, push
  // apart only the ones that actually collide, so most stay on their mount.
  const spacing = markerRadius * 2.4;
  for (let pass = 0; pass < 30; pass += 1) {
    let moved = false;
    for (let a = 0; a < badges.length; a += 1) {
      for (let b = a + 1; b < badges.length; b += 1) {
        const one = badges[a];
        const two = badges[b];
        if (one === undefined || two === undefined) continue;
        let dx = two.at.x - one.at.x;
        let dy = two.at.y - one.at.y;
        let gap = Math.hypot(dx, dy);
        if (gap >= spacing) continue;
        if (gap < 1e-4) {
          // Exactly stacked: separate them up and down rather than at random.
          dx = 0;
          dy = -1;
          gap = 1;
        }
        const push = (spacing - gap) / 2 / gap;
        one.at.x -= dx * push;
        one.at.y -= dy * push;
        two.at.x += dx * push;
        two.at.y += dy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  for (const badge of badges) {
    cover({ x: badge.at.x - markerRadius, y: badge.at.y - markerRadius });
    cover({ x: badge.at.x + markerRadius, y: badge.at.y + markerRadius });
  }

  // Frame the machine from what it actually occupies, so a hundred-tonne siege
  // hull and a light scout both fill the panel instead of one rattling in it.
  const pad = markerRadius * 1.2;
  const viewBox = `${round(minX - pad)} ${round(minY - pad)} ${round(maxX - minX + pad * 2)} ${round(maxY - minY + pad * 2)}`;

  return (
    <svg
      className="chassis-silhouette"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${chassis.name} outline`}
      data-testid="chassis-silhouette"
    >
      {pieces.map((piece) => (
        <g key={piece.key} transform={piece.spin}>
          {piece.facets.map((facet, index) => (
            <polygon
              key={index}
              points={facet.points}
              fill={facet.fill}
              className={facet.outline ? 'sil-edge' : undefined}
            />
          ))}
          {piece.ellipses.map((shape, index) => (
            <ellipse
              key={index}
              cx={round(shape.cx)}
              cy={round(shape.cy)}
              rx={round(shape.rx)}
              ry={round(shape.ry)}
              fill={shape.fill}
              className={shape.outline ? 'sil-edge' : undefined}
            />
          ))}
        </g>
      ))}

      {badges.map((badge) => {
        const shifted = Math.hypot(badge.at.x - badge.home.x, badge.at.y - badge.home.y) > markerRadius * 0.5;
        return (
          <g key={badge.location} className={active === badge.location ? 'sil-lit' : undefined}>
            {shifted ? (
              <line
                x1={round(badge.home.x)}
                y1={round(badge.home.y)}
                x2={round(badge.at.x)}
                y2={round(badge.at.y)}
                className="sil-leader"
              />
            ) : null}
            <circle cx={round(badge.at.x)} cy={round(badge.at.y)} r={round(markerRadius)} className="sil-mount" />
            <text
              x={round(badge.at.x)}
              y={round(badge.at.y + markerRadius * 0.36)}
              className="sil-mount-count"
              style={{ fontSize: `${markerRadius}px` }}
            >
              {badge.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
