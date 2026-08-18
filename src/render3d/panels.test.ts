import { describe, expect, it } from 'vitest';
import { armourShell } from './panels';

const RECTANGLE = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

function widestAt(
  values: Float32Array,
  predicate: (x: number, y: number) => boolean,
): number {
  let widest = 0;
  for (let index = 0; index < values.length; index += 3) {
    const x = values[index];
    const y = values[index + 1];
    const z = values[index + 2];
    if (x !== undefined && y !== undefined && z !== undefined && predicate(x, y)) {
      widest = Math.max(widest, Math.abs(z));
    }
  }
  return widest;
}

describe('armourShell', () => {
  it('tapers the transverse width toward the nose and crown', () => {
    const geometry = armourShell(RECTANGLE, 2, { front: 0.55, top: 0.65, edge: 0.08 });
    const positions = geometry.getAttribute('position').array as Float32Array;

    expect(widestAt(positions, (x) => x < -0.8)).toBeGreaterThan(
      widestAt(positions, (x) => x > 0.8),
    );
    expect(widestAt(positions, (_x, y) => y < -0.8)).toBeGreaterThan(
      widestAt(positions, (_x, y) => y > 0.8),
    );
  });

  it('keeps its triangle count proportional to the outline', () => {
    const geometry = armourShell(RECTANGLE, 2, {});
    const positions = geometry.getAttribute('position');

    expect(positions.count / 3).toBe(RECTANGLE.length * 8);
    expect(Array.from(positions.array)).toSatisfy((values: number[]) =>
      values.every(Number.isFinite),
    );
  });

  it('normalises legacy clockwise profiles before building faces', () => {
    const geometry = armourShell([...RECTANGLE].reverse(), 2, {});
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    let frontNormals = 0;
    for (let index = 0; index < positions.count; index += 1) {
      if (positions.getZ(index) > 0.9) frontNormals += normals.getZ(index);
    }

    expect(frontNormals).toBeGreaterThan(0);
  });

  it('rejects collapsed armour', () => {
    expect(() => armourShell(RECTANGLE, 2, { front: 0 })).toThrow(/positive shell/);
    expect(() => armourShell(RECTANGLE.slice(0, 2), 2, {})).toThrow(/three profile points/);
  });
});
