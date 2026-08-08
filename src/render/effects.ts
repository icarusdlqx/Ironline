import { Graphics } from 'pixi.js';
import type { SimEvent } from '../sim/events';
import type { Vec2 } from '../sim/types';
import { UI } from './palette';

type EffectKind = 'beam' | 'tracer' | 'missile' | 'burst' | 'smoke';

interface Effect {
  kind: EffectKind;
  from: Vec2;
  to: Vec2;
  age: number;
  life: number;
  colour: number;
  size: number;
}

const BEAM_LIFE = 0.22;
const BURST_LIFE = 0.55;
const SMOKE_LIFE = 1.6;

export class EffectLayer {
  readonly graphics = new Graphics();
  private effects: Effect[] = [];

  spawnFromEvents(
    events: readonly SimEvent[],
    positionOf: (id: number) => Vec2 | null,
    weaponType: (weaponId: string) => 'energy' | 'ballistic' | 'missile' | null,
    travelSeconds: (weaponId: string, from: Vec2, to: Vec2) => number,
  ): void {
    for (const event of events) {
      if (event.type === 'weapon_fired') {
        const from = positionOf(event.shooterId);
        const to = positionOf(event.targetId);
        if (from === null || to === null) continue;

        const type = weaponType(event.weaponId);
        if (type === 'energy') {
          this.push({
            kind: 'beam',
            from,
            to,
            age: 0,
            life: BEAM_LIFE,
            colour: UI.beamEnergy,
            size: 2.5,
          });
        } else {
          this.push({
            kind: type === 'missile' ? 'missile' : 'tracer',
            from,
            to,
            age: 0,
            life: Math.max(0.08, travelSeconds(event.weaponId, from, to)),
            colour: type === 'missile' ? UI.missile : UI.tracerBallistic,
            size: type === 'missile' ? 2.5 : 2,
          });
        }
        continue;
      }

      if (event.type === 'projectile_hit') {
        const at = positionOf(event.targetId);
        if (at === null) continue;
        this.push({
          kind: 'burst',
          from: at,
          to: at,
          age: 0,
          life: 0.28,
          colour: UI.explosion,
          size: 4 + Math.min(14, event.damage),
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
        });
        this.push({
          kind: 'smoke',
          from: at,
          to: at,
          age: 0,
          life: SMOKE_LIFE,
          colour: UI.smoke,
          size: 26,
        });
      }
    }
  }

  spawnSmoke(at: Vec2): void {
    this.push({
      kind: 'smoke',
      from: at,
      to: at,
      age: 0,
      life: SMOKE_LIFE,
      colour: UI.smoke,
      size: 14,
    });
  }

  update(deltaSeconds: number): void {
    for (const effect of this.effects) effect.age += deltaSeconds;
    this.effects = this.effects.filter((effect) => effect.age < effect.life);
  }

  draw(): void {
    this.graphics.clear();

    for (const effect of this.effects) {
      const progress = Math.min(1, effect.age / effect.life);

      if (effect.kind === 'beam') {
        this.graphics
          .moveTo(effect.from.x, effect.from.y)
          .lineTo(effect.to.x, effect.to.y)
          .stroke({ width: effect.size * (1 - progress), color: effect.colour, alpha: 1 - progress });
        continue;
      }

      if (effect.kind === 'tracer' || effect.kind === 'missile') {
        const headX = effect.from.x + (effect.to.x - effect.from.x) * progress;
        const headY = effect.from.y + (effect.to.y - effect.from.y) * progress;
        const tail = Math.max(0, progress - 0.12);
        const tailX = effect.from.x + (effect.to.x - effect.from.x) * tail;
        const tailY = effect.from.y + (effect.to.y - effect.from.y) * tail;

        if (effect.kind === 'missile') {
          const arc = Math.sin(progress * Math.PI) * 10;
          this.graphics
            .circle(headX, headY - arc, effect.size)
            .fill({ color: effect.colour, alpha: 0.95 });
        } else {
          this.graphics
            .moveTo(tailX, tailY)
            .lineTo(headX, headY)
            .stroke({ width: effect.size, color: effect.colour, alpha: 0.95 });
        }
        continue;
      }

      if (effect.kind === 'burst') {
        this.graphics
          .circle(effect.from.x, effect.from.y, effect.size * (0.3 + progress))
          .stroke({ width: 2.5, color: effect.colour, alpha: 1 - progress });
        continue;
      }

      this.graphics
        .circle(effect.from.x, effect.from.y - progress * 18, effect.size * (0.5 + progress))
        .fill({ color: effect.colour, alpha: 0.28 * (1 - progress) });
    }
  }

  get count(): number {
    return this.effects.length;
  }

  private push(effect: Effect): void {
    if (this.effects.length > 400) this.effects.shift();
    this.effects.push(effect);
  }
}
