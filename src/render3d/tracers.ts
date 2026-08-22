import { Group, Vector3 } from 'three';
import type { Weapon } from '../schema/weapon';
import type { Vec2 } from '../sim/types';
import { disposeObjectResources } from './sceneResources';
import { ShotBurstPool, type ShotBurstKind } from './shotBurstPool';
import {
  InstantShotPool,
  ProjectileShotPool,
  SmokeShotPool,
} from './shotPools';
import type { ShotPoolSnapshot } from './shotPoolCore';

export type { ShotBurstKind };

export type TracerPoolFamily =
  | 'beam'
  | 'pulse'
  | 'bolt'
  | 'flame'
  | 'shell'
  | 'slug'
  | 'missile'
  | 'burst'
  | 'smoke';

export interface TracerPoolStats {
  readonly capacity: number;
  readonly active: number;
  readonly families: Readonly<Record<TracerPoolFamily, ShotPoolSnapshot>>;
}

const IMPACT_HEIGHT = 14;
const DEFAULT_PROJECTILE_SPEED = 620;
const BEAM_LIFE = 0.22;
const FLASH_LIFE = 0.3;

const CAPACITY = Object.freeze({
  beam: 20,
  pulse: 12,
  bolt: 12,
  flame: 12,
  shell: 64,
  slug: 48,
  missile: 64,
  burst: 48,
  smoke: 24,
});

/** Authored style survives the catalogue while all hot-path storage stays fixed. */
export class TracerLayer {
  readonly group = new Group();
  private readonly beam = new InstantShotPool('beam', CAPACITY.beam, 1);
  private readonly pulse = new InstantShotPool('pulse', CAPACITY.pulse, 5);
  private readonly bolt = new InstantShotPool('bolt', CAPACITY.bolt, 9);
  private readonly flame = new InstantShotPool('flame', CAPACITY.flame, 8);
  private readonly shell = new ProjectileShotPool('shell', 'tracer', CAPACITY.shell);
  private readonly slug = new ProjectileShotPool('slug', 'slug', CAPACITY.slug);
  private readonly missile = new ProjectileShotPool('missile', 'missile', CAPACITY.missile);
  private readonly bursts = new ShotBurstPool(CAPACITY.burst);
  private readonly smoke = new SmokeShotPool(CAPACITY.smoke);
  private lowFx = false;
  private reducedMotion = false;
  private disposed = false;

  constructor() {
    this.group.add(
      this.bursts.mesh,
      this.beam.mesh,
      this.pulse.mesh,
      this.bolt.mesh,
      this.flame.mesh,
      this.shell.mesh,
      this.slug.mesh,
      this.missile.mesh,
      this.smoke.mesh,
    );
  }

  setPresentationMode(lowFx: boolean, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.lowFx = lowFx;
    this.reducedMotion = reducedMotion;
  }

