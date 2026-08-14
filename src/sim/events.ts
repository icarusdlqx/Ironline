import type { MechLocation } from '../schema/common';
import type { AttackArc } from '../schema/rules';
import type { EntityId, KillMethod } from './types';

export type SimEvent =
  | { type: 'weapon_fired'; tick: number; shooterId: EntityId; targetId: EntityId; weaponId: string }
  | {
      type: 'projectile_hit';
      tick: number;
      shooterId: EntityId;
      targetId: EntityId;
      weaponId: string;
      location: MechLocation;
      damage: number;
      /** Which side of the target the shot came in on. */
      arc: AttackArc;
    }
  | {
      type: 'projectile_miss';
      tick: number;
      shooterId: EntityId;
      targetId: EntityId;
      weaponId: string;
    }
  | { type: 'location_destroyed'; tick: number; entityId: EntityId; location: MechLocation }
  | {
      /** A shot that got past the plate and found something behind it. */
      type: 'critical_hit';
      tick: number;
      entityId: EntityId;
      shooterId: EntityId | null;
      location: MechLocation;
      /** What it wrecked, or null when the crit was only the harder hit. */
      component: string | null;
    }
  | {
      type: 'ammo_explosion';
      tick: number;
      entityId: EntityId;
      location: MechLocation;
      damage: number;
    }
  | { type: 'shutdown'; tick: number; entityId: EntityId; forced: boolean }
  | { type: 'restart'; tick: number; entityId: EntityId }
  | { type: 'staggered'; tick: number; entityId: EntityId }
  | { type: 'knocked_down'; tick: number; entityId: EntityId; attackerId: EntityId | null }
  | { type: 'stood_up'; tick: number; entityId: EntityId }
  | { type: 'pilot_injured'; tick: number; entityId: EntityId; wounds: number }
  | { type: 'jump_started'; tick: number; entityId: EntityId; x: number; y: number }
  | { type: 'jump_landed'; tick: number; entityId: EntityId; x: number; y: number }
  | { type: 'pilot_ejected'; tick: number; entityId: EntityId }
  | { type: 'mech_destroyed'; tick: number; entityId: EntityId; method: KillMethod }
  | { type: 'battle_ended'; tick: number; winner: number | null }
  | {
      type: 'zone_captured';
      tick: number;
      zoneId: string;
      team: number;
      previousOwner: number | null;
      resourcePoints: number;
    }
  | {
      type: 'objective_settled';
      tick: number;
      objectiveId: string;
      status: 'complete' | 'failed';
    }
  | { type: 'unit_withdrew'; tick: number; entityId: EntityId; team: number }
  | { type: 'trigger_fired'; tick: number; triggerId: string }
  | { type: 'mission_message'; tick: number; text: string }
  | { type: 'unit_spawned'; tick: number; entityId: EntityId; team: number; name: string }
  | {
      type: 'support_called';
      tick: number;
      team: number;
      call: string;
      x: number;
      y: number;
      cost: number;
    }
  | {
      type: 'support_resolved';
      tick: number;
      team: number;
      call: string;
      x: number;
      y: number;
    }
  | {
      type: 'mission_ended';
      tick: number;
      status: 'success' | 'failure';
      reason: string;
    };

export type SimEventType = SimEvent['type'];

export function emit(events: SimEvent[], event: SimEvent): void {
  events.push(event);
}

export function eventsOfType<T extends SimEventType>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
}
