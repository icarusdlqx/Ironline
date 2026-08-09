import { Graphics } from 'pixi.js';
import type { SimEvent } from '../sim/events';
import type { Vec2 } from '../sim/types';
import { UI } from './palette';

export interface WeaponVisual {
  style: 'beam' | 'pulse' | 'bolt' | 'tracer' | 'slug' | 'missile' | 'flame' | 'burst';
  colour: number;
  width: number;
  arc: number;
  /** Rounds in one pull of the trigger; a salvo draws as a salvo. */
  projectiles: number;
}

type EffectKind = WeaponVisual['style'] | 'burst' | 'smoke' | 'muzzle';

interface Effect {
  kind: EffectKind;
  from: Vec2;
  to: Vec2;
  age: number;
  life: number;
  colour: number;
  size: number;
  arc: number;
  /** Sideways offset so the rounds of a salvo do not overlap perfectly. */
  drift: number;
  seed: number;
}

const BEAM_LIFE = 0.22;
const BOLT_LIFE = 0.3;
const BURST_LIFE = 0.55;
const SMOKE_LIFE = 1.6;
const MUZZLE_LIFE = 0.1;
const MAX_EFFECTS = 900;

const DEFAULT_VISUAL: WeaponVisual = {
  style: 'tracer',
  colour: UI.tracerBallistic,
  width: 2,
  arc: 0,
  projectiles: 1,
};

function jitter(seed: number): number {
  // Cheap deterministic hash: salvos scatter the same way every replay.
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value) - 0.5;
}

export class EffectLayer {
  readonly graphics = new Graphics();
  private effects: Effect[] = [];
  private counter = 0;

  spawnFromEvents(
    events: readonly SimEvent[],
    positionOf: (id: number) => Vec2 | null,
    visualOf: (weaponId: string) => WeaponVisual | null,
    travelSeconds: (weaponId: string, from: Vec2, to: Vec2) => number,
  ): void {
    for (const event of events) {
      if (event.type === 'weapon_fired') {
        const from = positionOf(event.shooterId);
        const to = positionOf(event.targetId);
        if (from === null || to === null) continue;
        this.spawnShot(event.weaponId, from, to, visualOf(event.weaponId) ?? DEFAULT_VISUAL, travelSeconds);
        continue;
      }

      if (event.type === 'projectile_hit') {
        const at = positionOf(event.targetId);
        if (at === null) continue;
        const visual = visualOf(event.weaponId) ?? DEFAULT_VISUAL;
        this.push({
          kind: 'burst',
          from: at,
          to: at,
          age: 0,
          life: 0.28,
          colour: visual.colour,
          size: 4 + Math.min(14, event.damage),
          arc: 0,
          drift: 0,
          seed: this.counter,
        });
        continue;
      }

      if (event.type === 'mech_destroyed' || event.type === 'ammo_explosion') {
        const at = positionOf(event.entityId);
        if (at === null) continue;
        this.push({
          kind: 'burst',
          from: at,
          to: at,
          age: 0,
          life: BURST_LIFE,
          colour: UI.explosion,
          size: event.type === 'ammo_explosion' ? 60 : 42,
          arc: 0,
          drift: 0,
          seed: this.counter,
        });
        this.spawnSmoke(at);
      }
    }
  }

  private spawnShot(
    weaponId: string,
    from: Vec2,
    to: Vec2,
    visual: WeaponVisual,
    travelSeconds: (weaponId: string, from: Vec2, to: Vec2) => number,
  ): void {
    // Every shot flashes at the muzzle, whatever comes out of it.
    this.push({
      kind: 'muzzle',
      from,
      to,
      age: 0,
      life: MUZZLE_LIFE,
      colour: visual.colour,
      size: visual.width * 1.8,
      arc: 0,
      drift: 0,
      seed: this.counter,
    });

    const hitscan = visual.style === 'beam' || visual.style === 'pulse' || visual.style === 'flame';
    const life = hitscan
      ? visual.style === 'flame'
        ? 0.18
        : BEAM_LIFE
      : visual.style === 'bolt'
        ? BOLT_LIFE
        : Math.max(0.08, travelSeconds(weaponId, from, to));

    // A ten-tube launcher puts ten missiles in the air, not one dot.
    const rounds = visual.style === 'missile' || visual.style === 'tracer'
      ? Math.min(visual.projectiles, 20)
      : 1;

    for (let round = 0; round < rounds; round += 1) {
      this.counter += 1;
      this.push({
        kind: visual.style,
        from,
        to,
        age: -round * (visual.style === 'missile' ? 0.035 : 0.02),
        life,
        colour: visual.colour,
        size: visual.width,
        arc: visual.arc,
        drift: rounds === 1 ? 0 : jitter(this.counter) * 26,
        seed: this.counter,
      });
    }
  }

  spawnSmoke(at: Vec2): void {
    this.counter += 1;
    this.push({
      kind: 'smoke',
      from: at,
      to: at,
      age: 0,
      life: SMOKE_LIFE,
      colour: UI.smoke,
      size: 22,
      arc: 0,
      drift: 0,
      seed: this.counter,
    });
  }

  update(deltaSeconds: number): void {
    for (const effect of this.effects) effect.age += deltaSeconds;
    this.effects = this.effects.filter((effect) => effect.age < effect.life);
  }

  draw(): void {
    this.graphics.clear();
    for (const effect of this.effects) {
      if (effect.age < 0) continue;
      this.drawOne(effect, Math.min(1, effect.age / effect.life));
    }
  }

  get count(): number {
    return this.effects.length;
  }

