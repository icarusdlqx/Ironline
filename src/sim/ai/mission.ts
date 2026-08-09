import { distance } from '../math';
import { isOperational, type EntityId, type World } from '../types';
import type { ZoneState } from '../zones';

/** Objective types that are won by standing somewhere rather than by shooting. */
const GROUND_OBJECTIVES = new Set(['capture_zones', 'hold_zones', 'protect_zones']);

/**
 * Which zones this side still has work to do on. A zone it does not own needs
 * taking; one it does own needs somebody left on it, or the enemy walks in
 * behind the lance and takes it back.
 */
function contestedZones(world: World, team: number): ZoneState[] {
  const wanted = new Set<string>();

  for (const objective of world.objectives) {
    if (objective.team !== team || objective.status !== 'active') continue;
    if (!GROUND_OBJECTIVES.has(objective.type)) continue;
    for (const zoneId of objective.zoneIds) wanted.add(zoneId);
  }

  return world.zones
    .filter((zone) => wanted.has(zone.id))
    .sort((a, b) => {
      // Take what is not yours before reinforcing what is.
      const mine = Number(a.owner === team) - Number(b.owner === team);
      return mine !== 0 ? mine : a.id.localeCompare(b.id);
    });
}

/**
 * Sends part of the lance to the ground the mission is actually scored on.
 * Without this the AI fights beautifully and loses every capture mission,
 * because nothing in the target scoring knows a patch of dirt is worth points.
 *
 * Enough mechs go to hold each zone and no more; whoever is left keeps fighting.
 */
export function assignZones(world: World, team: number): Map<EntityId, ZoneState> {
  const assignments = new Map<EntityId, ZoneState>();
  const zones = contestedZones(world, team);
  if (zones.length === 0) return assignments;

  const available = world.entities.filter(
    (entity) => entity.team === team && isOperational(entity) && !entity.ai.withdrawing,
  );
  if (available.length === 0) return assignments;

  // Never commit the whole lance to standing on objectives — something has to
  // be free to shoot back. Half, rounded up, split across the contested zones.
  const committed = Math.max(1, Math.ceil(available.length / 2));
  const perZone = Math.max(1, Math.floor(committed / zones.length));

  const taken = new Set<EntityId>();

  for (const zone of zones) {
    const nearest = available
      .filter((entity) => !taken.has(entity.id))
      .sort((a, b) => {
        const byRange =
          distance(a.pos, { x: zone.x, y: zone.y }) - distance(b.pos, { x: zone.x, y: zone.y });
        return byRange !== 0 ? byRange : a.id - b.id;
      })
      .slice(0, perZone);

    for (const entity of nearest) {
      assignments.set(entity.id, zone);
      taken.add(entity.id);
      if (taken.size >= committed) return assignments;
    }
  }

  return assignments;
}

/** True once the mech is far enough inside the zone to count toward holding it. */
export function insideZone(
  world: World,
  entityId: EntityId,
  zone: ZoneState,
): boolean {
  const entity = world.entities.find((candidate) => candidate.id === entityId);
  if (entity === undefined) return false;
  return distance(entity.pos, { x: zone.x, y: zone.y }) <= zone.radius * 0.75;
}
