/**
 * The frame-time overlay: a sparkline and the numbers behind it, drawn on its
 * own canvas outside React so that measuring the game never becomes part of
 * the cost being measured. Toggled with P; exists so that "the game got laggy"
 * can become "draw is eating 30ms at 4×" without anyone attaching a profiler.
 */

const WIDTH = 232;
const HEIGHT = 76;
const HISTORY = 116;
/** The sparkline's ceiling. Frames past this are clipped, not rescaled. */
const CLIP_MS = 100;
/** One frame at 60Hz and the 30Hz line, for reading the graph at a glance. */
const GUIDES_MS = [16.7, 33.3];

export interface PerfSample {
  frameMs: number;
  simMs: number;
  drawMs: number;
  steps: number;
  speed: number;
  drawCalls: number;
}

export class PerfOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly history: number[] = [];
  private visible = false;
  private textTimer = 0;
  private caption = '';

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.canvas.className = 'perf-overlay';
    this.canvas.style.display = 'none';
    host.appendChild(this.canvas);
    this.context = this.canvas.getContext('2d');
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
    return this.visible;
  }

  destroy(): void {
    this.canvas.remove();
  }

  record(sample: PerfSample): void {
    if (!this.visible || this.context === null) return;

    this.history.push(sample.frameMs);
    if (this.history.length > HISTORY) this.history.shift();

    // The caption changes four times a second; numbers flickering at frame
    // rate cannot be read, which would defeat the point of showing them.
    this.textTimer -= sample.frameMs;
    if (this.textTimer <= 0) {
      this.textTimer = 250;
      const worst = Math.max(...this.history, 1);
      const mean = this.history.reduce((total, ms) => total + ms, 0) / this.history.length;
      const fps = mean > 0 ? Math.round(1000 / mean) : 0;
      const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory;
      this.caption =
        `${fps}fps  worst ${Math.round(worst)}ms  ×${sample.speed}\n` +
        `sim ${sample.simMs.toFixed(1)}ms/${sample.steps}st  draw ${sample.drawMs.toFixed(1)}ms  ` +
        `${sample.drawCalls}dc${heap === undefined ? '' : `  ${Math.round(heap.usedJSHeapSize / 1e6)}MB`}`;
    }

    const ctx = this.context;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(10, 14, 16, 0.82)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const graphTop = 30;
    const graphHeight = HEIGHT - graphTop - 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    for (const guide of GUIDES_MS) {
      const y = graphTop + graphHeight * (1 - Math.min(1, guide / CLIP_MS));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WIDTH, y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#7fd0e8';
    ctx.beginPath();
    this.history.forEach((ms, index) => {
      const x = (index / (HISTORY - 1)) * WIDTH;
      const y = graphTop + graphHeight * (1 - Math.min(1, ms / CLIP_MS));
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = '#cfe3ea';
    ctx.font = '10px ui-monospace, monospace';
    this.caption.split('\n').forEach((line, index) => {
      ctx.fillText(line, 6, 12 + index * 12);
    });
  }
}