  private drawOne(effect: Effect, progress: number): void {
    const dx = effect.to.x - effect.from.x;
    const dy = effect.to.y - effect.from.y;
    const span = Math.hypot(dx, dy) || 1;
    // Unit normal, for spreading a salvo across the line of fire.
    const nx = -dy / span;
    const ny = dx / span;

    switch (effect.kind) {
      case 'beam':
        this.graphics
          .moveTo(effect.from.x, effect.from.y)
          .lineTo(effect.to.x, effect.to.y)
          .stroke({ width: effect.size * (1 - progress * 0.6), color: effect.colour, alpha: 1 - progress });
        // Core: a laser reads as a hot line inside a cooler one.
        this.graphics
          .moveTo(effect.from.x, effect.from.y)
          .lineTo(effect.to.x, effect.to.y)
          .stroke({ width: effect.size * 0.35, color: 0xffffff, alpha: (1 - progress) * 0.7 });
        return;

      case 'pulse': {
        // A pulse laser is a string of bursts, not a continuous beam.
        const pulses = 5;
        for (let index = 0; index < pulses; index += 1) {
          const at = (index + 0.5) / pulses;
          if (at < progress - 0.35 || at > progress + 0.35) continue;
          this.graphics
            .circle(effect.from.x + dx * at, effect.from.y + dy * at, effect.size * 0.8)
            .fill({ color: effect.colour, alpha: 1 - progress });
        }
        return;
      }

      case 'bolt': {
        // Particle cannon: a jagged discharge that decays rather than a clean line.
        const steps = 7;
        this.graphics.moveTo(effect.from.x, effect.from.y);
        for (let index = 1; index <= steps; index += 1) {
          const at = index / steps;
          const wobble = index === steps ? 0 : jitter(effect.seed + index) * effect.size * 3.2;
          this.graphics.lineTo(effect.from.x + dx * at + nx * wobble, effect.from.y + dy * at + ny * wobble);
        }
        this.graphics.stroke({
          width: effect.size * (1 - progress * 0.5),
          color: effect.colour,
          alpha: 1 - progress,
        });
        return;
      }

      case 'slug': {
        // Gauss: a short, very fast, very bright streak.
        const head = Math.min(1, progress * 1.6);
        const tail = Math.max(0, head - 0.3);
        this.graphics
          .moveTo(effect.from.x + dx * tail, effect.from.y + dy * tail)
          .lineTo(effect.from.x + dx * head, effect.from.y + dy * head)
          .stroke({ width: effect.size, color: 0xffffff, alpha: 1 - progress * 0.4 });
        return;
      }

      case 'flame': {
        // A widening cone that falls short of the target.
        const reach = Math.min(1, 0.45 + progress * 0.35);
        for (let index = 0; index < 5; index += 1) {
          const at = ((index + 1) / 5) * reach;
          const spread = at * effect.size * 2.4;
          this.graphics
            .circle(
              effect.from.x + dx * at + nx * jitter(effect.seed + index) * spread,
              effect.from.y + dy * at + ny * jitter(effect.seed + index * 7) * spread,
              effect.size * (0.5 + at),
            )
            .fill({ color: effect.colour, alpha: (1 - progress) * 0.5 });
        }
        return;
      }

      case 'tracer': {
        const head = progress;
        const tail = Math.max(0, progress - 0.18);
        const offset = effect.drift * (1 - Math.abs(progress - 0.5) * 2) * 0.35;
        this.graphics
          .moveTo(effect.from.x + dx * tail + nx * offset, effect.from.y + dy * tail + ny * offset)
          .lineTo(effect.from.x + dx * head + nx * offset, effect.from.y + dy * head + ny * offset)
          .stroke({ width: effect.size, color: effect.colour, alpha: 0.95 });
        return;
      }

      case 'missile': {
        // Lob along a parabola, trailing smoke, fanning out from the launcher.
        const lift = Math.sin(progress * Math.PI) * effect.arc;
        const fan = effect.drift * Math.sin(progress * Math.PI);
        const x = effect.from.x + dx * progress + nx * fan;
        const y = effect.from.y + dy * progress + ny * fan - lift;

        const back = Math.max(0, progress - 0.14);
        const backLift = Math.sin(back * Math.PI) * effect.arc;
        const backFan = effect.drift * Math.sin(back * Math.PI);
        this.graphics
          .moveTo(effect.from.x + dx * back + nx * backFan, effect.from.y + dy * back + ny * backFan - backLift)
          .lineTo(x, y)
          .stroke({ width: effect.size * 0.7, color: UI.smoke, alpha: 0.4 });
        this.graphics.circle(x, y, effect.size).fill({ color: effect.colour, alpha: 0.95 });
        return;
      }

      case 'muzzle':
        this.graphics
          .circle(effect.from.x, effect.from.y, effect.size * (1 - progress))
          .fill({ color: effect.colour, alpha: (1 - progress) * 0.8 });
        return;

      case 'burst':
        this.graphics
          .circle(effect.from.x, effect.from.y, effect.size * (0.3 + progress))
          .stroke({ width: 2.5, color: effect.colour, alpha: 1 - progress });
        return;

      default:
        this.graphics
          .circle(effect.from.x, effect.from.y - progress * 18, effect.size * (0.5 + progress))
          .fill({ color: effect.colour, alpha: 0.28 * (1 - progress) });
    }
  }

  private push(effect: Effect): void {
    if (this.effects.length > MAX_EFFECTS) this.effects.shift();
    this.effects.push(effect);
  }
}
