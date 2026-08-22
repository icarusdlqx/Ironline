import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerWorld } from '../../tests/support';
import type { SimEvent } from '../sim/events';
import type { MechEntity, World } from '../sim/types';
import { AudioDirector } from './audio';
import {
  AudioGraph,
  FIELD_VOICE_LIMIT,
  FIELD_VOICE_WINDOW_MS,
  type VoiceBus,
  type VoiceFrame,
} from './audioGraph';
import {
  playDestruction,
  playImpact,
  playWeapon,
  type DestructionVoiceProfile,
  type ImpactVoiceProfile,
} from './audioWeapons';

class FakeParam {
  value = 0;
  readonly setValues: number[] = [];
  readonly rampValues: number[] = [];

  setValueAtTime(value: number): void {
    this.value = value;
    this.setValues.push(value);
  }

  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
    this.rampValues.push(value);
  }

  setTargetAtTime(value: number): void {
    this.value = value;
  }
}

class FakeNode {
  connect<T>(destination: T): T {
    return destination;
  }
}

class FakeSource extends FakeNode {
  readonly starts: number[] = [];
  readonly stops: number[] = [];

  constructor(readonly kind: 'buffer' | 'oscillator') {
    super();
  }

  start(when = 0): void {
    this.starts.push(when);
  }

  stop(when = 0): void {
    this.stops.push(when);
  }
}

class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam();

  constructor() {
    super('oscillator');
  }
}

class FakeBufferSource extends FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;

  constructor() {
    super('buffer');
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam();
  readonly ratio = new FakeParam();
}

class FakeContext {
  static readonly instances: FakeContext[] = [];

  readonly currentTime = 5;
  readonly sampleRate = 8;
  readonly destination = new FakeNode() as unknown as AudioDestinationNode;
  readonly sources: FakeSource[] = [];
  readonly filters: FakeFilter[] = [];
  closeCalls = 0;
  state: AudioContextState = 'running';

  constructor() {
    FakeContext.instances.push(this);
  }

  createDynamicsCompressor(): DynamicsCompressorNode {
    return new FakeCompressor() as unknown as DynamicsCompressorNode;
  }

