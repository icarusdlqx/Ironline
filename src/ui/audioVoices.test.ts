import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerWorld } from '../../tests/support';
import type { TerrainMapData } from '../schema/map';
import { AudioDirector } from './audio';
import { startAmbient } from './audioAmbient';
import { AudioGraph, type VoiceBus, type VoiceFrame } from './audioGraph';
import {
  playAbility,
  playAlphaStrike,
  playChime,
  playCollapse,
  playFootfall,
  playHeatWarning,
  playJets,
  playLanding,
  playMissionMessage,
  playOrder,
  playPowerSweep,
  playSelect,
} from './audioVoices';
import { playCrunch, playExplosion, playImpact, playWeapon } from './audioWeapons';

class FakeParam {
  value = 0;

  setValueAtTime(value: number): void {
    this.value = value;
  }

  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
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
}

class FakeBufferSource extends FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
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
    return new FakeFilter() as unknown as BiquadFilterNode;
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

function harness(): {
  bus: VoiceBus;
  context: FakeContext;
  frame: VoiceFrame;
  master: GainNode;
  noise: AudioBuffer;
} {
  const context = new FakeContext();
  const master = context.createGain();
  const noise = {} as AudioBuffer;
  const frame: VoiceFrame = {
    context: context as unknown as AudioContext,
    noise,
    now: context.currentTime,
    out: master,
    random: () => 0.25,
  };
  return { bus: { begin: () => frame }, context, frame, master, noise };
}

describe('procedural audio lifetimes', () => {
  it('puts a finite stop on every one-shot source', () => {
    const { bus, context } = harness();
    const field = { level: 0.8, distance: 40 };

    for (const style of ['beam', 'pulse', 'bolt', 'slug', 'missile', 'flame', 'tracer']) {
      playWeapon(bus, style, 6, field);
    }
    playImpact(bus, field);
    playCrunch(bus, field);
    playExplosion(bus, 1, field);
    playPowerSweep(bus, 360, 50, 0.9, field);
    playJets(bus, field);
    playLanding(bus, field, 1);
    playCollapse(bus, field, 100, 0.62);
    for (const surface of ['open', 'road', 'rough', 'forest', 'water'] as const) {
      playFootfall(bus, surface, field, 70);
    }
    for (const voice of ['aim', 'evade', 'sensor', 'coolant', 'brace', 'mixed'] as const) {
      playAbility(bus, voice, 2);
    }
    playAlphaStrike(bus, 4);
    playMissionMessage(bus);
    playHeatWarning(bus, 1);
    playHeatWarning(bus, 2);
    playHeatWarning(bus, 3);
    playChime(bus);
    playOrder(bus);
    playSelect(bus);

    expect(context.sources.length).toBeGreaterThan(50);
    expect(context.sources.every((source) => source.stops.length === 1)).toBe(true);
    expect(context.sources.every((source) => Number.isFinite(source.stops[0]))).toBe(true);
  });

  it('keeps ambient sources until its handle is stopped', () => {
    const { context, master, noise } = harness();
    const handle = startAmbient(
      {
        context: context as unknown as AudioContext,
        master,
        noise,
        random: () => 0.25,
      },
      'ash_dusk',
    );

    expect(context.sources).toHaveLength(3);
    expect(context.sources.every((source) => source.stops.length === 0)).toBe(true);
    handle.stop();
    handle.stop();
    expect(context.sources.every((source) => source.stops.length === 1)).toBe(true);
  });

  it('closes the shared context once, cancelling scheduled falls with it', () => {
    const { context, master, noise } = harness();
    const graph = new AudioGraph(context as unknown as AudioContext, master, noise);
    graph.close();
    graph.close();
    expect(context.closeCalls).toBe(1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeContext.instances.length = 0;
});

describe('the battle audio lifetime', () => {
  it('routes the new events and cancels their pending sources on destroy', () => {
    vi.stubGlobal('AudioContext', FakeContext as unknown as typeof AudioContext);
    const audio = new AudioDirector();
    const map: TerrainMapData = {
      id: 'audio_map',
      name: 'Audio Map',
      tileSize: 10,
      width: 4,
      height: 4,
      legend: { w: 'water' },
      tiles: ['wwww', 'wwww', 'wwww', 'wwww'],
      atmosphereId: 'ash_dusk',
    };
    audio.setTerrain(map);
    audio.setAmbient('ash_dusk');
    audio.unlock();

    const context = FakeContext.instances.at(-1);
    expect(context).toBeDefined();
    if (context === undefined) return;
    const ambient = [...context.sources];
    const world = playerWorld('audio-routing');
    const mech = world.entities.find((entity) => entity.team === (world.playerTeam ?? 0));
    expect(mech).toBeDefined();
    if (mech === undefined) return;
    audio.listenAt = mech.pos;
    mech.heat = mech.heatCapacity * 0.95;

    audio.consume(world, [
      { type: 'ability_used', tick: world.tick, entityId: mech.id, abilityId: 'coolant_flush' },
      { type: 'alpha_strike', tick: world.tick, entityId: mech.id },
      { type: 'mission_message', tick: world.tick, text: 'Hold where you are.' },
      { type: 'knocked_down', tick: world.tick, entityId: mech.id, attackerId: null },
      { type: 'mech_destroyed', tick: world.tick, entityId: mech.id, method: 'centre_torso' },
    ]);
    audio.footfall({ x: 5, y: 5 }, mech.tonnage);

    expect(context.sources.length).toBeGreaterThan(ambient.length + 10);
    expect(context.sources.slice(ambient.length).every((source) => source.stops.length === 1)).toBe(true);
    audio.destroy();
    expect(ambient.every((source) => source.stops.length === 1)).toBe(true);
    expect(context.closeCalls).toBe(1);
  });
});
