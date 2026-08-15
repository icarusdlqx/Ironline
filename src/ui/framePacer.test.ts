import { beforeEach, describe, expect, it } from 'vitest';
import { FramePacer } from './framePacer';

let pacer: FramePacer;

beforeEach(() => {
  pacer = new FramePacer();
});

/** Feeds a steady frame time until the pacer speaks or the budget runs out. */
function drive(ms: number, speed: number, frames = 300): number | null {
  for (let frame = 0; frame < frames; frame += 1) {
    const verdict = pacer.record(ms, speed);
    if (verdict !== null) return verdict;
  }
  return null;
}

describe('the frame pacer', () => {
  it('says nothing while the display holds the rate', () => {
    expect(drive(16, 4)).toBeNull();
    expect(drive(30, 2)).toBeNull();
  });

  it('steps 4× down to 2× under sustained slow frames', () => {
    expect(drive(80, 4)).toBe(2);
  });

  it('steps 2× down to 1×, and never below', () => {
    expect(drive(80, 2)).toBe(1);
    pacer.reset();
    // A machine that struggles at 1× is not a problem the pacer can solve.
    expect(drive(200, 1)).toBeNull();
  });

  it('needs the slowness to be sustained, not one bad frame', () => {
    for (let frame = 0; frame < 60; frame += 1) expect(pacer.record(16, 4)).toBeNull();
    expect(pacer.record(400, 4)).toBeNull();
    for (let frame = 0; frame < 10; frame += 1) expect(pacer.record(16, 4)).toBeNull();
  });

  it('treats a huge gap as a tab switch, not as load', () => {
    for (let frame = 0; frame < 60; frame += 1) pacer.record(16, 4);
    expect(pacer.record(5_000, 4)).toBeNull();
    // And the read starts fresh: good frames after the gap keep it quiet.
    expect(drive(16, 4, 100)).toBeNull();
  });

  it('holds its tongue through the warm-up after a reset', () => {
    pacer.reset();
    for (let frame = 0; frame < 29; frame += 1) {
      expect(pacer.record(500, 4)).toBeNull();
    }
  });

  it('steps down one notch at a time', () => {
    expect(drive(80, 4)).toBe(2);
    // After the step the warm-up guards the next verdict; sustained slowness
    // then takes the second notch rather than both falling at once.
    expect(drive(80, 2)).toBe(1);
  });
});
