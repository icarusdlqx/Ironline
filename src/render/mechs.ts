import { Container, Graphics } from 'pixi.js';
import type { MechLocation } from '../schema/common';
import { isImmobile, isOperational, type EntityId, type MechEntity } from '../sim/types';
import { teamColour, UI } from './palette';
import {
  DEFAULT_SILHOUETTE,
  drawLegs,
  drawTorso,
  radiusFor,
  type MountArt,
  type Silhouette,
  type WeaponArtLookup,
} from './silhouettes';

/** Resolves a chassis id to the outline that chassis is drawn with. */
export type SilhouetteLookup = (chassisId: string) => Silhouette | undefined;

export interface Interpolated {
  x: number;
  y: number;
  facing: number;
  /** Torso twist relative to the hull, in radians. */
  torso: number;
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
  const guns = entity.weapons.map((mount) => (mount.destroyed ? '0' : '1')).join('');
  return `${lost}|${guns}|${Math.round(healthFraction(entity) * 20)}|${entity.destroyed ? 'x' : 'o'}`;
}

/** The hardware bolted to this hull, in the order it should be drawn. */
function mountsOf(entity: MechEntity, weaponArt: WeaponArtLookup): MountArt[] {
  const art: MountArt[] = [];
  for (const mount of entity.weapons) {
    const weapon = weaponArt(mount.weaponId);
    if (weapon === undefined) continue;
    art.push({
      location: mount.location,
      type: weapon.type,
      tonnage: weapon.tonnage,
      destroyed: mount.destroyed,
    });
  }
  // Heaviest last so the big hardware sits on top of the small.
  return art.sort((a, b) => a.tonnage - b.tonnage);
}

/** The legs and hips, which face wherever the mech is walking. */
export function drawHull(
  hull: Graphics,
  entity: MechEntity,
  shape: Silhouette,
  colour: number,
  alpha: number,
): void {
  hull.clear();
  drawLegs(hull, entity, shape, radiusFor(entity.tonnage), colour, alpha);
}

/** Everything above the waist, which turns with the guns. */
export function drawSilhouette(
  body: Graphics,
  entity: MechEntity,
  shape: Silhouette,
  colour: number,
  alpha: number,
  mounts: readonly MountArt[],
): void {
  body.clear();
  const radius = radiusFor(entity.tonnage);
  drawTorso(body, entity, shape, radius, colour, alpha, mounts);

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
    silhouetteOf: SilhouetteLookup,
    weaponArt: WeaponArtLookup,
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
        const shape = silhouetteOf(entity.chassisId) ?? DEFAULT_SILHOUETTE;
        drawHull(view.hull, entity, shape, teamColour(entity.team), 1);
        drawSilhouette(
          view.body,
          entity,
          shape,
          teamColour(entity.team),
          1,
          mountsOf(entity, weaponArt),
        );
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
