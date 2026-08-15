import type { SimEvent } from '../sim/events';
import type { Vec2, World } from '../sim/types';

/**
 * Every sound in the game, synthesised.
 *
 * There are no audio files. Each effect is built from oscillators and shaped
 * noise at the moment it is needed, which keeps the single-file build genuinely
 * single-file and means a weapon's sound is derived from the same data as its
 * tracer: the visual style in the weapon JSON. A gauss slug thumps, a laser
 * tears, a missile rack ripples — because that is what the data says they are.
 *
 * Browsers refuse to start audio until the player has touched the page, so the
 * context is created muted and `unlock()` is called from the first pointer or
 * key event. Until then every play request is silently dropped, which for a
 * game is the correct behaviour: nobody wants the battle to buffer its sound
 * and deliver it all at once.
 */
export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Where the player is listening from, for distance attenuation. */
  listenAt: Vec2 = { x: 0, y: 0 };

  private mutedState: boolean;
  /** One-shots played in the current 100ms window, to cap volley spam. */
  private window = { at: 0, count: 0 };
  /** Last time each mech sounded its heat alarm, so it nags rather than screams. */
  private readonly warned = new Map<number, number>();
  private readonly heatWas = new Map<number, number>();
  /** Non-sim randomness for detuning. Never touches the battle's rng. */
  private seed = 0x9e3779b9;
  /** How far off the last sound was, so begin() can dull it for the distance. */
  private lastDistance = 0;
  /** The battlefield's standing sound, kept so it can be faded and stopped. */
  private ambientBed: { level: GainNode; sources: { stop(): void }[] } | null = null;
  /** Requested before the context existed; started the moment unlock() runs. */
  private pendingAmbient: string | null = null;

  constructor() {
    this.mutedState = readMuted();
  }

  get muted(): boolean {
    return this.mutedState;
  }

  toggleMuted(): boolean {
    this.mutedState = !this.mutedState;
    try {
      localStorage.setItem('ironline.muted', this.mutedState ? '1' : '0');
    } catch {
      // Private browsing; the preference just does not persist.
    }
    if (this.master !== null) {
      this.master.gain.value = this.mutedState ? 0 : MASTER_LEVEL;
    }
    return this.mutedState;
  }

  /**
   * Creates the audio context. Must be called from a user gesture — the first
   * pointerdown or keydown — or the browser leaves the context suspended.
   */
  unlock(): void {
    if (this.context !== null) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    const Ctor =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return;

    const context = new Ctor();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 8;
    compressor.connect(context.destination);

    const master = context.createGain();
    master.gain.value = this.mutedState ? 0 : MASTER_LEVEL;
    master.connect(compressor);

    // One second of white noise, reused by every effect that needs texture.
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = this.random() * 2 - 1;

    this.context = context;
    this.master = master;
    this.noise = noise;

    if (this.pendingAmbient !== null) this.startAmbient(this.pendingAmbient);
  }

  /**
   * The standing sound of the battlefield: wind over the ground, and on some
   * maps the things the ground is doing. Requested when the battle is built —
   * before the browser will allow any audio — so the id is held until the
   * first gesture unlocks the context.
   *
   * The bed exists because the AI learned to stand off: fights now hold long
   * silences between exchanges, and total silence reads as a broken game
   * rather than as tension.
   */
  setAmbient(atmosphereId: string): void {
    this.pendingAmbient = atmosphereId;
    if (this.context !== null) this.startAmbient(atmosphereId);
  }

  /**
   * Tears the whole audio graph down, context included. Each battle builds
   * its own director, and browsers cap how many live AudioContexts a page may
   * hold — a campaign's worth of battles must not accumulate them.
   */
  destroy(): void {
    this.stopAmbient();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.noise = null;
    if (context !== null) {
      void context.close().catch(() => undefined);
    }
  }

  /** Fades the bed out and forgets it; the battle screen is going away. */
  stopAmbient(): void {
    this.pendingAmbient = null;
    const bed = this.ambientBed;
    const context = this.context;
    this.ambientBed = null;
    if (bed === null || context === null) return;

    bed.level.gain.setTargetAtTime(0, context.currentTime, 0.15);
    const sources = bed.sources;
    setTimeout(() => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already stopped; nothing to wind down.
        }
      }
    }, 700);
  }

  private startAmbient(atmosphereId: string): void {
    this.stopAmbient();
    this.pendingAmbient = atmosphereId;
    const context = this.context;
    if (context === null || this.master === null || this.noise === null) return;

    // How each sky sounds. Wind is the constant; the filter decides whether it
    // is a warm afternoon or ice hissing across plate, and the drone is the
    // foundry district being a foundry district.
    const profile = AMBIENT_PROFILES[atmosphereId] ?? AMBIENT_PROFILES['overcast_day'];
    if (profile === undefined) return;

    const level = context.createGain();
    level.gain.value = 0;
    level.connect(this.master);
    level.gain.setTargetAtTime(AMBIENT_LEVEL * profile.level, context.currentTime, 2.0);

    const sources: { stop(): void }[] = [];

    // Wind: the shared noise buffer, looped, banded down to a distant rush.
    const wind = context.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const band = context.createBiquadFilter();
    band.type = 'lowpass';
    band.frequency.value = profile.windHz;
    band.Q.value = 0.4;

    // Gusts: a very slow oscillator swaying the wind's gain, so the bed
    // breathes instead of holding one note for seven minutes.
    const sway = context.createGain();
    sway.gain.value = 0.55;
    const gust = context.createOscillator();
    gust.type = 'sine';
    gust.frequency.value = profile.gustHz * (0.9 + this.random() * 0.2);
    const depth = context.createGain();
    depth.gain.value = 0.3;
    gust.connect(depth).connect(sway.gain);

    wind.connect(band).connect(sway).connect(level);
    wind.start();
    gust.start();
    sources.push(wind, gust);

    // The ground's own voice, where it has one: a just-audible machine drone.
    if (profile.droneHz !== null) {
      const drone = context.createOscillator();
      drone.type = 'triangle';
      drone.frequency.value = profile.droneHz;
      const droneLevel = context.createGain();
      droneLevel.gain.value = 0.16;
      drone.connect(droneLevel).connect(level);
      drone.start();
      sources.push(drone);
    }

    this.ambientBed = { level, sources };
  }

  /** The battle's events, straight from the simulation. */
  consume(world: World, events: readonly SimEvent[]): void {
    if (this.context === null || this.mutedState) return;

    for (const event of events) {
      switch (event.type) {
        case 'weapon_fired': {
          const weapon = world.catalog.weapons.get(event.weaponId);
          const at = positionOf(world, event.shooterId);
          if (weapon === undefined || at === null) break;
          this.weapon(weapon.visual.style, weapon.projectiles, this.gainAt(at));
          break;
        }
        case 'projectile_hit': {
          const at = positionOf(world, event.targetId);
          if (at !== null) this.impact(this.gainAt(at));
          break;
        }
        case 'critical_hit': {
          const at = positionOf(world, event.entityId);
          if (at !== null) this.crunch(this.gainAt(at));
          break;
        }
        case 'ammo_explosion': {
          const at = positionOf(world, event.entityId);
          if (at !== null) this.explosion(0.8, this.gainAt(at));
          break;
        }
        case 'mech_destroyed': {
          const at = positionOf(world, event.entityId);
          if (at !== null) this.explosion(1.0, this.gainAt(at));
          break;
        }
        case 'shutdown': {
          const at = positionOf(world, event.entityId);
          if (at !== null) this.powerSweep(360, 50, 0.9, this.gainAt(at));
          break;
        }
        case 'restart': {
          const at = positionOf(world, event.entityId);
          if (at !== null) this.powerSweep(70, 320, 0.6, this.gainAt(at) * 0.7);
          break;
        }
        case 'jump_started': {
          const at = positionOf(world, event.entityId);
          if (at !== null) this.jets(this.gainAt(at));
          break;
        }
        case 'jump_landed': {
          this.thud(this.gainAt({ x: event.x, y: event.y }), 1);
          break;
        }
        case 'zone_captured':
        case 'objective_settled':
          this.chime();
          break;
        default:
          break;
      }
    }

    this.heatAlarms(world);
  }

  /** A footfall, reported by the renderer as an animated leg plants. */
  footfall(at: Vec2, tonnage: number): void {
    // Quiet, and only nearby: a lance walking is texture, not percussion.
    const gain = this.gainAt(at) * 0.25 * (0.5 + tonnage / 160);
    if (gain > 0.02) this.thud(gain, tonnage / 100);
  }

  /** Feedback for the player's own orders. */
  order(): void {
    this.blip(880, 0.05, 0.1);
  }

  select(): void {
    this.blip(620, 0.04, 0.07);
  }

  // ------------------------------------------------------------------ voices

  private weapon(style: string, projectiles: number, gain: number): void {
    switch (style) {
      case 'beam':
        this.beam(gain);
        return;
      case 'pulse':
        this.pulses(3, gain);
        return;
      case 'bolt':
        this.bolt(gain);
        return;
      case 'slug':
        this.slug(gain);
        return;
      case 'missile':
        this.missiles(Math.min(6, projectiles), gain);
        return;
      case 'flame':
        this.hiss(0.45, 900, gain * 0.8);
        return;
      case 'burst':
      case 'tracer':
      default:
        this.cannon(Math.min(5, Math.max(1, Math.round(projectiles / 2))), gain);
        return;
    }
  }

  /** A laser is air tearing, not a note: hiss with a resonance that closes. */
  /** A pulse laser: the same tear as a beam, chopped into three. */
  private pulses(count: number, gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { now, out } = started;

    for (let i = 0; i < count; i += 1) {
      const t = now + i * 0.058;
      this.crack(t, 0.18, 3400, out);
      this.body(t, 0.075, 4600 - i * 500, 900, 0.3, 4, out);
    }
  }

  private beam(gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { out, now } = started;

    this.crack(now, 0.22, 3200, out);
    this.body(now, 0.3, 5200, 700, 0.34, 3.5, out);
    this.thump(now, 0.12, 120, 60, 0.12, out);
  }

  /** A particle bolt: a hard electrical snap over a discharge that falls away. */
  private bolt(gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { out, now } = started;

    this.crack(now, 0.5, 2600, out);
    this.body(now, 0.26, 7000, 400, 0.42, 5, out);
    this.thump(now, 0.2, 180, 48, 0.34, out);
  }

  /**
   * A gauss slug. Almost no muzzle blast — the mass driver is quiet at the
   * front end — so the weight is all in the sub, with a capacitor snap on top.
   */
  private slug(gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { out, now } = started;

    this.crack(now, 0.34, 1800, out);
    this.thump(now, 0.42, 88, 28, 0.95, out);
    this.body(now, 0.2, 900, 120, 0.3, 1.2, out);
  }

  /**
   * An autocannon. Each round is a crack, a short body and a thump — a
   * bandpassed noise burst on its own is a hi-hat, which is most of why the
   * ballistics used to sound like a toy drum kit.
   */
  private cannon(rounds: number, gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { now, out } = started;

    for (let i = 0; i < rounds; i += 1) {
      // Rounds are never machined to the same millisecond. The jitter is what
      // makes a burst read as a burst rather than as a metronome.
      const t = now + i * (0.062 + this.random() * 0.016);
      this.crack(t, 0.42, 2200, out);
      this.body(t, 0.11, 2600, 260, 0.46, 2.2, out);
      this.thump(t, 0.14, 130 + this.random() * 30, 45, 0.5, out);
    }
  }

  private missiles(count: number, gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { context, out, now } = started;
    for (let i = 0; i < count; i += 1) {
      const t = now + i * 0.06;
      const src = context.createBufferSource();
      src.buffer = this.noise;
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(500, t);
      band.frequency.exponentialRampToValueAtTime(2200, t + 0.28);
      band.Q.value = 1.2;
      const level = context.createGain();
      level.gain.setValueAtTime(0.001, t);
      level.gain.exponentialRampToValueAtTime(0.3, t + 0.06);
      level.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      src.connect(band).connect(level).connect(out);
      src.start(t, this.random() * 0.4);
      src.stop(t + 0.32);
    }
  }

  private hiss(seconds: number, cutoff: number, gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { context, out, now } = started;
    const src = context.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const low = context.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = cutoff;
    const level = context.createGain();
    level.gain.setValueAtTime(0.001, now);
    level.gain.exponentialRampToValueAtTime(0.35, now + 0.08);
    level.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    src.connect(low).connect(level).connect(out);
    src.start(now, this.random() * 0.5);
    src.stop(now + seconds + 0.05);
  }

  /** Something heavy striking plate: a sharp clang over the ring of the hull. */
  private impact(gain: number): void {
    const started = this.begin(gain * 0.7);
    if (started === null) return;
    const { now, out } = started;
    this.crack(now, 0.3, 1600, out);
    this.body(now, 0.14, 1800, 180, 0.42, 2.6, out);
    this.thump(now, 0.16, 150, 60, 0.35, out);
  }

  /** Structure failing: the tear first, then the weight of it coming apart. */
  private crunch(gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { now, out } = started;
    this.crack(now, 0.45, 1200, out);
    this.body(now, 0.3, 3000, 200, 0.55, 1.6, out);
    this.thump(now + 0.04, 0.34, 110, 34, 0.6, out);
  }

  private explosion(size: number, gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { context, out, now } = started;

    const src = context.createBufferSource();
    src.buffer = this.noise;
    const low = context.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(1400, now);
    low.frequency.exponentialRampToValueAtTime(60, now + 1.1 * size);
    const level = context.createGain();
    level.gain.setValueAtTime(0.9, now);
    level.gain.exponentialRampToValueAtTime(0.001, now + 1.2 * size);
    src.connect(low).connect(level).connect(out);
    src.start(now, this.random() * 0.3);
    src.stop(now + 1.25 * size);

    const sub = context.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(60, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + 0.9 * size);
    const subLevel = context.createGain();
    subLevel.gain.setValueAtTime(0.8, now);
    subLevel.gain.exponentialRampToValueAtTime(0.001, now + size);
    sub.connect(subLevel).connect(out);
    sub.start(now);
    sub.stop(now + size + 0.05);
  }

  private powerSweep(from: number, to: number, seconds: number, gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { context, out, now } = started;
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + seconds);
    const level = context.createGain();
    level.gain.setValueAtTime(0.25, now);
    level.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    osc.connect(level).connect(out);
    osc.start(now);
    osc.stop(now + seconds + 0.05);
  }

  private jets(gain: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { context, out, now } = started;
    const src = context.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(300, now);
    band.frequency.exponentialRampToValueAtTime(900, now + 0.5);
    band.Q.value = 0.8;
    const level = context.createGain();
    level.gain.setValueAtTime(0.001, now);
    level.gain.exponentialRampToValueAtTime(0.5, now + 0.12);
    level.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    src.connect(band).connect(level).connect(out);
    src.start(now, this.random() * 0.4);
    src.stop(now + 0.95);
  }

  private thud(gain: number, weight: number): void {
    const started = this.begin(gain);
    if (started === null) return;
    const { context, out, now } = started;
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70 + 40 * (1 - weight), now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.16);
    const level = context.createGain();
    level.gain.setValueAtTime(0.7, now);
    level.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(level).connect(out);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  private chime(): void {
    this.blip(660, 0.12, 0.12);
    this.blipAtAbsolute(0.13, 990, 0.16, 0.12);
  }

  /** Two-tone reactor alarm, played toward the player, not into the field. */
  private klaxon(): void {
    for (let i = 0; i < 2; i += 1) {
      this.blipAtAbsolute(i * 0.24, 680, 0.16, 0.14);
      this.blipAtAbsolute(i * 0.24 + 0.11, 510, 0.12, 0.12);
    }
  }

  private blip(frequency: number, seconds: number, gain: number): void {
    this.blipAtAbsolute(0, frequency, seconds, gain);
  }

  /**
   * A console acknowledging a keypress. A triangle behind a low-pass, not a
   * square wave: a bare square at a fixed pitch is a toy, and it was the first
   * thing the player heard on every order they gave.
   */
  private blipAtAbsolute(offset: number, frequency: number, seconds: number, gain: number): void {
    const started = this.begin(gain, true);
    if (started === null) return;
    const { context, out } = started;
    const t = started.now + offset;

    const osc = context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.82, t + seconds);

    const soften = context.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = frequency * 2.2;

    const level = context.createGain();
    level.gain.setValueAtTime(0.0001, t);
    level.gain.exponentialRampToValueAtTime(0.09, t + 0.004);
    level.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(soften).connect(level).connect(out);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  // ----------------------------------------------------------------- support

  /**
   * Opens a gain stage for one effect, or refuses it. The refusal is the
   * important half: a forty-missile volley must not schedule forty voices.
   */
  private begin(
    gain: number,
    ui = false,
  ): { context: AudioContext; out: GainNode; now: number } | null {
    const context = this.context;
    if (context === null || this.master === null || this.mutedState) return null;
    if (gain <= 0.01) return null;

    if (!ui) {
      const now = performance.now();
      if (now - this.window.at > 100) {
        this.window.at = now;
        this.window.count = 0;
      }
      if (this.window.count >= 8) return null;
      this.window.count += 1;
    }

    const out = context.createGain();
    out.gain.value = Math.min(1, gain);

    if (ui) {
      out.connect(this.master);
    } else {
      // Air absorption. Nothing far away keeps its top end, and a shot that
      // does sounds like it is being played next to your ear.
      const air = context.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = Math.max(600, 18_000 - this.lastDistance * 22);
      out.connect(air).connect(this.master);
    }

    return { context, out, now: context.currentTime };
  }

  /**
   * The crack at the front of a shot: a few milliseconds of broadband noise
   * through a high shelf. This is what a gun has and a beep does not — without
   * a transient the ear hears a tone, and a tone at any pitch is a cartoon.
   */
  private crack(at: number, gain: number, colour: number, out: GainNode): void {
    const context = this.context;
    if (context === null || this.noise === null) return;

    const src = context.createBufferSource();
    src.buffer = this.noise;

    const shelf = context.createBiquadFilter();
    shelf.type = 'highpass';
    shelf.frequency.value = colour;

    const level = context.createGain();
    level.gain.setValueAtTime(gain, at);
    level.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);

    src.connect(shelf).connect(level).connect(out);
    src.start(at, this.random());
    src.stop(at + 0.03);
  }

  /**
   * The body of a shot: noise driven through a resonant low-pass that opens
   * and shuts. Real ordnance is broadband — the pitch you hear is a resonance,
   * not an oscillator — so sweeping a filter over noise reads as machinery
   * where sweeping an oscillator reads as a slide whistle.
   */
  private body(
    at: number,
    seconds: number,
    from: number,
    to: number,
    gain: number,
    resonance: number,
    out: GainNode,
  ): void {
    const context = this.context;
    if (context === null || this.noise === null) return;

    const src = context.createBufferSource();
    src.buffer = this.noise;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + seconds);
    filter.Q.value = resonance;

    const level = context.createGain();
    level.gain.setValueAtTime(0.0001, at);
    level.gain.exponentialRampToValueAtTime(gain, at + 0.006);
    level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    src.connect(filter).connect(level).connect(out);
    src.start(at, this.random());
    src.stop(at + seconds + 0.02);
  }

  /** The weight under a heavy shot. Felt more than heard, so it stays a sine. */
  private thump(at: number, seconds: number, from: number, to: number, gain: number, out: GainNode): void {
    const context = this.context;
    if (context === null) return;

    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + seconds);

    const level = context.createGain();
    level.gain.setValueAtTime(gain, at);
    level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    osc.connect(level).connect(out);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  }

  /**
   * Louder near the middle of the screen, gone a map away — and the distance is
   * kept, because volume alone is not what far away sounds like. Air eats the
   * top end first, so a gun across the valley is duller as well as quieter.
   * Without that everything sounds like it is happening in the room with you,
   * which is most of what reads as toy-like.
   */
  private gainAt(at: Vec2): number {
    const distance = Math.hypot(at.x - this.listenAt.x, at.y - this.listenAt.y);
    this.lastDistance = distance;
    return Math.max(0, 1 - distance / 900) ** 1.4;
  }

  /**
   * Reactor alarm for the player's own machines: fires on the way up through
   * the danger band, then holds its tongue for a while per mech.
   */
  private heatAlarms(world: World): void {
    const team = world.playerTeam ?? 0;
    const now = performance.now();
    for (const entity of world.entities) {
      if (entity.team !== team || entity.destroyed) continue;
      const fraction = entity.heatCapacity === 0 ? 0 : entity.heat / entity.heatCapacity;
      const was = this.heatWas.get(entity.id) ?? 0;
      this.heatWas.set(entity.id, fraction);
      if (fraction < 0.85 || was >= 0.85) continue;
      if (now - (this.warned.get(entity.id) ?? -60_000) < 6_000) continue;
      this.warned.set(entity.id, now);
      this.klaxon();
    }
  }

  /** Local xorshift, so detune never leans on the battle's seeded stream. */
  private random(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return ((this.seed >>> 0) % 10_000) / 10_000;
  }
}

