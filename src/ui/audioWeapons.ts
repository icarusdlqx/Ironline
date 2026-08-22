import type { Faction } from '../schema/faction';
import type { Weapon } from '../schema/weapon';
import {
  body,
  crack,
  noiseSweep,
  oscillator,
  thump,
  type VoiceBus,
  type VoicePlacement,
} from './audioGraph';

export interface ImpactVoiceProfile {
  type: Weapon['type'];
  style: Weapon['visual']['style'];
  damage: number;
}

export type DestructionVoiceProfile =
  | { kind: 'ammo'; damage: number }
  | { kind: 'terminal'; tonnage: number };

export function playWeapon(
  bus: VoiceBus,
  faction: Faction,
  style: string,
  projectiles: number,
  placement: VoicePlacement,
): void {
  if (faction === 'aurelian') {
    sealedDischarge(bus, style, projectiles, placement);
    return;
  }

  switch (style) {
    case 'beam':
      beam(bus, placement);
      return;
    case 'pulse':
      pulses(bus, 3, placement);
      return;
    case 'bolt':
      bolt(bus, placement);
      return;
    case 'slug':
      slug(bus, placement);
      return;
    case 'missile':
      missiles(bus, Math.min(6, projectiles), placement);
      return;
    case 'flame':
      hiss(bus, 0.45, 900, scaled(placement, 0.8));
      return;
    case 'burst':
    case 'tracer':
    default:
      cannon(bus, Math.min(5, Math.max(1, Math.round(projectiles / 2))), placement);
  }
}

/** The sealed chamber rings after discharge; the sim has no pre-fire event to predict. */
function sealedDischarge(
  bus: VoiceBus,
  style: string,
  projectiles: number,
  placement: VoicePlacement,
): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  const pulseCount = style === 'pulse' ? Math.min(4, Math.max(2, projectiles)) : 1;
  const charge = style === 'bolt' ? 0.22 : 0.17;
  const peak = style === 'bolt' ? 1_340 : style === 'pulse' ? 1_020 : 1_180;

  oscillator(frame, frame.now, charge, peak, 170, 0.16, 'sine');
  oscillator(frame, frame.now + 0.035, charge - 0.035, peak * 1.5, 340, 0.055, 'triangle');

  for (let i = 0; i < pulseCount; i += 1) {
    const at = frame.now + i * 0.055;
    crack(frame, at, style === 'bolt' ? 0.42 : 0.28, style === 'bolt' ? 3_100 : 3_800);
    body(frame, at, style === 'beam' ? 0.24 : 0.09, 6_200, 620, 0.3, 4.5);
  }

  if (style === 'beam') {
    noiseSweep(frame, frame.now, 0.25, 4_800, 1_200, 0.18, 'bandpass', 3.2);
  } else if (style === 'bolt') {
    thump(frame, frame.now, 0.16, 150, 52, 0.22);
  }
}

/** A laser is air tearing, not a note: hiss with a resonance that closes. */
function beam(bus: VoiceBus, placement: VoicePlacement): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  crack(frame, frame.now, 0.22, 3200);
  body(frame, frame.now, 0.3, 5200, 700, 0.34, 3.5);
  thump(frame, frame.now, 0.12, 120, 60, 0.12);
}

function pulses(bus: VoiceBus, count: number, placement: VoicePlacement): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  for (let i = 0; i < count; i += 1) {
    const at = frame.now + i * 0.058;
    crack(frame, at, 0.18, 3400);
    body(frame, at, 0.075, 4600 - i * 500, 900, 0.3, 4);
  }
}

/** A particle bolt: a hard electrical snap over a discharge that falls away. */
function bolt(bus: VoiceBus, placement: VoicePlacement): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  crack(frame, frame.now, 0.5, 2600);
  body(frame, frame.now, 0.26, 7000, 400, 0.42, 5);
  thump(frame, frame.now, 0.2, 180, 48, 0.34);
}

/** A gauss slug carries its weight in the sub, with a capacitor snap on top. */
function slug(bus: VoiceBus, placement: VoicePlacement): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  crack(frame, frame.now, 0.34, 1800);
  thump(frame, frame.now, 0.42, 88, 28, 0.95);
  body(frame, frame.now, 0.2, 900, 120, 0.3, 1.2);
}

/** Each round gets a slight timing error; machined bursts are not metronomes. */
function cannon(bus: VoiceBus, rounds: number, placement: VoicePlacement): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  for (let i = 0; i < rounds; i += 1) {
    const at = frame.now + i * (0.062 + frame.random() * 0.016);
    crack(frame, at, 0.42, 2200);
    body(frame, at, 0.11, 2600, 260, 0.46, 2.2);
    thump(frame, at, 0.14, 130 + frame.random() * 30, 45, 0.5);
  }
}

function missiles(bus: VoiceBus, count: number, placement: VoicePlacement): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  for (let i = 0; i < count; i += 1) {
    const at = frame.now + i * 0.06;
    const src = frame.context.createBufferSource();
    src.buffer = frame.noise;
    const band = frame.context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(500, at);
    band.frequency.exponentialRampToValueAtTime(2200, at + 0.28);
    band.Q.value = 1.2;
    const level = frame.context.createGain();
    level.gain.setValueAtTime(0.001, at);
    level.gain.exponentialRampToValueAtTime(0.3, at + 0.06);
    level.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    src.connect(band).connect(level).connect(frame.out);
    src.start(at, frame.random() * 0.4);
    src.stop(at + 0.32);
  }
}

