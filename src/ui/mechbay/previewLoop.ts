export interface PreviewFrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

export interface PreviewLoopOptions {
  reducedMotion: boolean;
  draw: (deltaSeconds: number) => void;
  scheduler?: PreviewFrameScheduler;
  maximumFps?: number;
}

const browserScheduler: PreviewFrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** Keeps one bounded render request alive only while the preview can be seen. */
export class PreviewLoop {
  private readonly scheduler: PreviewFrameScheduler;
  private readonly minimumFrameMs: number;
  private frame: number | null = null;
  private lastDrawAt: number | null = null;
  private started = false;
  private disposed = false;
  private documentVisible = true;
  private intersecting = true;
  private interactionPaused = false;

  constructor(private readonly options: PreviewLoopOptions) {
    this.scheduler = options.scheduler ?? browserScheduler;
    this.minimumFrameMs = 1_000 / Math.max(1, options.maximumFps ?? 30);
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    if (this.options.reducedMotion) this.drawStill();
    else this.schedule();
  }

  invalidate(): void {
    if (this.disposed || !this.canPresent()) return;
    if (this.options.reducedMotion || this.interactionPaused) this.options.draw(0);
    else this.schedule();
  }

  setDocumentVisible(visible: boolean): void {
    if (this.documentVisible === visible) return;
    this.documentVisible = visible;
    this.refresh();
  }

  setIntersecting(intersecting: boolean): void {
    if (this.intersecting === intersecting) return;
    this.intersecting = intersecting;
    this.refresh();
  }

  setInteractionPaused(paused: boolean): void {
    if (this.interactionPaused === paused) return;
    this.interactionPaused = paused;
    this.refresh();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }

  private readonly advance = (timestamp: number): void => {
    this.frame = null;
    if (!this.shouldAnimate()) return;

    const last = this.lastDrawAt;
    if (last === null || timestamp - last >= this.minimumFrameMs) {
      const deltaSeconds = last === null ? 0 : Math.min(0.1, (timestamp - last) / 1_000);
      this.lastDrawAt = timestamp;
      this.options.draw(deltaSeconds);
    }
    this.schedule();
  };

  private refresh(): void {
    this.lastDrawAt = null;
    if (!this.canPresent()) {
      this.cancel();
      return;
    }
    if (this.options.reducedMotion || this.interactionPaused) {
      this.cancel();
      this.drawStill();
      return;
    }
    this.schedule();
  }

  private drawStill(): void {
    if (this.started && this.canPresent()) this.options.draw(0);
  }

  private canPresent(): boolean {
    return !this.disposed && this.started && this.documentVisible && this.intersecting;
  }

  private shouldAnimate(): boolean {
    return this.canPresent() && !this.options.reducedMotion && !this.interactionPaused;
  }

  private schedule(): void {
    if (this.frame !== null || !this.shouldAnimate()) return;
    this.frame = this.scheduler.request(this.advance);
  }

  private cancel(): void {
    if (this.frame === null) return;
    this.scheduler.cancel(this.frame);
    this.frame = null;
  }
}
