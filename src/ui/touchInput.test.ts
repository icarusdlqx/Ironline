import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MechEntity } from '../sim/types';
import type { Engine } from './engine';
import { useGame } from './store';
import { TouchInput } from './touchInput';

function hostile(id = 9): MechEntity {
  return {
    id,
    team: 1,
    destroyed: false,
    withdrawn: false,
    pilot: { dead: false, ejected: false },
  } as MechEntity;
}

function harness() {
  let picked: MechEntity | null = null;
  const zoomBetween = vi.fn();
  const engine = {
    cursorWorld: null,
    supportAim: null,
    renderer: {
      camera: { distance: 470, panBy: vi.fn() },
    },
    supportNeedsHeading: vi.fn(() => false),
    callSupport: vi.fn(() => ({ ok: true, reason: null })),
    selectedEntities: vi.fn(() => [1]),
    orderMove: vi.fn(),
    orderJump: vi.fn(),
    orderAttack: vi.fn(),
    audio: { select: vi.fn() },
  } as unknown as Engine;
  const input = new TouchInput({
    engine,
    pickAt: () => picked,
    screenWorld: (point) => point,
    zoomBetween,
    onPinchStart: vi.fn(),
  });
  return { engine, input, zoomBetween, pick: (entity: MechEntity | null) => (picked = entity) };
}

beforeEach(() => {
  useGame.setState({
    playerTeam: 0,
    selection: [1],
    supportMode: null,
    orderMode: null,
    calledShotLocation: null,
  });
});

describe('touch input', () => {
  it('zooms a pinch without committing its final release', () => {
    const { engine, input, zoomBetween } = harness();
    input.start(1, { x: 10, y: 10 }, { x: 10, y: 10 });
    input.start(2, { x: 30, y: 10 }, { x: 30, y: 10 });
    input.move(2, { x: 50, y: 10 });
    input.finish(1, { x: 10, y: 10 });
    input.finish(2, { x: 50, y: 10 });

    expect(zoomBetween).toHaveBeenCalledWith(2, { x: 20, y: 10 }, { x: 30, y: 10 });
    expect(engine.orderMove).not.toHaveBeenCalled();
    expect(engine.callSupport).not.toHaveBeenCalled();
  });

  it('moves the pinch anchor through both halves of a symmetric gesture', () => {
    const { input, zoomBetween } = harness();
    input.start(1, { x: 420, y: 360 }, { x: 420, y: 360 });
    input.start(2, { x: 620, y: 360 }, { x: 620, y: 360 });

    input.move(1, { x: 340, y: 360 });
    input.move(2, { x: 700, y: 360 });

    expect(zoomBetween).toHaveBeenNthCalledWith(
      1,
      280 / 200,
      { x: 520, y: 360 },
      { x: 480, y: 360 },
    );
    expect(zoomBetween).toHaveBeenNthCalledWith(
      2,
      360 / 280,
      { x: 480, y: 360 },
      { x: 520, y: 360 },
    );
  });

  it('previews and commits a directional support drag once', () => {
    const { engine, input } = harness();
    useGame.setState({ supportMode: 'air_strike' });
    vi.mocked(engine.supportNeedsHeading).mockReturnValue(true);

    input.start(1, { x: 10, y: 20 }, { x: 10, y: 20 });
    expect(engine.supportAim).toEqual({
      call: 'air_strike',
      at: { x: 10, y: 20 },
      to: { x: 10, y: 20 },
    });
    input.move(1, { x: 50, y: 70 });
    expect(engine.supportAim?.to).toEqual({ x: 50, y: 70 });
    input.finish(1, { x: 50, y: 70 });

    expect(engine.callSupport).toHaveBeenCalledOnce();
    expect(engine.callSupport).toHaveBeenCalledWith(
      'air_strike',
      { x: 10, y: 20 },
      { x: 50, y: 70 },
    );
    expect(useGame.getState().supportMode).toBeNull();
  });

  it('cancels a directional support gesture without spending it', () => {
    const { engine, input } = harness();
    useGame.setState({ supportMode: 'air_strike' });
    vi.mocked(engine.supportNeedsHeading).mockReturnValue(true);

    input.start(1, { x: 10, y: 20 }, { x: 10, y: 20 });
    input.cancel(1);

    expect(engine.callSupport).not.toHaveBeenCalled();
    expect(engine.supportAim).toBeNull();
    expect(useGame.getState().supportMode).toBe('air_strike');
  });

  it.each(['attack', 'called_shot'] as const)(
    'keeps %s armed after an invalid target and clears it after a hostile',
    (mode) => {
      const { engine, input, pick } = harness();
      useGame.setState({ orderMode: mode, calledShotLocation: 'left_leg' });

      input.start(1, { x: 20, y: 30 }, { x: 20, y: 30 });
      input.finish(1, { x: 20, y: 30 });
      expect(useGame.getState().orderMode).toBe(mode);
      expect(engine.orderAttack).not.toHaveBeenCalled();

      pick(hostile());
      input.start(2, { x: 40, y: 50 }, { x: 40, y: 50 });
      input.finish(2, { x: 40, y: 50 });
      expect(engine.orderAttack).toHaveBeenCalledWith(
        9,
        mode === 'called_shot' ? 'left_leg' : null,
      );
      expect(useGame.getState().orderMode).toBeNull();
    },
  );
});
