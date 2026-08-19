import { describe, expect, it } from 'vitest';
import { TouchGesture } from './touchGesture';

describe('touch gesture state', () => {
  it('commits an unconsumed single-finger tap at its last point', () => {
    const gesture = new TouchGesture();
    gesture.start(1, { x: 10, y: 20 });
    gesture.move(1, { x: 12, y: 24 });

    expect(gesture.finish(1, { x: 0, y: 0 })).toEqual({
      point: { x: 12, y: 24 },
      commitTap: true,
    });
  });

  it('suppresses both releases after a pinch and resets for the next gesture', () => {
    const gesture = new TouchGesture();
    gesture.start(1, { x: 0, y: 0 });
    gesture.start(2, { x: 30, y: 40 });

    expect(gesture.span()).toBe(50);
    expect(gesture.finish(1, { x: 0, y: 0 }).commitTap).toBe(false);
    expect(gesture.finish(2, { x: 0, y: 0 }).commitTap).toBe(false);

    gesture.start(3, { x: 5, y: 6 });
    expect(gesture.finish(3, { x: 0, y: 0 }).commitTap).toBe(true);
  });

  it('tracks the live centre of the fingers', () => {
    const gesture = new TouchGesture();
    expect(gesture.centroid()).toBeNull();
    gesture.start(1, { x: 10, y: 20 });
    gesture.start(2, { x: 50, y: 60 });
    expect(gesture.centroid()).toEqual({ x: 30, y: 40 });

    const moved = gesture.move(2, { x: 70, y: 40 });
    expect(moved.previousCentroid).toEqual({ x: 30, y: 40 });
    expect(moved.centroid).toEqual({ x: 40, y: 30 });
    expect(gesture.centroid()).toEqual({ x: 40, y: 30 });
  });

  it('suppresses a pan and every remaining pointer after cancellation', () => {
    const gesture = new TouchGesture();
    gesture.start(1, { x: 0, y: 0 });
    gesture.consume();
    expect(gesture.finish(1, { x: 0, y: 0 }).commitTap).toBe(false);

    gesture.start(2, { x: 0, y: 0 });
    gesture.start(3, { x: 20, y: 0 });
    gesture.cancel(2);
    expect(gesture.finish(3, { x: 0, y: 0 }).commitTap).toBe(false);

    gesture.start(4, { x: 1, y: 2 });
    gesture.cancel(4);
    expect(gesture.finish(4, { x: 1, y: 2 }).commitTap).toBe(false);
  });
});
