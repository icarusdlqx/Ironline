import type { MissionObjective } from '../schema/mission';
import { emit } from './events';
import { isOperational, type World } from './types';
import { zoneById } from './zones';

export type ObjectiveStatus = 'active' | 'complete' | 'failed';

export interface ObjectiveState {
  id: string;
  label: string;
  type: MissionObjective['type'];
  team: number;
  required: boolean;
  zoneIds: string[];
  holdSeconds: number;
  resourcePoints: number;
  status: ObjectiveStatus;
  progress: number;
}

export function createObjectives(objectives: readonly MissionObjective[]): ObjectiveState[] {
  return objectives.map((objective) => ({
    id: objective.id,
    label: objective.label,
    type: objective.type,
    team: objective.team,
    required: objective.required,
    zoneIds: [...objective.zoneIds],
    holdSeconds: objective.holdSeconds,
    resourcePoints: objective.resourcePoints,
    status: 'active',
    progress: 0,
  }));
}

function teamHasOperational(world: World, team: number): boolean {
  return world.entities.some((entity) => entity.team === team && isOperational(entity));
}

function settle(world: World, objective: ObjectiveState, status: 'complete' | 'failed'): void {
  if (objective.status !== 'active') return;
  objective.status = status;

  if (status === 'complete' && objective.resourcePoints > 0) {
    world.resources.set(
      objective.team,
      (world.resources.get(objective.team) ?? 0) + objective.resourcePoints,
    );
  }

  emit(world.events, {
    type: 'objective_settled',
    tick: world.tick,
    objectiveId: objective.id,
    status,
  });
}

export function updateObjectives(world: World): void {
  for (const objective of world.objectives) {
    if (objective.status !== 'active') continue;

    const zones = objective.zoneIds.map((zoneId) => zoneById(world, zoneId));

    switch (objective.type) {
      case 'destroy_all': {
        const enemies = world.entities.filter(
          (entity) => entity.team !== objective.team && isOperational(entity),
        );
        objective.progress = enemies.length === 0 ? 1 : 0;
        if (enemies.length === 0) settle(world, objective, 'complete');
        break;
      }

      case 'capture_zones': {
        const held = zones.filter((zone) => zone?.owner === objective.team).length;
        objective.progress = zones.length === 0 ? 0 : held / zones.length;
        if (held === zones.length && zones.length > 0) settle(world, objective, 'complete');
        break;
      }

      case 'hold_zones': {
        const shortest = zones.reduce(
          (least, zone) =>
            zone?.owner === objective.team
              ? Math.min(least, zone.heldSeconds[objective.team] ?? 0)
              : 0,
          Number.POSITIVE_INFINITY,
        );
        const seconds = Number.isFinite(shortest) ? shortest : 0;
        objective.progress = Math.min(1, seconds / objective.holdSeconds);
        if (seconds >= objective.holdSeconds) settle(world, objective, 'complete');
        break;
      }

      case 'protect_zones': {
        const lost = zones.filter((zone) => zone !== null && zone.owner !== objective.team);
        objective.progress = zones.length === 0 ? 1 : 1 - lost.length / zones.length;
        if (lost.length > 0) settle(world, objective, 'failed');
        break;
      }

      case 'survive': {
        objective.progress = teamHasOperational(world, objective.team) ? 1 : 0;
        if (!teamHasOperational(world, objective.team)) settle(world, objective, 'failed');
        break;
      }
    }
  }
}

export interface MissionVerdict {
  status: 'active' | 'success' | 'failure';
  reason: string | null;
}

/** Sustained objectives are held rather than achieved — they can only ever fail. */
const SUSTAINED: readonly MissionObjective['type'][] = ['survive', 'protect_zones'];

/**
 * Required objectives decide the mission. Sustained ones never read as complete,
 * so success turns on the achievable objectives; if a mission has none of those,
 * surviving to the clock is the win.
 */
export function evaluateMission(world: World, playerTeam: number, timedOut: boolean): MissionVerdict {
  const required = world.objectives.filter((objective) => objective.required);

  if (required.some((objective) => objective.status === 'failed')) {
    return { status: 'failure', reason: 'a required objective failed' };
  }

  if (!teamHasOperational(world, playerTeam)) {
    return { status: 'failure', reason: 'the lance was destroyed' };
  }

  const achievable = required.filter((objective) => !SUSTAINED.includes(objective.type));

  if (achievable.length > 0 && achievable.every((objective) => objective.status === 'complete')) {
    return { status: 'success', reason: 'all objectives complete' };
  }

  if (!timedOut) return { status: 'active', reason: null };

  if (achievable.length === 0) {
    return { status: 'success', reason: 'the position was held to the clock' };
  }

  return { status: 'failure', reason: 'the mission clock ran out' };
}

export function objectiveById(world: World, id: string): ObjectiveState | null {
  return world.objectives.find((objective) => objective.id === id) ?? null;
}