  createBuffer(_channels: number, length: number): AudioBuffer {
    const data = new Float32Array(length);
    return { getChannelData: () => data } as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createOscillator(): OscillatorNode {
    const source = new FakeOscillator();
    this.sources.push(source);
    return source as unknown as OscillatorNode;
  }

  createGain(): GainNode {
    return new FakeGain() as unknown as GainNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    const filter = new FakeFilter();
    this.filters.push(filter);
    return filter as unknown as BiquadFilterNode;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
}

function voiceHarness(): { bus: VoiceBus; context: FakeContext } {
  const context = new FakeContext();
  const frame: VoiceFrame = {
    context: context as unknown as AudioContext,
    noise: {} as AudioBuffer,
    now: context.currentTime,
    out: context.createGain(),
    random: () => 0.25,
  };
  return { bus: { begin: () => frame }, context };
}

function signatureOf(context: FakeContext): { pattern: string; tail: number } {
  const starts = context.sources.map((source) => source.starts[0] ?? context.currentTime);
  const stops = context.sources.map((source) => source.stops[0] ?? context.currentTime);
  const filters = context.filters.map(
    (filter) => filter.frequency.setValues[0] ?? filter.frequency.value,
  );
  return {
    pattern: JSON.stringify({
      sources: context.sources.map((source, index) => [
        source.kind,
        (starts[index] ?? context.currentTime) - context.currentTime,
        (stops[index] ?? context.currentTime) - context.currentTime,
      ]),
      filters,
    }),
    tail: Math.max(...stops, context.currentTime) - context.currentTime,
  };
}

function impactSignature(profile: ImpactVoiceProfile): ReturnType<typeof signatureOf> {
  const { bus, context } = voiceHarness();
  playImpact(bus, profile, { level: 0.8, distance: 40 });
  return signatureOf(context);
}

function destructionSignature(profile: DestructionVoiceProfile): ReturnType<typeof signatureOf> {
  const { bus, context } = voiceHarness();
  playDestruction(bus, profile, { level: 0.8, distance: 40 });
  return signatureOf(context);
}

function firingEvent(world: World, entity: MechEntity): Extract<SimEvent, { type: 'weapon_fired' }> {
  const mount = entity.weapons.find((candidate) => world.catalog.weapons.has(candidate.weaponId));
  const target = world.entities.find((candidate) => candidate.team !== entity.team);
  if (mount === undefined || target === undefined) throw new Error('audio test needs two armed teams');
  return {
    type: 'weapon_fired',
    tick: world.tick,
    shooterId: entity.id,
    targetId: target.id,
    weaponId: mount.weaponId,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeContext.instances.length = 0;
});

describe('weapon onset', () => {
  it('starts the physical attack on the firing event for every faction vocabulary', () => {
    const styles = ['beam', 'pulse', 'bolt', 'slug', 'missile', 'flame', 'burst', 'tracer'];
    for (const faction of ['linewrought', 'aurelian'] as const) {
      for (const style of styles) {
        const { bus, context } = voiceHarness();
        playWeapon(bus, faction, style, 6, { level: 0.8, distance: 40 });

        const attacks = context.sources.filter((source) => source.kind === 'buffer');
        expect(attacks.some((source) => source.starts[0] === context.currentTime), `${faction}:${style}`)
          .toBe(true);
        expect(context.sources.every((source) => source.stops.length === 1)).toBe(true);
        expect(context.sources.every((source) => Number.isFinite(source.stops[0]))).toBe(true);
      }
    }
  });

  it('separates impact material, authored style and light-to-heavy tails', () => {
    const lightProfiles: ImpactVoiceProfile[] = [
      { type: 'energy', style: 'beam', damage: 5 },
      { type: 'ballistic', style: 'tracer', damage: 5 },
      { type: 'missile', style: 'missile', damage: 5 },
    ];
    const light = lightProfiles.map(impactSignature);
    expect(new Set(light.map((voice) => voice.pattern)).size).toBe(3);
    expect(impactSignature({ type: 'energy', style: 'flame', damage: 5 }).pattern)
      .not.toBe(light[0]?.pattern);

    for (const profile of lightProfiles) {
      const heavy = impactSignature({ ...profile, damage: 24 });
      const quiet = impactSignature(profile);
      expect(heavy.tail, `${profile.type}:${profile.style}`).toBeGreaterThan(quiet.tail);
    }
  });

  it('keeps ammunition rupture separate from terminal destruction and scales both', () => {
    const ammo = destructionSignature({ kind: 'ammo', damage: 25 });
    const terminal = destructionSignature({ kind: 'terminal', tonnage: 80 });
    expect(ammo.pattern).not.toBe(terminal.pattern);
    expect(destructionSignature({ kind: 'ammo', damage: 75 }).tail)
      .toBeGreaterThan(destructionSignature({ kind: 'ammo', damage: 10 }).tail);
    expect(destructionSignature({ kind: 'terminal', tonnage: 135 }).tail)
      .toBeGreaterThan(destructionSignature({ kind: 'terminal', tonnage: 30 }).tail);
  });
});

describe('field voice admission', () => {
  it('admits only eight voices in one 100ms window under a thousand offers', () => {
    const context = new FakeContext();
    const graph = new AudioGraph(
      context as unknown as AudioContext,
      context.createGain(),
      {} as AudioBuffer,
    );
    const clock = vi.spyOn(performance, 'now').mockReturnValue(250);
    let admitted = 0;
    for (let offer = 0; offer < 1_000; offer += 1) {
      if (graph.begin({ level: 1, distance: 20 }) !== null) admitted += 1;
    }

    expect(admitted).toBe(FIELD_VOICE_LIMIT);
    expect(graph.begin({ level: 1, distance: null })).not.toBeNull();
    clock.mockReturnValue(250 + FIELD_VOICE_WINDOW_MS + 1);
    expect(graph.begin({ level: 1, distance: 20 })).not.toBeNull();
    graph.close();
    graph.close();
    expect(context.closeCalls).toBe(1);
  });

  it('bounds a thousand weapon events and closes every source with the battle', () => {
    vi.stubGlobal('AudioContext', FakeContext as unknown as typeof AudioContext);
    vi.spyOn(performance, 'now').mockReturnValue(250);
    const world = playerWorld('audio-thousand-events');
    const team = world.playerTeam ?? 0;
    const shooter = world.entities.find((entity) => entity.team === team);
    expect(shooter).toBeDefined();
    if (shooter === undefined) return;

    const event = firingEvent(world, shooter);
    const audio = new AudioDirector();
    audio.listenAt = shooter.pos;
    audio.unlock();
    audio.consume(world, Array.from({ length: 1_000 }, () => ({ ...event })));

    const context = FakeContext.instances.at(-1);
    expect(context).toBeDefined();
    if (context === undefined) return;
    expect(context.sources.length).toBeLessThanOrEqual(FIELD_VOICE_LIMIT * 15);
    expect(context.sources.every((source) => source.stops.length === 1)).toBe(true);
    expect(context.sources.every((source) => Number.isFinite(source.stops[0]))).toBe(true);
    audio.destroy();
    audio.destroy();
    expect(context.closeCalls).toBe(1);
  });
});

describe('audible visibility', () => {
  it('routes catalogue hits and event destruction facts into their typed voices', () => {
    vi.stubGlobal('AudioContext', FakeContext as unknown as typeof AudioContext);
    vi.spyOn(performance, 'now').mockReturnValue(250);
    const world = playerWorld('audio-event-routing');
    const target = world.entities.find((entity) => entity.team === (world.playerTeam ?? 0));
    expect(target).toBeDefined();
    if (target === undefined) return;

    const heard = (event: SimEvent): string => {
      const audio = new AudioDirector();
      audio.listenAt = target.pos;
      audio.unlock();
      audio.consume(world, [event]);
      const context = FakeContext.instances.at(-1);
      expect(context).toBeDefined();
      if (context === undefined) return '';
      const pattern = signatureOf(context).pattern;
      audio.destroy();
      return pattern;
    };
    const hit = (weaponId: string): SimEvent => ({
      type: 'projectile_hit', tick: world.tick, shooterId: target.id, targetId: target.id,
      weaponId, location: 'centre_torso', damage: 5, arc: 'front',
    });

    expect(new Set(['medium_laser', 'ac5', 'lrm10'].map((id) => heard(hit(id)))).size).toBe(3);
    expect(heard({
      type: 'ammo_explosion', tick: world.tick, entityId: target.id,
      location: 'centre_torso', damage: 25,
    })).not.toBe(heard({
      type: 'mech_destroyed', tick: world.tick, entityId: target.id, method: 'centre_torso',
    }));
  });

  it('keeps hidden fire and hostile command cues out of the player mix', () => {
    vi.stubGlobal('AudioContext', FakeContext as unknown as typeof AudioContext);
    vi.spyOn(performance, 'now').mockReturnValue(250);
    const world = playerWorld('audio-visibility');
    const team = world.playerTeam ?? 0;
    const enemy = world.entities.find((entity) => entity.team !== team);
    const ally = world.entities.find((entity) => entity.team === team);
    expect(enemy).toBeDefined();
    expect(ally).toBeDefined();
    expect(world.vision).not.toBeNull();
    if (enemy === undefined || ally === undefined || world.vision === null) return;

    const audio = new AudioDirector();
    audio.listenAt = enemy.pos;
    audio.unlock();
    const context = FakeContext.instances.at(-1);
    expect(context).toBeDefined();
    if (context === undefined) return;

    world.vision.visible.delete(enemy.id);
    const hiddenFire = firingEvent(world, enemy);
    audio.consume(world, Array.from({ length: 1_000 }, () => ({ ...hiddenFire })));
    expect(context.sources).toHaveLength(0);

    world.vision.visible.add(enemy.id);
    audio.consume(world, [firingEvent(world, enemy)]);
    expect(context.sources.length).toBeGreaterThan(0);
    const afterFieldVoice = context.sources.length;
    audio.consume(world, [
      { type: 'ability_used', tick: world.tick, entityId: enemy.id, abilityId: 'brace' },
    ]);
    expect(context.sources).toHaveLength(afterFieldVoice);
    audio.consume(world, [
      { type: 'ability_used', tick: world.tick, entityId: ally.id, abilityId: 'brace' },
    ]);
    expect(context.sources.length).toBeGreaterThan(afterFieldVoice);
    audio.destroy();
  });
});
