import { describe, expect, it } from 'vitest';
import { OrbitCamera } from './camera';

const VIEWPORT = { width: 1280, height: 720 };

function camera(azimuth: number, elevation = 52 * (Math.PI / 180)): OrbitCamera {
  const built = new OrbitCamera();
  built.setBounds(960, 960);
  built.centreOn({ x: 480, y: 480 });
  built.azimuth = azimuth;
  built.elevation = elevation;
  return built;
}

describe('orbit camera', () => {
  it('round-trips a ground point through the screen at any bearing', () => {
    // Every control that turns a click into an order depends on this holding
    // once the camera can be spun. It is the whole risk of a rotating camera.
    for (let turn = 0; turn < 8; turn += 1) {
      const view = camera((turn / 8) * Math.PI * 2);
      for (const point of [
        { x: 480, y: 480 },
        { x: 300, y: 620 },
        { x: 700, y: 350 },
      ]) {
        const screen = view.worldToScreen(point, VIEWPORT);
        const back = view.screenToWorld(screen, VIEWPORT);
        expect(back.x, `x at turn ${turn}`).toBeCloseTo(point.x, 3);
        expect(back.y, `y at turn ${turn}`).toBeCloseTo(point.y, 3);
      }
    }
  });

  it('round-trips at the shallowest and steepest tilt it allows', () => {
    for (const elevation of [14 * (Math.PI / 180), 84 * (Math.PI / 180)]) {
      const view = camera(-Math.PI / 2, elevation);
      const screen = view.worldToScreen({ x: 520, y: 430 }, VIEWPORT);
      const back = view.screenToWorld(screen, VIEWPORT);
      expect(back.x).toBeCloseTo(520, 3);
      expect(back.y).toBeCloseTo(430, 3);
    }
  });

  it('pans along the ground the player is looking at, not the world axes', () => {
    // Dragging right has to push the map right however the camera is spun.
    const straight = camera(-Math.PI / 2);
    straight.panBy(100, 0);
    const first = { ...straight.target };

    const spun = camera(0);
    spun.panBy(100, 0);

    expect(first).not.toEqual(spun.target);
    // A quarter turn of the camera turns the pan by a quarter turn too.
    expect(spun.target.y - 480).toBeCloseTo(first.x - 480, 6);
  });

  it('keeps the tilt out of the ground and off the horizon', () => {
    const view = camera(0);
    view.orbitBy(0, -10);
    expect(view.elevation).toBeCloseTo(view.minElevation, 6);
    view.orbitBy(0, 10);
    expect(view.elevation).toBeCloseTo(view.maxElevation, 6);
  });

  it('holds the target inside the map however far it is dragged', () => {
    const view = camera(0);
    view.panBy(-10_000, -10_000);
    expect(view.target.x).toBeGreaterThanOrEqual(0);
    expect(view.target.y).toBeGreaterThanOrEqual(0);

    view.panBy(10_000, 10_000);
    expect(view.target.x).toBeLessThanOrEqual(960);
    expect(view.target.y).toBeLessThanOrEqual(960);
  });

  it('clamps how close and how far the camera can be pulled', () => {
    const view = camera(0);
    for (let step = 0; step < 40; step += 1) view.zoomBy(1.2);
    expect(view.distance).toBeCloseTo(view.minDistance, 6);

    for (let step = 0; step < 80; step += 1) view.zoomBy(1 / 1.2);
    expect(view.distance).toBeCloseTo(view.maxDistance, 6);
  });

  it('gives a usable point rather than NaN when the click misses the ground', () => {
    // Tilted right down at the horizon, the top of the screen is sky.
    const view = camera(0, 14 * (Math.PI / 180));
    const point = view.screenToWorld({ x: 640, y: 0 }, VIEWPORT);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});
