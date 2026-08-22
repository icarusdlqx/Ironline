import { describe, expect, it, vi } from 'vitest';
import { playerWorld } from '../../tests/support';
import {
  arrowPanDelta,
  centreOnSelection,
  selectedCentre,
  type CameraNavigationEngine,
} from './cameraNavigation';

function harness(ids: number[]): {
  engine: CameraNavigationEngine;
  centreOn: ReturnType<typeof vi.fn>;
} {
  const world = playerWorld('camera-selection');
  const centreOn = vi.fn();
  return {
    engine: {
      world,
      renderer: { camera: { centreOn } },
      selectedEntities: () => ids,
    },
    centreOn,
  };
}

describe('camera selection navigation', () => {
  it.each([
    ['ArrowLeft', { x: 12, y: 0 }],
    ['ArrowRight', { x: -12, y: 0 }],
    ['ArrowUp', { x: 0, y: -12 }],
    ['ArrowDown', { x: 0, y: 12 }],
  ] as const)('maps %s to the drag-space pan that moves the view the same way', (key, expected) => {
    expect(arrowPanDelta(new Set([key]), 12)).toEqual(expected);
  });

  it('cancels opposing arrow keys without adding camera drift', () => {
    expect(
      arrowPanDelta(
        new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']),
        12,
      ),
    ).toEqual({ x: 0, y: 0 });
  });

  it('centres on the operational selection rather than the whole lance', () => {
    const { engine, centreOn } = harness([1, 2]);
    const [first, second] = engine.world.entities;
    if (first === undefined || second === undefined) throw new Error('missing selection');
    first.pos = { x: 120, y: 240 };
    second.pos = { x: 360, y: 480 };

    expect(selectedCentre(engine)).toEqual({ x: 240, y: 360 });
    expect(centreOnSelection(engine)).toBe(true);
    expect(centreOn).toHaveBeenCalledWith({ x: 240, y: 360 });
  });

  it('does nothing when no operational selection remains', () => {
    const { engine, centreOn } = harness([]);
    expect(centreOnSelection(engine)).toBe(false);
    expect(centreOn).not.toHaveBeenCalled();
  });
});
