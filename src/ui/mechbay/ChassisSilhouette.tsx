import type { Chassis } from '../../schema/chassis';
import type { MechLocation } from '../../schema/common';
import type { Design } from '../../schema/design';
import { chassisBlueprint, type BlueprintPart } from '../../render/blueprint';
import {
  depth,
  limbFacets,
  partPaint,
  prismFacets,
  project,
  RECTANGLE,
  round,
  type Ellipse,
  type Facet,
  type Piece,
  type Point,
} from './silhouetteGeometry';

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
  const plan = chassisBlueprint(chassis.silhouette, chassis.traits, chassis.hardpoints, chassis.id);

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
    const paint = partPaint(part.tone, lit, far);

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
      facets.push(...prismFacets(at, part.size, part.profile ?? RECTANGLE, paint));
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
