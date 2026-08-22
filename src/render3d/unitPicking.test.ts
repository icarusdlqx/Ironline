import { Ray, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { testWorld, unitOf } from '../../tests/support';
import { radiusFor } from '../render/shape';
import type { MechEntity, Vec2 } from '../sim/types';
import type { TacticalCamera, Viewport } from './camera';
import { UnitPicking, type PickableUnitView } from './unitPicking';
import { UnitViews } from './unitViews';

const VIEWPORT: Viewport = { width: 1280, height: 720 };

describe('unit screen projection and picking', () => {
  it('keeps the UnitViews body projection contract through the delegate', () => {
    const world = testWorld('unit-body-projection');
    const entity = unitOf(world, 'hornet_spotter');
    entity.pos = { x: 10, y: 20 };
    const units = new UnitViews(new Scene(), () => 5);
    const heights: number[] = [];
    const camera = {
      worldToScreen: vi.fn((point: Vec2, _viewport: Viewport, height = 0) => {
        heights.push(height);
        return { x: point.x + height, y: point.y - height };
      }),
    } as unknown as TacticalCamera;
    const size = radiusFor(entity.tonnage);

    const body = units.screenBodyOf(entity, camera, VIEWPORT);
    expect(body.x).toBeCloseTo(10 + 5 + size);
    expect(body.y).toBeCloseTo(20 - 5 - size);
    expect(body.radius).toBeCloseTo(size);
    expect(heights).toEqual([5 + size, 5 + size * 2]);
    units.dispose();
  });

  it('chooses the nearest operational rendered body along the pick ray', () => {
    const world = testWorld('unit-body-ray');
    const near = unitOf(world, 'hornet_spotter');
    const far = unitOf(world, 'sentinel_brawler');
    near.pos = { x: 100, y: 0 };
    far.pos = { x: 180, y: 0 };
    world.entities = [far, near];
    world.vision = null;
    const views = new Map<number, PickableUnitView>([
      [near.id, { model: { root: { visible: true }, height: 40 } }],
      [far.id, { model: { root: { visible: true }, height: 40 } }],
    ]);
    const camera = {
      rayAt: vi.fn(() => new Ray(new Vector3(0, 15, 0), new Vector3(1, 0, 0))),
      worldToScreen: vi.fn(() => ({ x: 10_000, y: 10_000 })),
    } as unknown as TacticalCamera;
    const picking = new UnitPicking(
      () => 0,
      (entity) => entity.pos,
      (id) => views.get(id),
    );

    expect(picking.entityAtScreen(world, { x: 0, y: 0 }, 4, camera, VIEWPORT, () => true))
      .toBe(near);
    const nearView = views.get(near.id);
    if (nearView === undefined) throw new Error('missing near view');
    nearView.model.root.visible = false;
    expect(picking.entityAtScreen(world, { x: 0, y: 0 }, 4, camera, VIEWPORT, () => true))
      .toBe(far);
    nearView.model.root.visible = true;
    expect(
      picking.entityAtScreen(
        world,
        { x: 0, y: 0 },
        4,
        camera,
        VIEWPORT,
        (entity) => entity === far,
      ),
    ).toBe(far);
  });

  it('retains the pixel-radius fallback for a non-operational marker', () => {
    const world = testWorld('unit-pixel-fallback');
    const entity = unitOf(world, 'hornet_spotter');
    entity.pos = { x: 240, y: 320 };
    entity.destroyed = true;
    world.entities = [entity];
    world.vision = null;
    const camera = {
      rayAt: vi.fn(() => new Ray(new Vector3(0, 1_000, 0), new Vector3(1, 0, 0))),
      worldToScreen: vi.fn((point: Vec2) => ({ x: point.x, y: point.y })),
    } as unknown as TacticalCamera;
    const picking = new UnitPicking(
      () => 0,
      (candidate: MechEntity) => candidate.pos,
      () => undefined,
    );

    expect(
      picking.entityAtScreen(world, { x: 242, y: 321 }, 5, camera, VIEWPORT, () => true),
    ).toBe(entity);
    expect(
      picking.entityAtScreen(world, { x: 242, y: 321 }, 5, camera, VIEWPORT, () => false),
    ).toBeNull();
  });
});
