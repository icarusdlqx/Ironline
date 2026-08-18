import { BufferAttribute, Line, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import type { World } from '../sim/types';
import { MarkerLayer, type MarkerViewState } from './markerLayer';

const emptyWorld = {
  zones: [],
  reveals: [],
  support: { pending: [] },
  entities: [],
  playerTeam: 0,
} as unknown as World;

const baseView: MarkerViewState = {
  selection: new Set(),
  orderMode: null,
  supportRadius: null,
  supportRun: null,
};

describe('support placement markers', () => {
  it('draws an authored radius without creating a new marker kind', () => {
    const layer = new MarkerLayer(() => 0, () => null);
    layer.draw(emptyWorld, {
      ...baseView,
      supportRadius: { at: { x: 300, y: 420 }, radius: 45 },
    });

    const ring = layer.group.children.find((child) => child instanceof Mesh && child.visible);
    expect(ring).toBeDefined();
    expect(ring?.position.x).toBe(300);
    expect(ring?.position.z).toBe(420);
    layer.dispose();
  });

  it('lays the air-strike outline along the supplied heading', () => {
    const layer = new MarkerLayer(() => 0, () => null);
    layer.draw(emptyWorld, {
      ...baseView,
      supportRun: {
        at: { x: 500, y: 400 },
        heading: 0,
        length: 280,
        width: 46,
      },
    });

    const lane = layer.group.children.find(
      (child) => child instanceof Line && child.visible,
    ) as Line | undefined;
    expect(lane).toBeDefined();
    const points = lane?.geometry.getAttribute('position') as BufferAttribute;
    expect(points.getX(0)).toBe(360);
    expect(points.getX(1)).toBe(640);
    expect(points.getZ(0)).toBe(377);
    expect(points.getZ(2)).toBe(423);
    expect(points.getX(4)).toBe(points.getX(0));
    expect(points.getZ(4)).toBe(points.getZ(0));
    layer.dispose();
  });
});