function hiss(bus: VoiceBus, seconds: number, cutoff: number, placement: VoicePlacement): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  const src = frame.context.createBufferSource();
  src.buffer = frame.noise;
  src.loop = true;
  const low = frame.context.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = cutoff;
  const level = frame.context.createGain();
  level.gain.setValueAtTime(0.001, frame.now);
  level.gain.exponentialRampToValueAtTime(0.35, frame.now + 0.08);
  level.gain.exponentialRampToValueAtTime(0.001, frame.now + seconds);
  src.connect(low).connect(level).connect(frame.out);
  src.start(frame.now, frame.random() * 0.5);
  src.stop(frame.now + seconds + 0.05);
}

/** The struck plate identifies the projectile before the damage readout does. */
export function playImpact(
  bus: VoiceBus,
  profile: ImpactVoiceProfile,
  placement: VoicePlacement,
): void {
  const frame = bus.begin(scaled(placement, 0.7));
  if (frame === null) return;
  const weight = bounded(profile.damage / 24, 0.08, 1.25);
  const heavy = profile.damage >= 12;

  if (profile.type === 'energy') {
    if (profile.style === 'flame') {
      noiseSweep(
        frame,
        frame.now,
        heavy ? 0.34 : 0.2,
        2_600,
        420,
        0.12 + weight * 0.18,
        'bandpass',
        2.8,
      );
    } else {
      crack(frame, frame.now, 0.12 + weight * 0.2, profile.style === 'bolt' ? 4_200 : 5_200);
      body(
        frame,
        frame.now,
        heavy ? 0.28 : 0.12,
        profile.style === 'bolt' ? 7_600 : 6_200,
        heavy ? 420 : 900,
        0.14 + weight * 0.2,
        profile.style === 'bolt' ? 6 : 4.5,
      );
    }
    if (heavy || profile.style === 'bolt') {
      oscillator(frame, frame.now, 0.18 + weight * 0.08, 210, 70, 0.1 + weight * 0.12, 'triangle');
    }
    return;
  }

  if (profile.type === 'missile') {
    const seconds = 0.16 + weight * 0.24;
    crack(frame, frame.now, 0.18 + weight * 0.2, 1_100);
    noiseSweep(frame, frame.now, seconds, 2_800, 220, 0.22 + weight * 0.2, 'lowpass', 1.3);
    thump(frame, frame.now, seconds * 0.75, 100 + weight * 40, 36, 0.18 + weight * 0.3);
    if (heavy) body(frame, frame.now, seconds * 0.8, 1_600, 100, 0.28, 1.8);
    return;
  }

  const seconds = 0.12 + weight * 0.22;
  crack(frame, frame.now, 0.2 + weight * 0.25, 1_500);
  body(frame, frame.now, seconds, 2_400, 140, 0.25 + weight * 0.25, 2.4);
  thump(frame, frame.now, seconds * 0.9, 130 + weight * 35, 45, 0.25 + weight * 0.38);
  if (heavy) noiseSweep(frame, frame.now, seconds * 0.75, 1_800, 180, 0.16, 'lowpass');
}

/** Structure failing: the tear first, then the weight of it coming apart. */
export function playCrunch(bus: VoiceBus, placement: VoicePlacement): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  crack(frame, frame.now, 0.45, 1200);
  body(frame, frame.now, 0.3, 3000, 200, 0.55, 1.6);
  thump(frame, frame.now + 0.04, 0.34, 110, 34, 0.6);
}

/** Ammunition ruptures inside plate; a terminal blast moves the air outside it. */
export function playDestruction(
  bus: VoiceBus,
  profile: DestructionVoiceProfile,
  placement: VoicePlacement,
): void {
  const frame = bus.begin(placement);
  if (frame === null) return;
  if (profile.kind === 'ammo') {
    const size = bounded(profile.damage / 60, 0.2, 1.25);
    const seconds = 0.28 + size * 0.32;
    crack(frame, frame.now, 0.48 + size * 0.24, 900);
    body(frame, frame.now, seconds, 3_800, 160, 0.46 + size * 0.22, 2.2);
    noiseSweep(frame, frame.now, seconds * 0.75, 6_500, 800, 0.16 + size * 0.14, 'bandpass', 2.6);
    thump(frame, frame.now, 0.2 + size * 0.12, 120, 40, 0.32 + size * 0.28);
    return;
  }

  const size = bounded(profile.tonnage / 100, 0.3, 1.35);
  const seconds = 0.75 + size * 0.55;
  const src = frame.context.createBufferSource();
  src.buffer = frame.noise;
  const low = frame.context.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.setValueAtTime(1400, frame.now);
  low.frequency.exponentialRampToValueAtTime(60, frame.now + seconds * 0.9);
  const level = frame.context.createGain();
  level.gain.setValueAtTime(0.9, frame.now);
  level.gain.exponentialRampToValueAtTime(0.001, frame.now + seconds);
  src.connect(low).connect(level).connect(frame.out);
  src.start(frame.now, frame.random() * 0.3);
  src.stop(frame.now + seconds + 0.05);
  oscillator(frame, frame.now, seconds * 0.85, 65, 24, 0.55 + size * 0.25, 'sine');
  body(frame, frame.now, 0.34 + size * 0.18, 1_100, 80, 0.34 + size * 0.16, 1.2);
}

function scaled(placement: VoicePlacement, factor: number): VoicePlacement {
  return { level: placement.level * factor, distance: placement.distance };
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
