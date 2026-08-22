import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { Weapon } from '../schema/weapon';
import { TracerLayer } from './tracers';

function visual(
  style: Weapon['visual']['style'],
  width = 2,
  arc = 0,
): Weapon['visual'] {
  return { style, colour: '#ffffff', width, arc };
}

function pool(layer: TracerLayer, name: string): InstancedMesh {
  const mesh = layer.group.getObjectByName(`shot-${name}`);
  expect(mesh).toBeInstanceOf(InstancedMesh);
  return mesh as InstancedMesh;
}

function positionAt(mesh: InstancedMesh, index = 0): Vector3 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixPosition(matrix);
}

function scaleAt(mesh: InstancedMesh, index = 0): Vector3 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixScale(matrix);
}

function visibleInstances(mesh: InstancedMesh): number {
  let visible = 0;
  for (let index = 0; index < mesh.count; index += 1) {
    if (scaleAt(mesh, index).lengthSq() > 1e-8) visible += 1;
  }
  return visible;
}

describe('authored shot presentation', () => {
  it('starts the firing read at the supplied muzzle', () => {
    const layer = new TracerLayer();
    const muzzle = new Vector3(41, 27, 53);
    layer.fire(muzzle, { x: 140, y: 80 }, visual('beam', 4), 1, null, 0xffffff, () => 0);

    const flash = pool(layer, 'burst');
    const beam = pool(layer, 'beam');
    expect(positionAt(flash).equals(muzzle)).toBe(true);
    expect(beam.geometry.type).toBe('CylinderGeometry');
    expect((beam.geometry as CylinderGeometry).parameters.radiusTop).toBe(1);
    expect(scaleAt(beam).x).toBeCloseTo(1.28);
  });

  it('keeps pulse packets in one draw batch', () => {
    const layer = new TracerLayer();
    layer.fire(new Vector3(), { x: 120, y: 0 }, visual('pulse', 3), 1, null, 0xffffff, () => 0);

    expect(visibleInstances(pool(layer, 'pulse'))).toBe(5);
    expect(layer.stats().families.pulse.active).toBe(1);
  });

  it('uses the authored missile arc', () => {
    const low = new TracerLayer();
    const high = new TracerLayer();
    const muzzle = new Vector3(0, 14, 0);
    low.fire(muzzle, { x: 140, y: 0 }, visual('missile', 2, 8), 1, 340, 0xffffff, () => 0);
    high.fire(muzzle, { x: 140, y: 0 }, visual('missile', 2, 58), 1, 340, 0xffffff, () => 0);
    low.update(0.1);
    high.update(0.1);

    expect(positionAt(pool(high, 'missile')).y)
      .toBeGreaterThan(positionAt(pool(low, 'missile')).y);
  });

  it('moves travelling rounds at their catalogue velocity', () => {
    const slow = new TracerLayer();
    const fast = new TracerLayer();
    const muzzle = new Vector3(0, 14, 0);
    slow.fire(muzzle, { x: 110, y: 0 }, visual('slug', 2), 1, 175, 0xffffff, () => 0);
    fast.fire(muzzle, { x: 110, y: 0 }, visual('slug', 2), 1, 1100, 0xffffff, () => 0);
    slow.update(0.05);
    fast.update(0.05);

    expect(positionAt(pool(fast, 'slug')).x).toBeCloseTo(55);
    expect(positionAt(pool(slow, 'slug')).x).toBeCloseTo(8.75);
  });

  it('keeps a close fast round visible for its first rendered frame', () => {
    const layer = new TracerLayer();
    layer.fire(
      new Vector3(0, 14, 0),
      { x: 10, y: 0 },
      visual('slug', 2),
      1,
      1100,
      0xffffff,
      () => 0,
    );
    layer.update(1 / 30);

    expect(layer.stats().families.slug.active).toBe(1);
    expect(positionAt(pool(layer, 'slug')).x).toBeCloseTo(10);
  });

  it('batches canister and burst rounds without adding scene children', () => {
    for (const style of ['tracer', 'burst'] as const) {
      const layer = new TracerLayer();
      const children = layer.group.children.length;
      layer.fire(
        new Vector3(0, 14, 0),
        { x: 100, y: 0 },
        visual(style),
        12,
        500,
        0xffffff,
        () => 0,
      );

      expect(layer.group.children).toHaveLength(children);
      expect(layer.stats().families.shell.active).toBe(6);
      expect(visibleInstances(pool(layer, 'shell'))).toBe(6);
    }
  });

  it('shows instant energy reads across the resolved shot path', () => {
    const muzzle = new Vector3(0, 14, 0);
    const bolt = new TracerLayer();
    const flame = new TracerLayer();
    bolt.fire(muzzle, { x: 100, y: 0 }, visual('bolt', 4), 1, null, 0xffffff, () => 0);
    flame.fire(muzzle, { x: 100, y: 0 }, visual('flame', 6), 1, null, 0xffffff, () => 0);

    const boltRead = pool(bolt, 'bolt');
    expect(visibleInstances(boltRead)).toBe(9);
    expect(positionAt(boltRead, 8).x).toBeCloseTo(100);
    expect(visibleInstances(pool(flame, 'flame'))).toBe(8);
  });

  it('keeps smoke growth bounded over its lifetime', () => {
    const layer = new TracerLayer();
    layer.spawnSmoke({ x: 0, y: 0 }, 0);
    const smoke = pool(layer, 'smoke');

    layer.update(1.3);
    expect(scaleAt(smoke).x).toBeCloseTo(2.2);
    layer.update(1.29);
    expect(scaleAt(smoke).x).toBeLessThanOrEqual(3.4);
  });

  it('keeps ammo bursts materially smaller and shorter than terminal deaths', () => {
    const ammo = new TracerLayer();
    const terminal = new TracerLayer();
    ammo.burst({ x: 0, y: 0 }, 0, 'ammo', 0xffffff, 1);
    terminal.burst({ x: 0, y: 0 }, 0, 'terminal', 0xffffff, 1);

    expect(scaleAt(pool(terminal, 'burst')).x)
      .toBeGreaterThan(scaleAt(pool(ammo, 'burst')).x);
    ammo.update(0.6);
    terminal.update(0.6);
    expect(ammo.stats().families.burst.active).toBe(0);
    expect(terminal.stats().families.burst.active).toBe(1);
  });
});
