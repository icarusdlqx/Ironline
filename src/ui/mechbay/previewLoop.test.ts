import { describe, expect, it, vi } from 'vitest';
import { PreviewLoop, type PreviewFrameScheduler } from './previewLoop';

class TestScheduler implements PreviewFrameScheduler {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, FrameRequestCallback>();
  readonly cancelled: number[] = [];

  request(callback: FrameRequestCallback): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  }

  flush(timestamp: number): void {
    const pending = [...this.callbacks.entries()][0];
    if (pending === undefined) throw new Error('no preview frame is pending');
    this.callbacks.delete(pending[0]);
    pending[1](timestamp);
  }

  get pending(): number {
    return this.callbacks.size;
  }
}

describe('preview render loop', () => {
  it('keeps one request alive and caps animated drawing at thirty frames per second', () => {
    const scheduler = new TestScheduler();
    const draw = vi.fn();
    const loop = new PreviewLoop({ reducedMotion: false, scheduler, draw, maximumFps: 30 });

    loop.start();
    loop.start();
    expect(scheduler.pending).toBe(1);
    scheduler.flush(0);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(1);
    scheduler.flush(10);
    expect(draw).toHaveBeenCalledTimes(1);
    scheduler.flush(34);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw).toHaveBeenLastCalledWith(0.034);
    expect(scheduler.pending).toBe(1);
  });

  it('cancels while hidden or outside the viewport and resumes with one request', () => {
    const scheduler = new TestScheduler();
    const loop = new PreviewLoop({ reducedMotion: false, scheduler, draw: vi.fn() });

    loop.start();
    loop.setDocumentVisible(false);
    expect(scheduler.pending).toBe(0);
    expect(scheduler.cancelled).toHaveLength(1);
    loop.setDocumentVisible(true);
    expect(scheduler.pending).toBe(1);
    loop.setIntersecting(false);
    expect(scheduler.pending).toBe(0);
    loop.setIntersecting(true);
    loop.invalidate();
    expect(scheduler.pending).toBe(1);
  });

  it('draws still frames without scheduling for reduced motion or pointer inspection', () => {
    const reducedScheduler = new TestScheduler();
    const reducedDraw = vi.fn();
    const reduced = new PreviewLoop({
      reducedMotion: true,
      scheduler: reducedScheduler,
      draw: reducedDraw,
    });
    reduced.start();
    reduced.invalidate();
    expect(reducedDraw).toHaveBeenCalledTimes(2);
    expect(reducedScheduler.pending).toBe(0);

    const animatedScheduler = new TestScheduler();
    const animatedDraw = vi.fn();
    const animated = new PreviewLoop({
      reducedMotion: false,
      scheduler: animatedScheduler,
      draw: animatedDraw,
    });
    animated.start();
    animated.setInteractionPaused(true);
    expect(animatedDraw).toHaveBeenCalledOnce();
    expect(animatedScheduler.pending).toBe(0);
    animated.setInteractionPaused(false);
    expect(animatedScheduler.pending).toBe(1);
  });

  it('disposes idempotently and cannot be restarted', () => {
    const scheduler = new TestScheduler();
    const draw = vi.fn();
    const loop = new PreviewLoop({ reducedMotion: false, scheduler, draw });

    loop.start();
    loop.destroy();
    loop.destroy();
    loop.start();
    loop.invalidate();

    expect(scheduler.cancelled).toHaveLength(1);
    expect(scheduler.pending).toBe(0);
    expect(draw).not.toHaveBeenCalled();
  });

  it('does not schedule again when teardown happens during a draw', () => {
    const scheduler = new TestScheduler();
    const holder: { loop?: PreviewLoop } = {};
    const draw = vi.fn(() => holder.loop?.destroy());
    const loop = new PreviewLoop({ reducedMotion: false, scheduler, draw });
    holder.loop = loop;

    loop.start();
    scheduler.flush(0);

    expect(draw).toHaveBeenCalledOnce();
    expect(scheduler.pending).toBe(0);
  });
});