const MASTER_LEVEL = 0.5;

/** Loud enough to end the silence, quiet enough never to fight a weapon. */
const AMBIENT_LEVEL = 0.055;

interface AmbientProfile {
  /** Where the wind's top end sits. Low is warm and distant, high is ice. */
  windHz: number;
  /** How often a gust leans on the bed, in cycles per second. */
  gustHz: number;
  /** A standing machine tone, for ground that is itself running. */
  droneHz: number | null;
  /** Trim against the shared ambient level. */
  level: number;
}

const AMBIENT_PROFILES: Record<string, AmbientProfile> = {
  overcast_day: { windHz: 480, gustHz: 0.07, droneHz: null, level: 1 },
  hard_noon: { windHz: 720, gustHz: 0.05, droneHz: null, level: 0.8 },
  moonlit_night: { windHz: 300, gustHz: 0.04, droneHz: null, level: 0.75 },
  ash_dusk: { windHz: 420, gustHz: 0.08, droneHz: 46, level: 1.1 },
  cold_rime: { windHz: 1200, gustHz: 0.1, droneHz: null, level: 0.9 },
};

function positionOf(world: World, id: number): Vec2 | null {
  const entity = world.entities.find((candidate) => candidate.id === id);
  return entity === undefined ? null : entity.pos;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem('ironline.muted') === '1';
  } catch {
    return false;
  }
}
