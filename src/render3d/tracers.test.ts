import { CylinderGeometry, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
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

describe('authored shot presentation', () => {
  it('starts the firing read at the supplied muzzle', () => {
    const layer = new TracerLayer();
    const muzzle = new Vector3(41, 27, 53);
    layer.fire(muzzle, { x: 140, y: 80 }, visual('beam', 4), 1, null, 0xffffff, () => 0);

    const flash = layer.group.children[0];
    const beam = layer.group.children[1] as Mesh;
    expect(flash?.position.equals(muzzle)).toBe(true);
    expect(beam.geometry.type).toBe('CylinderGeometry');
    expect((beam.geometry as CylinderGeometry).parameters.radiusTop).toBeCloseTo(1.28);
  });

  it('keeps pulse packets in one draw batch', () => {
    const layer = new TracerLayer();
    layer.fire(new Vector3(), { x: 120, y: 0 }, visual('pulse', 3), 1, null, 0xffffff, () => 0);

    const packet = layer.group.children[1];
    expect(packet).toBeInstanceOf(InstancedMesh);
    expect((packet as InstancedMesh).count).toBe(5);
  });

  it('uses the authored missile arc', () => {
    const low = new TracerLayer();
    const high = new TracerLayer();
    const muzzle = new Vector3(0, 14, 0);
    low.fire(muzzle, { x: 140, y: 0 }, visual('missile', 2, 8), 1, 340, 0xffffff, () => 0);
    high.fire(muzzle, { x: 140, y: 0 }, visual('missile', 2, 58), 1, 340, 0xffffff, () => 0);
    low.update(0.1);
    high.update(0.1);

    expect(high.group.children[1]?.position.y).toBeGreaterThan(low.group.children[1]?.position.y ?? 0);
  });

  it('moves travelling rounds at their catalogue velocity', () => {
    const slow = new TracerLayer();
    const fast = new TracerLayer();
    const muzzle = new Vector3(0, 14, 0);
    slow.fire(muzzle, { x: 110, y: 0 }, visual('slug', 2), 1, 175, 0xffffff, () => 0);
    fast.fire(muzzle, { x: 110, y: 0 }, visual('slug', 2), 1, 1100, 0xffffff, () => 0);
    slow.update(0.05);
    fast.update(0.05);

    expect(fast.group.children[1]?.position.x).toBeCloseTo(55);
    expect(slow.group.children[1]?.position.x).toBeCloseTo(8.75);
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

    expect(layer.group.children).toHaveLength(2);
    expect(layer.group.children[1]?.position.x).toBeCloseTo(10);
  });

  it('batches canister and burst rounds into one draw', () => {
    for (const style of ['tracer', 'burst'] as const) {
      const layer = new TracerLayer();
      layer.fire(new Vector3(0, 14, 0), { x: 100, y: 0 }, visual(style), 12, 500, 0xffffff, () => 0);

      expect(layer.group.children).toHaveLength(2);
      expect(layer.group.children[1]).toBeInstanceOf(InstancedMesh);
      expect((layer.group.children[1] as InstancedMesh).count).toBe(6);
    }
  });

  it('shows instant energy reads across the resolved shot path', () => {
    const muzzle = new Vector3(0, 14, 0);
    const bolt = new TracerLayer();
    const flame = new TracerLayer();
    const slug = new TracerLayer();
    bolt.fire(muzzle, { x: 100, y: 0 }, visual('bolt', 4), 1, null, 0xffffff, () => 0);
    flame.fire(muzzle, { x: 100, y: 0 }, visual('flame', 6), 1, null, 0xffffff, () => 0);
    slug.fire(muzzle, { x: 100, y: 0 }, visual('slug', 3), 1, 1100, 0xffffff, () => 0);

    const boltRead = bolt.group.children[1] as InstancedMesh;
    const flameRead = flame.group.children[1] as InstancedMesh;
    const last = new Matrix4();
    const end = new Vector3();
    boltRead.getMatrixAt(boltRead.count - 1, last);
    end.setFromMatrixPosition(last);
    expect(boltRead.count).toBe(9);
    expect(end.x).toBeCloseTo(100);
    expect(flameRead.count).toBe(8);
    expect((slug.group.children[1] as Mesh).geometry.type).toBe('BoxGeometry');
  });

  it('keeps smoke growth bounded over its lifetime', () => {
    const layer = new TracerLayer();
    layer.spawnSmoke({ x: 0, y: 0 }, 0);
    const smoke = layer.group.children[0];

    layer.update(1.3);
    expect(smoke?.scale.x).toBeCloseTo(2.2);
    layer.update(1.29);
    expect(smoke?.scale.x).toBeLessThanOrEqual(3.4);
  });
});
