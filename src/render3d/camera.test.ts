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

  it('stops panning while the battlefield still fills the view', () => {
    // Clamping to the map edge alone still lets the player park on a corner
    // with most of the screen showing the ground beyond the map.
    const view = camera();
    view.distance = 470;
    view.panBy(-10_000, -10_000);
    expect(view.target.x).toBeGreaterThan(40);
    expect(view.target.y).toBeGreaterThan(40);

    view.panBy(20_000, 20_000);
    expect(view.target.x).toBeLessThan(920);
    expect(view.target.y).toBeLessThan(920);
  });

  it('never lets much of the screen be ground beyond the map', () => {
    // The guarantee is a bounded share of off-map view at any zoom, not a
    // fixed distance from the edge: what counts as "too far" depends on how
    // much ground the camera can see from where it is.
    for (const distance of [200, 470, 900, 1_100]) {
      const view = camera();
      view.distance = distance;
      view.panBy(-10_000, -10_000);

      const span = (2 * distance * Math.tan(22.5 * (Math.PI / 180))) / Math.sin(50 * (Math.PI / 180));
      const offMap = span / 2 - view.target.x;
      expect(offMap / span, `at distance ${distance}`).toBeLessThan(0.21);
    }
  });

  it('pulls the view back over the map when it zooms out', () => {
    const view = camera();
    view.distance = view.minDistance;
    view.panBy(-10_000, 0);
    const close = view.target.x;

    for (let step = 0; step < 20; step += 1) view.zoomBy(1 / 1.2);
    expect(view.target.x, 'zooming out left the map edge off screen').toBeGreaterThan(close);
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
