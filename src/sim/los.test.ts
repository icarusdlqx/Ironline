import { describe, expect, it } from 'vitest';
import { makeGrid, OPEN_LEGEND } from '../../tests/support';
import { coverFactorAt, lineOfSight } from './los';

describe('lineOfSight', () => {
  it('is clear across open ground', () => {
    const grid = makeGrid({ legend: OPEN_LEGEND, tiles: ['.....', '.....', '.....'] });
    const result = lineOfSight(grid, { x: 5, y: 15 }, { x: 45, y: 15 });
    expect(result.clear).toBe(true);
    expect(result.obstruction).toBe(0);
  });

  it('is blocked by a building', () => {
    const grid = makeGrid({ legend: OPEN_LEGEND, tiles: ['.....', '..b..', '.....'] });
    expect(lineOfSight(grid, { x: 5, y: 5 }, { x: 45, y: 5 }).clear).toBe(true);
    expect(lineOfSight(grid, { x: 5, y: 15 }, { x: 45, y: 15 }).clear).toBe(false);
    expect(lineOfSight(grid, { x: 25, y: 5 }, { x: 25, y: 25 }).clear).toBe(false);
  });

  it('accumulates forest obstruction — one belt is see-through, two are not', () => {
    const single = makeGrid({ legend: OPEN_LEGEND, tiles: ['..f..'] });
    expect(lineOfSight(single, { x: 5, y: 5 }, { x: 45, y: 5 }).clear).toBe(true);

    const double = makeGrid({ legend: OPEN_LEGEND, tiles: ['.ff..'] });
    const result = lineOfSight(double, { x: 5, y: 5 }, { x: 45, y: 5 });
    expect(result.clear).toBe(false);
    expect(result.obstruction).toBeGreaterThanOrEqual(1);
  });

  it('never blocks on the shooter or target tile', () => {
    const grid = makeGrid({ legend: OPEN_LEGEND, tiles: ['b...b'] });
    expect(lineOfSight(grid, { x: 5, y: 5 }, { x: 45, y: 5 }).clear).toBe(true);
  });

  it('is blocked by ground higher than both endpoints', () => {
    const grid = makeGrid({
      legend: OPEN_LEGEND,
      tiles: ['.....'],
      elevation: ['00200'],
    });
    const blocked = lineOfSight(grid, { x: 5, y: 5 }, { x: 45, y: 5 });
    expect(blocked.clear).toBe(false);
    expect(blocked.blockedByElevation).toBe(true);
  });

  it('is not blocked by ground no higher than the shooter', () => {
    const grid = makeGrid({
      legend: OPEN_LEGEND,
      tiles: ['.....'],
      elevation: ['20200'],
    });
    expect(lineOfSight(grid, { x: 5, y: 5 }, { x: 45, y: 5 }).clear).toBe(true);
  });

  it('is symmetric', () => {
    const grid = makeGrid({ legend: OPEN_LEGEND, tiles: ['.....', '..b..', '.....'] });
    const a = { x: 25, y: 5 };
    const b = { x: 25, y: 25 };
    expect(lineOfSight(grid, a, b).clear).toBe(lineOfSight(grid, b, a).clear);
  });
});

describe('coverFactorAt', () => {
  it('reads cover from the terrain under the target', () => {
    const grid = makeGrid({ legend: OPEN_LEGEND, tiles: ['.f'] });
    expect(coverFactorAt(grid, { x: 5, y: 5 })).toBe(1);
    expect(coverFactorAt(grid, { x: 15, y: 5 })).toBeLessThan(1);
  });
});