  fire(
    from: Vector3,
    to: Vec2,
    visual: Weapon['visual'],
    projectiles: number,
    velocity: number | null,
    colour: number,
    heightAt: (x: number, y: number) => number,
  ): void {
    if (this.disposed) return;
    const endY = heightAt(to.x, to.y) + IMPACT_HEIGHT;
    const lifeScale = this.lifeScale();
    const detailScale = this.detailScale();
    if (!this.lowFx && !this.reducedMotion) {
      this.bursts.muzzle(
        from,
        colour,
        Math.max(0.55, visual.width * 0.34),
        lifeScale,
        detailScale,
      );
    }

    if (visual.style === 'beam') {
      this.beam.spawn(from, to.x, endY, to.y, colour, visual.width, BEAM_LIFE * lifeScale, 1);
      return;
    }
    if (visual.style === 'pulse') {
      this.pulse.spawn(
        from, to.x, endY, to.y, colour, visual.width,
        BEAM_LIFE * 1.35 * lifeScale, detailScale,
      );
      return;
    }
    if (visual.style === 'bolt') {
      this.bolt.spawn(
        from, to.x, endY, to.y, colour, visual.width,
        BEAM_LIFE * 1.15 * lifeScale, detailScale,
      );
      return;
    }
    if (visual.style === 'flame') {
      this.flame.spawn(
        from, to.x, endY, to.y, colour, visual.width,
        FLASH_LIFE * lifeScale, detailScale,
      );
      return;
    }

    const authoredRounds = roundCount(visual.style, projectiles);
    const shownRounds = this.lowFx
      ? 1
      : this.reducedMotion
        ? Math.min(2, authoredRounds)
        : authoredRounds;
    const pool = visual.style === 'missile'
      ? this.missile
      : visual.style === 'slug'
        ? this.slug
        : this.shell;
    for (let shot = 0; shot < shownRounds; shot += 1) {
      const spread = shownRounds === 1 ? 0 : (shot / (shownRounds - 1) - 0.5) * 18;
      const arc = visual.arc + (visual.style === 'missile' ? shot * Math.min(4, visual.width) : 0);
      pool.spawn(
        from,
        to.x + spread,
        endY,
        to.y + spread * (shot % 2 === 0 ? 0.6 : -0.6),
        arc,
        velocity ?? DEFAULT_PROJECTILE_SPEED,
        visual.width,
        colour,
      );
    }
  }

  impact(at: Vec2, ground: number, colour: number): void {
    this.burst(at, ground, 'hit', colour, 1);
  }

  burst(
    at: Vec2,
    ground: number,
    kind: ShotBurstKind,
    colour: number,
    scale = 1,
  ): void {
    if (this.disposed) return;
    this.bursts.spawn(
      at,
      ground,
      kind,
      colour,
      scale,
      this.lifeScale(),
      this.detailScale(),
    );
  }

  spawnSmoke(at: Vec2, ground: number): void {
    if (this.disposed) return;
    this.smoke.spawn(at, ground, this.lifeScale());
  }

  update(deltaSeconds: number): void {
    if (this.disposed) return;
    this.beam.update(deltaSeconds);
    this.pulse.update(deltaSeconds);
    this.bolt.update(deltaSeconds);
    this.flame.update(deltaSeconds);
    this.shell.update(deltaSeconds);
    this.slug.update(deltaSeconds);
    this.missile.update(deltaSeconds);
    this.bursts.update(deltaSeconds);
    this.smoke.update(deltaSeconds);
  }

  stats(): TracerPoolStats {
    const families = {
      beam: this.beam.snapshot(),
      pulse: this.pulse.snapshot(),
      bolt: this.bolt.snapshot(),
      flame: this.flame.snapshot(),
      shell: this.shell.snapshot(),
      slug: this.slug.snapshot(),
      missile: this.missile.snapshot(),
      burst: this.bursts.snapshot(),
      smoke: this.smoke.snapshot(),
    };
    let capacity = 0;
    let active = 0;
    for (const family of Object.values(families)) {
      capacity += family.capacity;
      active += family.active;
    }
    return { capacity, active, families };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.beam.clear();
    this.pulse.clear();
    this.bolt.clear();
    this.flame.clear();
    this.shell.clear();
    this.slug.clear();
    this.missile.clear();
    this.bursts.clear();
    this.smoke.clear();
    disposeObjectResources(this.group);
    this.group.clear();
  }

  private detailScale(): number {
    if (this.lowFx) return 0.34;
    if (this.reducedMotion) return 0.55;
    return 1;
  }

  private lifeScale(): number {
    if (this.lowFx) return 0.6;
    if (this.reducedMotion) return 0.75;
    return 1;
  }
}

function roundCount(style: Weapon['visual']['style'], projectiles: number): number {
  if (style === 'missile' || style === 'burst') return Math.max(1, Math.min(6, projectiles));
  if (style === 'tracer' && projectiles > 1) return Math.min(6, projectiles);
  return 1;
}
