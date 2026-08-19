import { describe, expect, it } from 'vitest';
import { createWorld } from '../sim/world';
import { catalog } from '../../tests/support';
import { stoppedCount } from './objectiveReadout';

describe('destroy-all readout', () => {
  it('counts stopped combatants instead of repeating binary objective progress', () => {
    const world = createWorld(catalog, { missionId: 'skirmish_ridge', seed: 'objective-count' });
    const objective = world.objectives.find((entry) => entry.type === 'destroy_all');
    if (objective === undefined) throw new Error('mission has no destroy-all objective');
    const enemies = world.entities.filter((entity) => entity.team !== objective.team);
    const first = enemies[0];
    if (first === undefined) throw new Error('mission has no opposing combatant');

    expect(stoppedCount(world, objective)).toEqual({ stopped: 0, total: enemies.length });
    first.destroyed = true;
    expect(stoppedCount(world, objective)).toEqual({ stopped: 1, total: enemies.length });
  });

  it('leaves measured objectives on their authored progress', () => {
    const world = createWorld(catalog, { missionId: 'base_capture_ridge', seed: 'zone-count' });
    const objective = world.objectives.find((entry) => entry.type === 'capture_zones');
    if (objective === undefined) throw new Error('mission has no capture objective');

    expect(stoppedCount(world, objective)).toBeUndefined();
  });
});
