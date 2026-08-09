import type { MissionTrigger, TriggerEffect } from '../schema/mission';
import { createMech } from './entity';
import { emit, eventsOfType } from './events';
import { objectiveById } from './objectives';
import { isOperational, type MechEntity, type World } from './types';
import { zoneById } from './zones';

export interface TriggerState {
  id: string;
  definition: MissionTrigger;
  fired: number;
}

export function createTriggers(triggers: readonly MissionTrigger[]): TriggerState[] {
  return triggers.map((definition) => ({ id: definition.id, definition, fired: 0 }));
}

function losses(world: World, team: number): number {
  return world.entities.filter((entity) => entity.team === team && !isOperational(entity)).length;
}

function conditionMet(world: World, trigger: TriggerState): boolean {
  const when = trigger.definition.when;

  switch (when.type) {
    case 'elapsed':
      return world.tick * world.dt >= when.seconds;

    case 'zone_captured': {
      const zone = zoneById(world, when.zoneId);
      return zone !== null && zone.owner === when.team;
    }

    case 'objective_complete': {
      const objective = objectiveById(world, when.objectiveId);
      return objective !== null && objective.status === 'complete';
    }

    case 'team_losses':
      return losses(world, when.team) >= when.count;
  }
}

export function nextEntityId(world: World): number {
  return world.entities.reduce((highest, entity) => Math.max(highest, entity.id), 0) + 1;
}

export function spawnUnits(
  world: World,
  team: number,
  units: readonly {
    designId: string;
    pilotId: string;
    spawn: { x: number; y: number };
    facingDegrees: number;
  }[],
): MechEntity[] {
  const spawned: MechEntity[] = [];
  let nextId = nextEntityId(world);

  for (const unit of units) {
    const mech = createMech(world.catalog, world.rules, {
      id: nextId,
      team,
      designId: unit.designId,
      pilotId: unit.pilotId,
      spawn: unit.spawn,
      facingDegrees: unit.facingDegrees,
      autopilot: team !== world.playerTeam,
    });
    nextId += 1;
    world.entities.push(mech);
    spawned.push(mech);
    emit(world.events, {
      type: 'unit_spawned',
      tick: world.tick,
      entityId: mech.id,
      team,
      name: mech.name,
    });
  }

  return spawned;
}

export function applyEffect(world: World, effect: TriggerEffect): void {
  switch (effect.type) {
    case 'spawn':
      spawnUnits(world, effect.team, effect.units);
      break;

    case 'award_resource_points':
      world.resources.set(
        effect.team,
        Math.max(0, (world.resources.get(effect.team) ?? 0) + effect.amount),
      );
      break;

    case 'message':
      emit(world.events, { type: 'mission_message', tick: world.tick, text: effect.text });
      break;

    case 'reveal':
      world.reveals.push({
        // Scripted intel is handed to the side the mission is written for
        // unless it names another; in a headless run that is team zero.
        team: effect.team ?? world.playerTeam ?? 0,
        x: effect.x,
        y: effect.y,
        radius: effect.radius,
        expiresTick: world.tick + Math.round(effect.seconds / world.dt),
      });
      break;
  }
}

export function updateTriggers(world: World): void {
  for (const trigger of world.triggers) {
    if (trigger.definition.once && trigger.fired > 0) continue;
    if (!conditionMet(world, trigger)) continue;

    trigger.fired += 1;
    emit(world.events, { type: 'trigger_fired', tick: world.tick, triggerId: trigger.id });

    for (const effect of trigger.definition.effects) applyEffect(world, effect);
  }
}

export function firedTriggerIds(world: World): string[] {
  return eventsOfType(world.events, 'trigger_fired').map((event) => event.triggerId);
}
