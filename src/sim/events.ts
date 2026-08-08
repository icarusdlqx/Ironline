import type { MechLocation } from '../schema/common';
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
      type: 'ammo_explosion';
      tick: number;
      entityId: EntityId;
      location: MechLocation;
      damage: number;
    }
  | { type: 'shutdown'; tick: number; entityId: EntityId; forced: boolean }
  | { type: 'restart'; tick: number; entityId: EntityId }
  | { type: 'pilot_ejected'; tick: number; entityId: EntityId }
  | { type: 'mech_destroyed'; tick: number; entityId: EntityId; method: KillMethod }
  | { type: 'battle_ended'; tick: number; winner: number | null };

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
