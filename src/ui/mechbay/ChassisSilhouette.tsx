import type { Chassis } from '../../schema/chassis';
import type { MechLocation } from '../../schema/common';
import type { Design } from '../../schema/design';
import { chassisBlueprint, type BlueprintPart } from '../../render/blueprint';

const TONE_CLASS = {
  plate: 'sil-plate',
  deep: 'sil-deep',
  trim: 'sil-trim',
  glass: 'sil-glass',
  accent: 'sil-accent',
} as const;

/**
 * A three-quarter view rather than a flat elevation: side-on, both legs land in
 * exactly the same place and the machine reads as a stack of boxes. Skewing by
 * the lateral axis pulls the far side up and across, which is enough to see
 * that a mech has two of things.
 */
const SKEW_X = 0.5;
const SKEW_Y = 0.2;

function project(x: number, y: number, z: number): { x: number; y: number } {
  return { x: x + z * SKEW_X, y: -y - z * SKEW_Y };
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

  const lift = (part: BlueprintPart): number =>
    part.location === 'left_leg' || part.location === 'right_leg' || part.location === null
      ? 0
      : plan.torsoY;

  const placed = plan.parts.map((part) => {
    const centre = project(part.at[0], part.at[1] + lift(part), part.at[2]);
    return { part, centre, w: part.size[0], h: part.size[1] };
  });

  // Frame the machine from what it actually occupies, so a hundred-tonne siege
  // hull and a light scout both fill the panel instead of one rattling in it.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { centre, w, h } of placed) {
    minX = Math.min(minX, centre.x - w / 2);
    maxX = Math.max(maxX, centre.x + w / 2);
    minY = Math.min(minY, centre.y - h / 2);
    maxY = Math.max(maxY, centre.y + h / 2);
  }

  const pad = 0.35;
  const frameWidth = maxX - minX + pad * 2;
  const frameHeight = maxY - minY + pad * 2;
  const viewBox = `${minX - pad} ${minY - pad} ${frameWidth} ${frameHeight}`;
  // Markers are drawn in blueprint units, so they have to be sized against the
  // frame or they swamp a wide siege hull and vanish on a light scout.
  const markerRadius = Math.max(frameWidth, frameHeight) * 0.055;

  // Far side first, so the near side of the machine reads on top of it.
  const ordered = [...placed].sort((a, b) => a.part.at[2] - b.part.at[2]);

  const mounted = new Map<MechLocation, number>();
  for (const mount of design.mounts) {
    mounted.set(mount.location, (mounted.get(mount.location) ?? 0) + 1);
  }

  return (
    <svg
      className="chassis-silhouette"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${chassis.name} outline`}
      data-testid="chassis-silhouette"
    >
      {ordered.map(({ part, centre, w, h }, index) => {
        const far = part.at[2] < -0.01;
        const lit = active !== null && part.location === active;
        const className = `${TONE_CLASS[part.tone]}${far ? ' sil-far' : ''}${lit ? ' sil-lit' : ''}`;

        if (part.shape === 'sphere' || part.shape === 'cylinder') {
          return (
            <ellipse
              key={index}
              cx={centre.x}
              cy={centre.y}
              rx={w / 2}
              ry={h / 2}
              className={className}
            />
          );
        }

        return (
          <rect
            key={index}
            x={centre.x - w / 2}
            y={centre.y - h / 2}
            width={w}
            height={h}
            rx={Math.min(w, h) * 0.16}
            transform={
              part.tilt === undefined
                ? undefined
                : `rotate(${(-part.tilt * 180) / Math.PI} ${centre.x} ${centre.y})`
            }
            className={className}
          />
        );
      })}

      {[...mounted.entries()].map(([location, count], slot) => {
        const anchor = plan.hardpoints[location];
        if (anchor === undefined) return null;
        const at = project(anchor[0], anchor[1] + plan.torsoY, anchor[2]);
        // Arm and torso hardpoints project to nearly the same spot on a
        // three-quarter view, so fan the badges out rather than stacking them.
        const fan = (slot / Math.max(1, mounted.size)) * Math.PI * 2;
        at.x += Math.cos(fan) * markerRadius * 1.9;
        at.y += Math.sin(fan) * markerRadius * 1.9;
        return (
          <g key={location} className={active === location ? 'sil-lit' : ''}>
            <circle cx={at.x} cy={at.y} r={markerRadius} className="sil-mount" />
            <text
              x={at.x}
              y={at.y + markerRadius * 0.36}
              className="sil-mount-count"
              style={{ fontSize: `${markerRadius}px` }}
            >
              {count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
