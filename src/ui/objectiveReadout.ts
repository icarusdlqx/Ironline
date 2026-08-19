import type { ObjectiveState } from '../sim/objectives';
import { isOperational, type World } from '../sim/types';

export interface StoppedCount {
  stopped: number;
  total: number;
}

/** Counts known combatants without exposing their position or sensor state. */
export function stoppedCount(
  world: World,
  objective: ObjectiveState,
): StoppedCount | undefined {
  if (objective.type !== 'destroy_all') return undefined;
  const enemies = world.entities.filter((entity) => entity.team !== objective.team);
  return {
    stopped: enemies.filter((entity) => !isOperational(entity)).length,
    total: enemies.length,
  };
}
