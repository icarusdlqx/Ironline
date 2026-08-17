import type { AbilityVoice, FootfallSurface, HeatCue } from './audioCues';
import {
  blip,
  body,
  crack,
  noiseSweep,
  oscillator,
  thump,
  type VoiceBus,
  type VoicePlacement,
} from './audioGraph';

export function playPowerSweep(
  bus: VoiceBus,
  from: number,
  to: number,
  seconds: number,
  placement: VoicePlacement,
): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  oscillator(frame, frame.now, seconds, from, to, 0.25, 'sawtooth');
}

export function playJets(bus: VoiceBus, placement: VoicePlacement): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  const src = frame.context.createBufferSource();
  src.buffer = frame.noise;
  src.loop = true;
  const band = frame.context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(300, frame.now);
  band.frequency.exponentialRampToValueAtTime(900, frame.now + 0.5);
  band.Q.value = 0.8;
  const level = frame.context.createGain();
  level.gain.setValueAtTime(0.001, frame.now);
  level.gain.exponentialRampToValueAtTime(0.5, frame.now + 0.12);
  level.gain.exponentialRampToValueAtTime(0.001, frame.now + 0.9);
  src.connect(band).connect(level).connect(frame.out);
  src.start(frame.now, frame.random() * 0.4);
  src.stop(frame.now + 0.95);
}

export function playLanding(bus: VoiceBus, placement: VoicePlacement, weight: number): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  const mass = Math.max(0.3, Math.min(1.2, weight));
  thump(frame, frame.now, 0.18, 70 + 40 * (1 - mass), 30, 0.7);
}

/** A fall is delayed to meet the rendered hull, not the tick that condemned it. */
export function playCollapse(
  bus: VoiceBus,
  placement: VoicePlacement,
  tonnage: number,
  delay: number,
): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  const at = frame.now + delay;
  const mass = Math.max(0.35, Math.min(1.15, tonnage / 90));
  crack(frame, at, 0.2 + mass * 0.16, 850);
  body(frame, at, 0.34, 1300, 120, 0.3 + mass * 0.28, 1.1);
  thump(frame, at, 0.42, 72 - mass * 18, 24, 0.5 + mass * 0.35);
}

export function playFootfall(
  bus: VoiceBus,
  surface: FootfallSurface,
  placement: VoicePlacement,
  tonnage: number,
): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  const mass = Math.max(0.3, Math.min(1.2, tonnage / 90));
  thump(frame, frame.now, 0.16, 78 - mass * 20, 30, 0.38 + mass * 0.18);

  switch (surface) {
    case 'road':
      crack(frame, frame.now, 0.16, 1450);
      body(frame, frame.now, 0.09, 1900, 520, 0.2, 1.8);
      return;
    case 'rough':
      body(frame, frame.now, 0.13, 2600, 330, 0.24, 1.2);
      crack(frame, frame.now + 0.035, 0.08, 2100);
      return;
    case 'forest':
      body(frame, frame.now, 0.16, 720, 150, 0.2, 0.7);
      crack(frame, frame.now + 0.025, 0.05, 1050);
      return;
    case 'water':
      noiseSweep(frame, frame.now, 0.26, 900, 260, 0.34, 'bandpass', 0.55);
      return;
    case 'open':
    default:
      body(frame, frame.now, 0.1, 950, 180, 0.16, 0.8);
  }
}

export function playAbility(bus: VoiceBus, voice: AbilityVoice, count: number): void {
  const frame = bus.begin({ level: Math.min(0.18, 0.1 + count * 0.015), distance: null });
  if (frame === null) return;
  switch (voice) {
    case 'aim':
      blip(frame, frame.now, 920, 0.08, 0.08);
      blip(frame, frame.now + 0.085, 720, 0.11, 0.07);
      return;
    case 'evade':
      oscillator(frame, frame.now, 0.32, 130, 520, 0.12, 'triangle');
      noiseSweep(frame, frame.now, 0.3, 220, 1100, 0.15, 'bandpass', 0.7);
      return;
    case 'sensor':
      blip(frame, frame.now, 620, 0.05, 0.06);
      blip(frame, frame.now + 0.07, 890, 0.05, 0.065);
      blip(frame, frame.now + 0.14, 1280, 0.07, 0.055);
      return;
    case 'coolant':
      noiseSweep(frame, frame.now, 0.62, 1800, 240, 0.28, 'lowpass', 0.5);
      oscillator(frame, frame.now, 0.4, 150, 65, 0.07, 'sine');
      return;
    case 'brace':
      crack(frame, frame.now, 0.22, 900);
      body(frame, frame.now, 0.22, 1400, 180, 0.34, 1.3);
      thump(frame, frame.now + 0.035, 0.28, 90, 32, 0.42);
      return;
    case 'mixed':
    default:
      body(frame, frame.now, 0.18, 2100, 260, 0.22, 1.5);
      blip(frame, frame.now, 680, 0.06, 0.055);
      blip(frame, frame.now + 0.08, 930, 0.08, 0.05);
  }
}

/** Relays close before the reactor note rises; the guns provide their own violence. */
export function playAlphaStrike(bus: VoiceBus, count: number): void {
  const frame = bus.begin({ level: Math.min(0.24, 0.14 + count * 0.018), distance: null });
  if (frame === null) return;
  for (let i = 0; i < Math.min(3, count); i += 1) {
    crack(frame, frame.now + i * 0.045, 0.16, 1150 + i * 260);
  }
  body(frame, frame.now, 0.42, 2300, 190, 0.32, 2.1);
  oscillator(frame, frame.now, 0.58, 88, 540, 0.18, 'sawtooth');
  thump(frame, frame.now + 0.38, 0.3, 75, 28, 0.34);
}

/** A dispatch reaching the console, quiet enough to lose beneath gunfire. */
export function playMissionMessage(bus: VoiceBus): void {
  const frame = bus.begin({ level: 0.075, distance: null });
  if (frame === null) return;
  noiseSweep(frame, frame.now, 0.08, 2400, 1100, 0.08, 'bandpass', 2.2);
  blip(frame, frame.now + 0.015, 1040, 0.055, 0.045);
  blip(frame, frame.now + 0.095, 820, 0.07, 0.04);
}

/** The same warning climbs in pitch and urgency as the headroom disappears. */
export function playHeatWarning(bus: VoiceBus, tier: HeatCue): void {
  const frame = bus.begin({ level: 0.09 + tier * 0.018, distance: null });
  if (frame === null) return;
  const base = tier === 1 ? 390 : tier === 2 ? 540 : 720;
  blip(frame, frame.now, base, 0.09, 0.065 + tier * 0.01);
  blip(frame, frame.now + (tier === 3 ? 0.11 : 0.14), base * 1.28, 0.11, 0.06 + tier * 0.012);
  if (tier === 3) blip(frame, frame.now + 0.23, base * 1.28, 0.11, 0.08);
}

export function playChime(bus: VoiceBus): void {
  const frame = bus.begin({ level: 0.12, distance: null });
  if (frame === null) return;
  blip(frame, frame.now, 660, 0.12, 0.09);
  blip(frame, frame.now + 0.13, 990, 0.16, 0.09);
}

export function playOrder(bus: VoiceBus): void {
  const frame = bus.begin({ level: 0.1, distance: null });
  if (frame !== null) blip(frame, frame.now, 880, 0.05, 0.09);
}

export function playSelect(bus: VoiceBus): void {
  const frame = bus.begin({ level: 0.07, distance: null });
  if (frame !== null) blip(frame, frame.now, 620, 0.04, 0.09);
}
