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
  private elapsed = 0;

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
    playerTeam: number,
    deltaSeconds: number,
  ): void {
    this.overlay.clear();
    this.elapsed += deltaSeconds;

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

      const friendly = entity.team === playerTeam;
      if (isOperational(entity)) this.drawAllegiance(x, y, radius, friendly);
      if (selection.has(entity.id)) this.drawSelection(x, y, radius);

      // Heat is an arc over the mech's shoulder, never a ring: a full ring is
      // what says friend or foe, and the two must not be confusable.
      if (isOperational(entity) && entity.heat > 0) {
        const fraction = Math.min(1, entity.heat / entity.heatCapacity);
        if (fraction > 0.4) {
          const sweep = Math.PI * 0.9 * fraction;
          this.overlay
            .arc(x, y, radius * 1.05, -Math.PI / 2 - sweep / 2, -Math.PI / 2 + sweep / 2)
            .stroke({ width: 3, color: 0xffc042, alpha: 0.5 + 0.5 * fraction });
        }
      }

      if (entity.shutdownRemaining > 0) {
        this.overlay
          .circle(x, y, radius * 1.45)
          .stroke({ width: 2, color: 0x6f7bff, alpha: 0.85 });
      }
    }
  }

  /**
   * Whose machine this is, told twice: colour and shape. A friendly stands on a
   * closed ring, a hostile inside an open bracket, so the read survives a dark
   * screen, a colour-blind player and a map full of smoke.
   */
  private drawAllegiance(x: number, y: number, radius: number, friendly: boolean): void {
    const ring = radius * 1.25;

    if (friendly) {
      this.overlay
        .circle(x, y, ring)
        .stroke({ width: 2, color: UI.friendly, alpha: 0.75 });
      this.overlay.circle(x, y, ring).fill({ color: UI.friendly, alpha: 0.09 });
      return;
    }

    // Four corner ticks, rotated 45 degrees: an obviously different silhouette.
    const arm = ring * 0.62;
    for (let index = 0; index < 4; index += 1) {
      const angle = Math.PI / 4 + (index * Math.PI) / 2;
      const cx = x + Math.cos(angle) * ring;
      const cy = y + Math.sin(angle) * ring;
      this.overlay
        .moveTo(cx - Math.cos(angle) * arm * 0.5, cy - Math.sin(angle) * arm * 0.5)
        .lineTo(cx + Math.cos(angle) * arm * 0.35, cy + Math.sin(angle) * arm * 0.35)
        .stroke({ width: 2.5, color: UI.hostile, alpha: 0.85 });
    }
    this.overlay.circle(x, y, ring).fill({ color: UI.hostile, alpha: 0.07 });
  }

  /** Selection reads as a targeting box that breathes, not a thin extra circle. */
  private drawSelection(x: number, y: number, radius: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 3.4);
    const box = radius * (1.75 + pulse * 0.1);
    const corner = box * 0.45;

    this.overlay.circle(x, y, radius * 1.45).fill({ color: UI.selection, alpha: 0.12 });

    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const cx = x + sx * box;
      const cy = y + sy * box;
      this.overlay
        .moveTo(cx - sx * corner, cy)
        .lineTo(cx, cy)
        .lineTo(cx, cy - sy * corner)
        .stroke({ width: 2.5, color: UI.selection, alpha: 0.7 + pulse * 0.3 });
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
