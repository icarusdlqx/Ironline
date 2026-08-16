/**
 * The frame-time overlay: a sparkline and the numbers behind it, drawn on its
 * own canvas outside React so that measuring the game never becomes part of
 * the cost being measured. Toggled with P; exists so that "the game got laggy"
 * can become "draw is eating 30ms at 4×" without anyone attaching a profiler.
 *
 * Stutter is sporadic by nature and a screenshot always comes after the fact,
 * so the overlay keeps a ledger of spikes rather than only the moment: every
 * frame is recorded even while the overlay is hidden, and the worst recent
 * frame is held on screen with where its time went. A spike whose cost is not
 * in sim or draw happened outside the engine's loop — garbage collection, the
 * compositor, the rest of the machine — and saying so is the diagnosis.
 */

const WIDTH = 344;
const HEIGHT = 88;
const HISTORY = 116;
/** The sparkline's ceiling. Frames past this are clipped, not rescaled. */
const CLIP_MS = 100;
/** One frame at 60Hz and the 30Hz line, for reading the graph at a glance. */
const GUIDES_MS = [16.7, 33.3];
/** A frame this late is a hitch the player felt, and goes in the ledger. */
const SPIKE_MS = 50;
/** Two missed vsyncs at 60Hz: micro-stutter worth counting, not holding. */
const LATE_MS = 34;
/** A gap this long is a tab switch, not a stutter anyone was watching. */
const IGNORE_MS = 1_000;
/** The held spike fades from the ledger once it is this stale. */
const SPIKE_MEMORY_MS = 60_000;

export interface PerfSample {
  frameMs: number;
  simMs: number;
  drawMs: number;
  steps: number;
  speed: number;
  drawCalls: number;
}

interface Spike {
  frameMs: number;
  simMs: number;
  drawMs: number;
  drawCalls: number;
  /** Overlay clock when it landed, so its age can be shown. */
  at: number;
}

export class PerfOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly history: number[] = [];
  private visible = false;
  private textTimer = 0;
  private caption = '';
  /** Real time accumulated across every recorded frame, visible or not. */
  private clock = 0;
  /** The worst recent hitch, held so it survives until someone looks. */
  private spike: Spike | null = null;
  private spikeCount = 0;
  /** Frames that missed two vsyncs — the texture of micro-stutter. */
  private lateCount = 0;

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
    // Spikes are tracked whether or not anyone is watching: the player opens
    // the overlay after feeling the hitch, and it has to still be there.
    this.clock += sample.frameMs;
    if (sample.frameMs >= LATE_MS && sample.frameMs < IGNORE_MS) this.lateCount += 1;
    if (sample.frameMs >= SPIKE_MS && sample.frameMs < IGNORE_MS) {
      this.spikeCount += 1;
      const standing = this.spike;
      // A worse spike takes the slot; a stale one gives it up to anything new.
      if (
        standing === null ||
        sample.frameMs >= standing.frameMs ||
        this.clock - standing.at > SPIKE_MEMORY_MS
      ) {
        this.spike = {
          frameMs: sample.frameMs,
          simMs: sample.simMs,
          drawMs: sample.drawMs,
          drawCalls: sample.drawCalls,
          at: this.clock,
        };
      }
    }

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
        `${sample.drawCalls}dc${heap === undefined ? '' : `  ${Math.round(heap.usedJSHeapSize / 1e6)}MB`}\n` +
        this.spikeCaption();
    }

    const ctx = this.context;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(10, 14, 16, 0.82)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const graphTop = 42;
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

  /**
   * The held spike, with its time split three ways: sim, draw, and everything
   * else. "Else" is the tell — a hitch the engine did not spend is garbage
   * collection or the machine, not the battle.
   */
  private spikeCaption(): string {
    const spike = this.spike;
    if (spike === null) {
      return `no ${SPIKE_MS}ms spikes · ${LATE_MS}ms+ ×${this.lateCount}`;
    }
    const other = Math.max(0, spike.frameMs - spike.simMs - spike.drawMs);
    const age = Math.round((this.clock - spike.at) / 1000);
    return (
      `spike ${Math.round(spike.frameMs)}ms ` +
      `(sim ${Math.round(spike.simMs)} draw ${Math.round(spike.drawMs)} ` +
      `other ${Math.round(other)} ${spike.drawCalls}dc) ` +
      `${age}s ×${this.spikeCount} · ${LATE_MS}+ ×${this.lateCount}`
    );
  }
}
