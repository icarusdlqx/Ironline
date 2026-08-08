import { Container, Graphics } from 'pixi.js';
import type { MechLocation } from '../schema/common';
import { isImmobile, isOperational, type EntityId, type MechEntity } from '../sim/types';
import { shade, teamColour, UI } from './palette';

const CLASS_RADIUS: Record<string, number> = {
  light: 11,
  medium: 13,
  heavy: 15,
  assault: 17,
};

export interface Interpolated {
  x: number;
  y: number;
  facing: number;
  /** Torso twist relative to the hull, in radians. */
  torso: number;
}

function radiusFor(tonnage: number): number {
  if (tonnage <= 35) return CLASS_RADIUS.light ?? 11;
  if (tonnage <= 55) return CLASS_RADIUS.medium ?? 13;
  if (tonnage <= 75) return CLASS_RADIUS.heavy ?? 15;
  return CLASS_RADIUS.assault ?? 17;
}

function healthFraction(entity: MechEntity): number {
  let current = 0;
  let maximum = 0;
  for (const state of Object.values(entity.locations)) {
    current += state.armour + state.internal;
    maximum += state.armourMax + state.internalMax;
  }
  return maximum === 0 ? 0 : current / maximum;
}

function damageSignature(entity: MechEntity): string {
  const lost = (Object.entries(entity.locations) as [MechLocation, { destroyed: boolean }][])
    .filter(([, state]) => state.destroyed)
    .map(([location]) => location)
    .join(',');
  return `${lost}|${Math.round(healthFraction(entity) * 20)}|${entity.destroyed ? 'x' : 'o'}`;
}

function tintOf(entity: MechEntity, colour: number, alpha: number): { color: number; alpha: number } {
  const health = healthFraction(entity);
  return {
    color: entity.destroyed ? 0x3a3a3a : shade(colour, 0.45 + 0.55 * health),
    alpha,
  };
}

/** The legs and hips, which face wherever the mech is walking. */
export function drawHull(
  hull: Graphics,
  entity: MechEntity,
  colour: number,
  alpha: number,
): void {
  hull.clear();

  const radius = radiusFor(entity.tonnage);
  const fill = tintOf(entity, colour, alpha);

  if (!entity.locations.left_leg.destroyed) {
    hull.rect(-0.95 * radius, -0.5 * radius, 0.5 * radius, 0.38 * radius).fill(fill);
  }
  if (!entity.locations.right_leg.destroyed) {
    hull.rect(-0.95 * radius, 0.12 * radius, 0.5 * radius, 0.38 * radius).fill(fill);
  }

  // The hull centreline: with the torso twisted away, this is what shows you
  // which way the mech will actually walk.
  hull
    .moveTo(0, 0)
    .lineTo(1.35 * radius, 0)
    .stroke({ width: 1, color: shade(colour, 1.5), alpha: alpha * 0.45 });
}

/** Everything above the waist, which turns with the guns. */
export function drawSilhouette(
  body: Graphics,
  entity: MechEntity,
  colour: number,
  alpha: number,
): void {
  body.clear();

  const radius = radiusFor(entity.tonnage);
  const fill = tintOf(entity, colour, alpha);

  if (!entity.locations.left_arm.destroyed) {
    body.rect(-0.2 * radius, -0.85 * radius, 0.7 * radius, 0.35 * radius).fill(fill);
  }
  if (!entity.locations.right_arm.destroyed) {
    body.rect(-0.2 * radius, 0.5 * radius, 0.7 * radius, 0.35 * radius).fill(fill);
  }

  body
    .poly([
      -0.5 * radius,
      -0.45 * radius,
      0.6 * radius,
      -0.35 * radius,
      1.0 * radius,
      0,
      0.6 * radius,
      0.35 * radius,
      -0.5 * radius,
      0.45 * radius,
    ])
    .fill(fill)
    .stroke({ width: 1, color: 0x000000, alpha: 0.5 });

  const headDestroyed = entity.locations.head.destroyed;
  body
    .circle(0.5 * radius, 0, 0.2 * radius)
    .fill({ color: headDestroyed ? 0x772222 : shade(colour, 1.35), alpha });

  body
    .poly([1.0 * radius, -0.13 * radius, 1.5 * radius, 0, 1.0 * radius, 0.13 * radius])
    .fill({ color: shade(colour, 1.5), alpha });

  if (isImmobile(entity) && !entity.destroyed) {
    body.circle(0, 0, radius * 1.1).stroke({ width: 2, color: 0xff6b6b, alpha: 0.8 });
  }
}

export class MechLayer {
  readonly container = new Container();
  private readonly views = new Map<
    EntityId,
    { root: Container; torso: Container; hull: Graphics; body: Graphics; signature: string }
  >();
  private readonly overlay = new Graphics();

  constructor() {
    this.container.addChild(this.overlay);
  }

  draw(
    entities: readonly MechEntity[],
    positions: ReadonlyMap<EntityId, Interpolated>,
    visible: (entity: MechEntity) => boolean,
    selection: ReadonlySet<EntityId>,
  ): void {
    this.overlay.clear();

    for (const entity of entities) {
      const shown = visible(entity);
      let view = this.views.get(entity.id);

      if (view === undefined) {
        const root = new Container();
        const hull = new Graphics();
        const torso = new Container();
        const body = new Graphics();
        torso.addChild(body);
        root.addChild(hull, torso);
        this.container.addChild(root);
        view = { root, torso, hull, body, signature: '' };
        this.views.set(entity.id, view);
      }

      view.root.visible = shown;
      if (!shown) continue;

      const signature = damageSignature(entity);
      if (signature !== view.signature) {
        drawHull(view.hull, entity, teamColour(entity.team), 1);
        drawSilhouette(view.body, entity, teamColour(entity.team), 1);
        view.signature = signature;
      }

      const interpolated = positions.get(entity.id);
      view.root.position.set(interpolated?.x ?? entity.pos.x, interpolated?.y ?? entity.pos.y);
      view.root.rotation = interpolated?.facing ?? entity.facing;
      view.torso.rotation = interpolated?.torso ?? entity.torsoOffset;
      view.root.alpha = entity.destroyed ? 0.55 : 1;

      const radius = radiusFor(entity.tonnage);
      const x = interpolated?.x ?? entity.pos.x;
      const y = interpolated?.y ?? entity.pos.y;

      if (selection.has(entity.id)) {
        this.overlay
          .circle(x, y, radius * 1.6)
          .stroke({ width: 2, color: UI.selection, alpha: 0.9 });
      }

      if (isOperational(entity) && entity.heat > 0) {
        const fraction = Math.min(1, entity.heat / entity.heatCapacity);
        if (fraction > 0.4) {
          this.overlay
            .circle(x, y, radius * 1.25)
            .stroke({ width: 2, color: 0xff7a3c, alpha: 0.25 + 0.5 * fraction });
        }
      }

      if (entity.shutdownRemaining > 0) {
        this.overlay
          .circle(x, y, radius * 1.45)
          .stroke({ width: 2, color: 0x6f7bff, alpha: 0.85 });
      }
    }
  }

  drawGhost(x: number, y: number, team: number): void {
    this.overlay.circle(x, y, 9).stroke({ width: 2, color: UI.ghost, alpha: 0.5 });
    this.overlay
      .poly([x - 5, y - 5, x + 5, y - 5, x + 5, y + 5, x - 5, y + 5])
      .fill({ color: teamColour(team), alpha: 0.18 });
  }

  get overlayGraphics(): Graphics {
    return this.overlay;
  }
}
