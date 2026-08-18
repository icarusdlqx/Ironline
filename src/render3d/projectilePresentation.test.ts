import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { placeProjectile, projectileTrack } from './projectilePresentation';

const FORWARD = new Vector3(1, 0, 0);

describe('projectile trajectories', () => {
  it('derives flight time from the authored velocity', () => {
    const from = new Vector3(0, 0, 0);
    const to = new Vector3(110, 0, 0);

    expect(projectileTrack(from, to, 0, 1100).duration).toBeCloseTo(0.1);
    expect(projectileTrack(from, to, 0, 175).duration).toBeCloseTo(110 / 175);
  });

  it('points a lofted round uphill and then down along its tangent', () => {
    const track = projectileTrack(new Vector3(0, 0, 0), new Vector3(100, 0, 0), 40, 500);
    const mesh = new Object3D();
    const direction = new Vector3();

    placeProjectile(mesh, track, 0.2, 2);
    direction.copy(FORWARD).applyQuaternion(mesh.quaternion);
    expect(direction.y).toBeGreaterThan(0);

    placeProjectile(mesh, track, 0.8, 2);
    direction.copy(FORWARD).applyQuaternion(mesh.quaternion);
    expect(direction.y).toBeLessThan(0);
  });
});
