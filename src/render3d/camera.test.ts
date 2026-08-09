import { describe, expect, it } from 'vitest';
import { TacticalCamera } from './camera';

const VIEWPORT = { width: 1280, height: 720 };

function camera(): TacticalCamera {
  const built = new TacticalCamera();
  built.setBounds(960, 960);
  built.centreOn({ x: 480, y: 480 });
  return built;
}

describe('tactical camera', () => {
  it('round-trips a ground point through the screen', () => {
    // Every control that turns a click into an order depends on this holding.
    const view = camera();
    for (const point of [
      { x: 480, y: 480 },
      { x: 300, y: 620 },
      { x: 700, y: 350 },
    ]) {
      const screen = view.worldToScreen(point, VIEWPORT);
      const back = view.screenToWorld(screen, VIEWPORT);
      expect(back.x).toBeCloseTo(point.x, 3);
      expect(back.y).toBeCloseTo(point.y, 3);
    }
  });

  it('round-trips at every zoom the player can reach', () => {
    const view = camera();
    for (const distance of [view.minDistance, 470, view.maxDistance]) {
      view.distance = distance;
      const screen = view.worldToScreen({ x: 520, y: 430 }, VIEWPORT);
      const back = view.screenToWorld(screen, VIEWPORT);
      expect(back.x, `x at ${distance}`).toBeCloseTo(520, 3);
      expect(back.y, `y at ${distance}`).toBeCloseTo(430, 3);
    }
  });

  it('drags the ground the way the pointer moved', () => {
    // Pulling the map left has to move the camera's target right.
    const view = camera();
    view.panBy(100, 0);
    expect(view.target.x).toBeGreaterThan(480);
    expect(view.target.y).toBeCloseTo(480, 6);

    const forward = camera();
    forward.panBy(0, 100);
    expect(forward.target.y).toBeLessThan(480);
    expect(forward.target.x).toBeCloseTo(480, 6);
  });

  it('holds the target inside the map however far it is dragged', () => {
    const view = camera();
    view.panBy(-10_000, -10_000);
    expect(view.target.x).toBeGreaterThanOrEqual(0);
    expect(view.target.y).toBeGreaterThanOrEqual(0);

    view.panBy(10_000, 10_000);
    expect(view.target.x).toBeLessThanOrEqual(960);
    expect(view.target.y).toBeLessThanOrEqual(960);
  });

  it('clamps how close and how far the camera can be pulled', () => {
    const view = camera();
    for (let step = 0; step < 40; step += 1) view.zoomBy(1.2);
    expect(view.distance).toBeCloseTo(view.minDistance, 6);

    for (let step = 0; step < 80; step += 1) view.zoomBy(1 / 1.2);
    expect(view.distance).toBeCloseTo(view.maxDistance, 6);
  });

  it('gives a usable point rather than NaN when the click misses the ground', () => {
    // The very top of the screen is sky at this tilt.
    const view = camera();
    const point = view.screenToWorld({ x: 640, y: 0 }, VIEWPORT);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});
