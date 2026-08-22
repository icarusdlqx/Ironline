import { Vector3 } from 'three';
import { radiusFor } from '../render/shape';
import { jumpHeight } from '../sim/movement';
import {
  isOperational,
  type EntityId,
  type MechEntity,
  type Vec2,
  type World,
} from '../sim/types';
import type { TacticalCamera, Viewport } from './camera';

export interface PickableUnitView {
  model: {
    root: { visible: boolean };
    height: number;
  };
}

/** Screen projection and hit testing share the same rendered pose callbacks. */
export class UnitPicking {
  private readonly delta = new Vector3();

  constructor(
    private readonly heightAt: (x: number, y: number) => number,
    private readonly at: (entity: MechEntity) => Vec2,
    private readonly viewOf: (id: EntityId) => PickableUnitView | undefined,
  ) {}

  screenBodyOf(
    entity: MechEntity,
    camera: TacticalCamera,
    viewport: Viewport,
  ): { x: number; y: number; radius: number } {
    const at = this.at(entity);
    const ground = this.heightAt(at.x, at.y);
    const size = radiusFor(entity.tonnage);
    const centre = camera.worldToScreen(at, viewport, ground + size);
    const top = camera.worldToScreen(at, viewport, ground + size * 2);
    return { x: centre.x, y: centre.y, radius: Math.abs(top.y - centre.y) };
  }

  entityAtScreen(
    world: World,
    screen: Vec2,
    radiusPixels: number,
    camera: TacticalCamera,
    viewport: Viewport,
    wanted: (entity: MechEntity) => boolean,
  ): MechEntity | null {
    const visible = (entity: MechEntity): boolean =>
      (world.vision === null ||
        entity.team === world.vision.team ||
        world.vision.visible.has(entity.id)) &&
      wanted(entity);

    const ray = camera.rayAt(screen, viewport);
    let bodyHit: MechEntity | null = null;
    let bodyAlong = Infinity;
    for (const entity of world.entities) {
      if (!visible(entity) || !isOperational(entity)) continue;
      const view = this.viewOf(entity.id);
      if (view === undefined || !view.model.root.visible) continue;

      const at = this.at(entity);
      const height = view.model.height;
      const radius = radiusFor(entity.tonnage) * 1.2;
      const lift = jumpHeight(entity) * radiusFor(entity.tonnage) * 2.2;
      const footY = this.heightAt(at.x, at.y) + lift;

      this.delta.set(at.x - ray.origin.x, footY - ray.origin.y, at.y - ray.origin.z);
      const d = ray.direction;
      const dDotUp = d.y;
      const denominator = 1 - dDotUp * dDotUp;
      let along: number;
      let up: number;
      if (denominator < 1e-6) {
        along = this.delta.dot(d);
        up = 0;
      } else {
        const deltaDotD = this.delta.dot(d);
        const deltaDotUp = this.delta.y;
        along = (deltaDotD - dDotUp * deltaDotUp) / denominator;
        up = Math.max(0, Math.min(height, along * dDotUp - deltaDotUp));
        along = deltaDotD + up * dDotUp;
      }
      if (along < 0 || along >= bodyAlong) continue;

      const gapX = this.delta.x - along * d.x;
      const gapY = this.delta.y + up - along * d.y;
      const gapZ = this.delta.z - along * d.z;
      if (gapX * gapX + gapY * gapY + gapZ * gapZ > radius * radius) continue;
      bodyHit = entity;
      bodyAlong = along;
    }
    if (bodyHit !== null) return bodyHit;

    let best: MechEntity | null = null;
    let bestRange = radiusPixels;
    for (const entity of world.entities) {
      if (!visible(entity)) continue;
      const at = this.at(entity);
      const body = camera.worldToScreen(
        at,
        viewport,
        this.heightAt(at.x, at.y) + radiusFor(entity.tonnage),
      );
      const range = Math.hypot(body.x - screen.x, body.y - screen.y);
      if (range < bestRange) {
        best = entity;
        bestRange = range;
      }
    }
    return best;
  }
}
