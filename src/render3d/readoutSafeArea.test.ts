import { describe, expect, it } from 'vitest';
import {
  clampReadout,
  measureReadoutLayout,
  readoutBounds,
  readoutEnvelope,
  readoutOverlaps,
  type ReadoutLayout,
} from './readoutSafeArea';

const combined =
  '-7 STRUCTURE · CRITICAL x2: WEAPON / HEAT SINK';

function expectClear(
  point: { x: number; y: number },
  label: string,
  layout: ReadoutLayout,
  reducedMotion = false,
): void {
  const envelope = readoutEnvelope(label, layout.width, reducedMotion, layout.height);
  expect(layout.obstacles.some((obstacle) => readoutOverlaps(point, envelope, obstacle))).toBe(false);
}

function placeTogether(
  labels: readonly string[],
  anchor: { x: number; y: number },
  layout: ReadoutLayout,
): Array<{ point: { x: number; y: number }; label: string }> {
  const occupied = [];
  const placed = [];
  for (const label of labels) {
    const point = clampReadout(anchor, label, layout, false, occupied);
    const envelope = readoutEnvelope(label, layout.width, false, layout.height);
    expectClear(point, label, layout);
    expect(occupied.some((obstacle) => readoutOverlaps(point, envelope, obstacle))).toBe(false);
    occupied.push(readoutBounds(point, envelope));
    placed.push({ point, label });
  }
  return placed;
}

describe('damage readout safe area', () => {
  it('does not reserve the closed mobile menu sheet', () => {
    const rect = {
      left: 0,
      top: 0,
      right: 390,
      bottom: 844,
      width: 390,
      height: 844,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const nestedAction = {
      closest: () => ({}),
      getBoundingClientRect: () => rect,
    };
    const app = { querySelectorAll: () => [nestedAction] };
    const host = {
      clientWidth: 390,
      clientHeight: 844,
      parentElement: app,
      getBoundingClientRect: () => rect,
    };

    expect(measureReadoutLayout(host as unknown as HTMLElement).obstacles).toEqual([]);
  });

  it('lifts a desktop readout above the lance and support HUD', () => {
    const layout: ReadoutLayout = {
      width: 1280,
      height: 800,
      obstacles: [
        { left: 0, top: 0, right: 1280, bottom: 212 },
        { left: 12, top: 578, right: 980, bottom: 788 },
        { left: 1000, top: 52, right: 1268, bottom: 547 },
      ],
    };

    const point = clampReadout({ x: 640, y: 755 }, combined, layout, false);

    expect(point.x).toBeCloseTo(640);
    expect(point.y).toBeLessThan(578);
    expectClear(point, combined, layout);
  });

  it('keeps a phone readout between the top HUD and command dock', () => {
    const layout: ReadoutLayout = {
      width: 390,
      height: 844,
      obstacles: [
        { left: 0, top: 0, right: 390, bottom: 52 },
        { left: 8, top: 58, right: 218, bottom: 102 },
        { left: 278, top: 58, right: 382, bottom: 162 },
        { left: 8, top: 626, right: 382, bottom: 836 },
      ],
    };

    const point = clampReadout({ x: 195, y: 730 }, combined, layout, false);

    expect(point.x).toBeCloseTo(195);
    expect(point.y).toBeGreaterThan(162);
    expect(point.y).toBeLessThan(626);
    expectClear(point, combined, layout);
  });

  it('clamps offscreen projections without motion-dependent overflow', () => {
    const layout: ReadoutLayout = { width: 390, height: 844, obstacles: [] };
    const point = clampReadout({ x: -40, y: 900 }, 'MISS', layout, true);
    const envelope = readoutEnvelope('MISS', layout.width, true, layout.height);

    expect(point.x - envelope.halfWidth).toBeGreaterThanOrEqual(8);
    expect(point.y + envelope.below).toBeLessThanOrEqual(layout.height - 8);
  });

  it('gives three desktop plates separate full-motion lanes', () => {
    const layout: ReadoutLayout = {
      width: 1280,
      height: 800,
      obstacles: [
        { left: 0, top: 0, right: 1280, bottom: 212 },
        { left: 12, top: 578, right: 980, bottom: 788 },
        { left: 1000, top: 52, right: 1268, bottom: 547 },
      ],
    };
    const placed = placeTogether(
      ['-12 ARMOUR', '-7 STRUCTURE', 'DESTROYED'],
      { x: 640, y: 755 },
      layout,
    );

    expect(new Set(placed.map(({ point }) => `${point.x}:${point.y}`))).toHaveLength(3);
  });

  it('keeps three phone plates separate above the bottom safe area', () => {
    const layout: ReadoutLayout = {
      width: 390,
      height: 844,
      obstacles: [
        { left: 0, top: 0, right: 390, bottom: 52 },
        { left: 8, top: 58, right: 218, bottom: 102 },
        { left: 278, top: 58, right: 382, bottom: 162 },
        { left: 8, top: 626, right: 382, bottom: 836 },
      ],
    };
    const placed = placeTogether(
      ['-12 ARMOUR', '-7 STRUCTURE', 'DESTROYED'],
      { x: 195, y: 830 },
      layout,
    );

    expect(placed).toHaveLength(3);
    for (const { point, label } of placed) {
      const envelope = readoutEnvelope(label, layout.width, false, layout.height);
      expect(point.y + envelope.below).toBeLessThan(626);
    }
  });

  it('budgets wrapped consequence copy with the compact CSS width', () => {
    const layout: ReadoutLayout = { width: 390, height: 844, obstacles: [] };
    const short = readoutEnvelope('DESTROYED', layout.width, false, layout.height);
    const wrapped = readoutEnvelope(
      'AMMO DETONATION · LEFT TORSO / RIGHT TORSO LOST',
      layout.width,
      false,
      layout.height,
    );

    expect(wrapped.above).toBeGreaterThan(short.above);
    expect(wrapped.halfWidth * 2).toBeLessThanOrEqual(layout.width * 0.68);
  });
});
