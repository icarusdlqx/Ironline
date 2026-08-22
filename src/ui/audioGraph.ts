export interface VoicePlacement {
  /** The gain before the shared compressor. */
  level: number;
  /** Null keeps a console sound out of the battlefield's air filter. */
  distance: number | null;
}

export interface VoiceFrame {
  context: AudioContext;
  noise: AudioBuffer;
  now: number;
  out: GainNode;
  random(): number;
}

export interface VoiceBus {
  begin(placement: VoicePlacement): VoiceFrame | null;
}

export interface AmbientBus {
  readonly context: AudioContext;
  readonly master: GainNode;
  readonly noise: AudioBuffer;
  random(): number;
}

const MASTER_LEVEL = 0.5;
export const FIELD_VOICE_LIMIT = 8;
export const FIELD_VOICE_WINDOW_MS = 100;

/** The shared graph and the admission control in front of every one-shot. */
export class AudioGraph implements VoiceBus, AmbientBus {
  private readonly window = { at: 0, count: 0 };
  private seed = 0x9e3779b9;
  private closed = false;

  constructor(
    readonly context: AudioContext,
    readonly master: GainNode,
    readonly noise: AudioBuffer,
  ) {}

  static create(muted: boolean): AudioGraph | null {
    const Ctor =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return null;

    const context = new Ctor();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 8;
    compressor.connect(context.destination);

    const master = context.createGain();
    master.gain.value = muted ? 0 : MASTER_LEVEL;
    master.connect(compressor);

    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const graph = new AudioGraph(context, master, noise);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = graph.random() * 2 - 1;
    return graph;
  }

  setMuted(muted: boolean): void {
    this.master.gain.value = muted ? 0 : MASTER_LEVEL;
  }

  resume(): void {
    if (!this.closed && this.context.state === 'suspended') void this.context.resume();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.context.close().catch(() => undefined);
  }

  /** Refuses excess field voices before they can allocate a source node. */
  begin(placement: VoicePlacement): VoiceFrame | null {
    if (this.closed || placement.level <= 0.01) return null;

    if (placement.distance !== null) {
      const now = performance.now();
      if (now - this.window.at > FIELD_VOICE_WINDOW_MS) {
        this.window.at = now;
        this.window.count = 0;
      }
      if (this.window.count >= FIELD_VOICE_LIMIT) return null;
      this.window.count += 1;
    }

    const out = this.context.createGain();
    out.gain.value = Math.min(1, placement.level);
    if (placement.distance === null) {
      out.connect(this.master);
    } else {
      const air = this.context.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = Math.max(600, 18_000 - placement.distance * 22);
      out.connect(air).connect(this.master);
    }

    return {
      context: this.context,
      noise: this.noise,
      now: this.context.currentTime,
      out,
      random: () => this.random(),
    };
  }

  /** Local xorshift, so detune never leans on the battle's seeded stream. */
  random(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return ((this.seed >>> 0) % 10_000) / 10_000;
  }
}

/** Broadband attack. Without it a gunshot is only a note with better manners. */
export function crack(frame: VoiceFrame, at: number, gain: number, colour: number): void {
  const src = frame.context.createBufferSource();
  src.buffer = frame.noise;

  const shelf = frame.context.createBiquadFilter();
  shelf.type = 'highpass';
  shelf.frequency.value = colour;

  const level = frame.context.createGain();
  level.gain.setValueAtTime(gain, at);
  level.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
  src.connect(shelf).connect(level).connect(frame.out);
  src.start(at, frame.random() * 0.5);
  src.stop(at + 0.03);
}

/** Noise through a closing resonance: machinery has a body, not a clean pitch. */
export function body(
  frame: VoiceFrame,
  at: number,
  seconds: number,
  from: number,
  to: number,
  gain: number,
  resonance: number,
): void {
  const src = frame.context.createBufferSource();
  src.buffer = frame.noise;

  const filter = frame.context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + seconds);
  filter.Q.value = resonance;

  const level = frame.context.createGain();
  level.gain.setValueAtTime(0.0001, at);
  level.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  src.connect(filter).connect(level).connect(frame.out);
  src.start(at, frame.random() * 0.5);
  src.stop(at + seconds + 0.02);
}

/** Weight belongs below the noise, where it is felt before it is named. */
export function thump(
  frame: VoiceFrame,
  at: number,
  seconds: number,
  from: number,
  to: number,
  gain: number,
): void {
  oscillator(frame, at, seconds, from, to, gain, 'sine');
}

export function oscillator(
  frame: VoiceFrame,
  at: number,
  seconds: number,
  from: number,
  to: number,
  gain: number,
  type: OscillatorType,
): void {
  const osc = frame.context.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, from), at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + seconds);
  const level = frame.context.createGain();
  level.gain.setValueAtTime(Math.max(0.0001, gain), at);
  level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(level).connect(frame.out);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

export function noiseSweep(
  frame: VoiceFrame,
  at: number,
  seconds: number,
  from: number,
  to: number,
  gain: number,
  type: BiquadFilterType = 'lowpass',
  resonance = 0.8,
): void {
  const src = frame.context.createBufferSource();
  src.buffer = frame.noise;
  src.loop = true;
  const filter = frame.context.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(Math.max(40, from), at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + seconds);
  filter.Q.value = resonance;
  const level = frame.context.createGain();
  level.gain.setValueAtTime(0.0001, at);
  level.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.04, seconds * 0.2));
  level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  src.connect(filter).connect(level).connect(frame.out);
  src.start(at, frame.random() * 0.5);
  src.stop(at + seconds + 0.02);
}

/** A filtered console tone; bare waveforms make every control sound like a toy. */
export function blip(
  frame: VoiceFrame,
  at: number,
  frequency: number,
  seconds: number,
  gain: number,
): void {
  const osc = frame.context.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, at);
  osc.frequency.exponentialRampToValueAtTime(frequency * 0.82, at + seconds);
  const soften = frame.context.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = frequency * 2.2;
  const level = frame.context.createGain();
  level.gain.setValueAtTime(0.0001, at);
  level.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(soften).connect(level).connect(frame.out);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}
