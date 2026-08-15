/**
 * Watches the display's frame rate and recommends stepping fast-forward down
 * when the machine cannot hold it.
 *
 * At 2× and 4× the game must run twice or four times the simulation per real
 * second on top of a full render. A machine that cannot keep up does not fail
 * loudly — it just delivers every frame late, which the player reads as "the
 * game got very laggy" rather than as "I asked for more than this machine has".
 * Below ~22fps, orders and selection feel broken; better to hold a lower rate
 * and stay playable, and say so, than to grind.
 *
 * Only ever steps down, and never below 1×: the player chose the speed, so
 * recovering it is their call, and a machine that struggles at 1× is not a
 * problem this can solve.
 */

/** Frame budget above which fast-forward is judged unsustainable, in ms. */
const SLOW_FRAME_MS = 45;
/** How much history one verdict rests on. Roughly a second of smooth play. */
const EMA_ALPHA = 1 / 40;
/** Frames ignored after a speed change, so the verdict never reads stale data. */
const WARMUP_FRAMES = 30;
/** A gap this long is a tab switch or a stall, not load. It resets the read. */
const DISCONTINUITY_MS = 1_000;

export class FramePacer {
  private average = 16;
  private warmup = WARMUP_FRAMES;

  /** Starts the warm-up over — call on any speed change, pause, or resume. */
  reset(): void {
    this.average = 16;
    this.warmup = WARMUP_FRAMES;
  }

  /**
   * Feeds one real frame interval and returns the speed the battle should run
   * at, or null to leave it alone. `speed` is what the player has asked for.
   */
  record(frameMs: number, speed: number): number | null {
    if (frameMs >= DISCONTINUITY_MS) {
      this.reset();
      return null;
    }

    this.average += (frameMs - this.average) * EMA_ALPHA;

    if (this.warmup > 0) {
      this.warmup -= 1;
      return null;
    }
    if (speed <= 1 || this.average <= SLOW_FRAME_MS) return null;

    this.reset();
    return speed > 2 ? 2 : 1;
  }
}
