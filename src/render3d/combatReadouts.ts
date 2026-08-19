import { Vector3 } from 'three';
import type { MechLocation } from '../schema/common';
import type { SimEvent } from '../sim/events';
import { tileExplored } from '../sim/sensors';
import type { Vec2, World } from '../sim/types';
import { DamageLedger, type DamageSplit } from './damageLedger';
import { DamageReadoutPool } from './damageReadouts';
import type { ReadoutLayout } from './readoutSafeArea';

type LocationOf = (id: number, location: MechLocation, out: Vector3) => boolean;
type Project = (at: Vector3) => Vec2;

interface RoutineCue {
  tick: number;
  targetId: number;
  armour: number;
  structure: number;
  misses: number;
}

function destroyedLocation(event: Extract<SimEvent, { type: 'mech_destroyed' }>): MechLocation {
  return event.method === 'head' ? 'head' : 'centre_torso';
}

function hasReadout(event: SimEvent): boolean {
  return (
    event.type === 'projectile_hit' ||
    event.type === 'projectile_miss' ||
    event.type === 'critical_hit' ||
    event.type === 'location_destroyed' ||
    event.type === 'ammo_explosion' ||
    event.type === 'mech_destroyed'
  );
}

export function canPresentEntity(world: World, id: number): boolean {
  const entity = world.entities.find((candidate) => candidate.id === id);
  if (entity === undefined) return false;
  const vision = world.vision;
  if (vision === null || entity.team === vision.team || vision.visible.has(id)) return true;
  if (!entity.destroyed) return false;
  const tile = world.terrain.toTile(entity.pos);
  return tileExplored(vision, tile.row * world.terrain.width + tile.column);
}

/** Converts projectile traffic into one target summary while keeping consequences explicit. */
export class CombatReadouts {
  private readonly ledger: DamageLedger;
  private readonly pool: DamageReadoutPool;
  private readonly at = new Vector3();
  private readonly split: DamageSplit = { armour: 0, structure: 0, known: false };
  private readonly routineCues: RoutineCue[] = [];
  private routineCount = 0;

  constructor(
    host: HTMLElement,
    world: World,
    reducedMotion: boolean,
    private readonly locationOf: LocationOf,
    private readonly project: Project,
    dom?: Pick<Document, 'createElement'>,
    layoutOf: (() => ReadoutLayout) | null = null,
  ) {
    this.ledger = new DamageLedger(world);
    this.pool = new DamageReadoutPool(host, reducedMotion, undefined, dom, layoutOf);
  }

  consume(world: World, events: readonly SimEvent[]): void {
    if (events.some(hasReadout)) this.pool.refreshLayout();
    this.routineCount = 0;
    for (const event of events) {
      if (event.type === 'projectile_hit') {
        const split = this.ledger.classify(world, event, this.split);
        this.accumulateRoutine(
          event.tick,
          event.targetId,
          split.known ? split.armour : event.damage,
          split.known ? split.structure : 0,
          0,
        );
      } else if (event.type === 'projectile_miss') {
        this.accumulateRoutine(event.tick, event.targetId, 0, 0, 1);
      } else if (event.type === 'critical_hit') {
        this.offer(world, event.tick, event.entityId, event.location, {
          critical: event.component ?? '',
        });
      } else if (event.type === 'location_destroyed') {
        this.offer(world, event.tick, event.entityId, event.location, { locationLost: true });
      } else if (event.type === 'ammo_explosion') {
        this.offer(world, event.tick, event.entityId, event.location, { ammo: event.damage });
      } else if (event.type === 'mech_destroyed') {
        const location = destroyedLocation(event);
        this.offer(world, event.tick, event.entityId, location, { destroyed: true });
      }
    }
    for (let index = 0; index < this.routineCount; index += 1) {
      const cue = this.routineCues[index];
      if (cue === undefined) continue;
      this.offer(world, cue.tick, cue.targetId, null, {
        armour: cue.armour,
        structure: cue.structure,
        misses: cue.misses,
      });
    }
    this.ledger.sync(world);
  }

  advance(deltaSeconds: number): void {
    this.pool.advance(deltaSeconds);
  }

  destroy(): void {
    this.pool.destroy();
  }

  private offer(
    world: World,
    tick: number,
    targetId: number,
    keyLocation: MechLocation | null,
    cue: {
      armour?: number;
      structure?: number;
      misses?: number;
      critical?: string;
      locationLost?: boolean;
      ammo?: number;
      destroyed?: boolean;
    },
    anchorLocation: MechLocation = 'centre_torso',
  ): void {
    if (!canPresentEntity(world, targetId)) return;
    if (!this.locationOf(targetId, anchorLocation, this.at)) return;
    this.pool.offer({
      tick,
      targetId,
      location: keyLocation,
      screen: this.project(this.at),
      ...cue,
    });
  }

  private accumulateRoutine(
    tick: number,
    targetId: number,
    armour: number,
    structure: number,
    misses: number,
  ): void {
    let cue: RoutineCue | undefined;
    for (let index = 0; index < this.routineCount; index += 1) {
      const candidate = this.routineCues[index];
      if (candidate?.tick === tick && candidate.targetId === targetId) {
        cue = candidate;
        break;
      }
    }
    if (cue === undefined) {
      cue = this.routineCues[this.routineCount];
      if (cue === undefined) {
        cue = { tick, targetId, armour: 0, structure: 0, misses: 0 };
        this.routineCues.push(cue);
      } else {
        cue.tick = tick;
        cue.targetId = targetId;
        cue.armour = 0;
        cue.structure = 0;
        cue.misses = 0;
      }
      this.routineCount += 1;
    }
    cue.armour += armour;
    cue.structure += structure;
    cue.misses += misses;
  }
}
