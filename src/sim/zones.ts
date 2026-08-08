import type { MissionZone } from '../schema/mission';
import { emit } from './events';
import { distance } from './math';
import { isOperational, type World } from './types';

export interface ZoneState {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  owner: number | null;
  captureSeconds: number;
  resourcePoints: number;
  /** Team currently making progress, and how far along they are in seconds. */
  contender: number | null;
  progress: number;
  contested: boolean;
  heldSeconds: Record<number, number>;
}

export function createZones(zones: readonly MissionZone[]): ZoneState[] {
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    x: zone.x,
    y: zone.y,
    radius: zone.radius,
    owner: zone.owner,
    captureSeconds: zone.captureSeconds,
    resourcePoints: zone.resourcePoints,
    contender: null,
    progress: 0,
    contested: false,
    heldSeconds: {},
  }));
}

function occupants(world: World, zone: ZoneState): Map<number, number> {
  const counts = new Map<number, number>();
  for (const entity of world.entities) {
    if (!isOperational(entity)) continue;
    if (distance(entity.pos, { x: zone.x, y: zone.y }) > zone.radius) continue;
    counts.set(entity.team, (counts.get(entity.team) ?? 0) + 1);
  }
  return counts;
}

/**
 * A zone falls to whichever side stands in it alone for long enough. Any enemy
 * inside contests it and freezes progress where it is.
 */
export function updateZones(world: World): void {
  for (const zone of world.zones) {
    const counts = occupants(world, zone);
    const teams = [...counts.keys()].sort((a, b) => a - b);

    zone.contested = teams.length > 1;

    if (zone.owner !== null) {
      const held = zone.heldSeconds[zone.owner] ?? 0;
      const ownerPresent = (counts.get(zone.owner) ?? 0) > 0;
      if (!zone.contested && (ownerPresent || teams.length === 0)) {
        zone.heldSeconds[zone.owner] = held + world.dt;
      }
    }

    if (zone.contested || teams.length === 0) {
      zone.contender = zone.contested ? zone.contender : null;
      if (teams.length === 0) zone.progress = Math.max(0, zone.progress - world.dt);
      continue;
    }

    const claimant = teams[0];
    if (claimant === undefined || claimant === zone.owner) {
      zone.contender = null;
      zone.progress = 0;
      continue;
    }

    if (zone.contender !== claimant) {
      zone.contender = claimant;
      zone.progress = 0;
    }

    zone.progress += world.dt;
    if (zone.progress < zone.captureSeconds) continue;

    const previous = zone.owner;
    zone.owner = claimant;
    zone.progress = 0;
    zone.contender = null;
    zone.heldSeconds[claimant] = 0;

    world.resources.set(claimant, (world.resources.get(claimant) ?? 0) + zone.resourcePoints);

    emit(world.events, {
      type: 'zone_captured',
      tick: world.tick,
      zoneId: zone.id,
      team: claimant,
      previousOwner: previous,
      resourcePoints: zone.resourcePoints,
    });
  }
}

export function zoneById(world: World, zoneId: string): ZoneState | null {
  return world.zones.find((zone) => zone.id === zoneId) ?? null;
}

export function zonesOwnedBy(world: World, team: number): ZoneState[] {
  return world.zones.filter((zone) => zone.owner === team);
}
