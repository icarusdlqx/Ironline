import { beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { eventsOfType } from './events';
import { callSupport, SUPPORT_CALLS, type SupportCallId } from './support';
import { isOperational, type MechEntity, type World } from './types';
import { createWorld, runBattle, stepWorld } from './world';
import { zoneById } from './zones';

const MISSION = 'base_capture_ridge';
const MAX_TICKS = 12_000;

function build(seed = 'mission'): World {
  return createWorld(catalog, { seed, missionId: MISSION, playerTeam: 0 });
}

function run(world: World, ticks: number): void {
  for (let tick = 0; tick < ticks && !world.finished; tick += 1) stepWorld(world, MAX_TICKS);
}

/** Pins everyone in place — delayed strikes otherwise land where a mech used to be. */
function freeze(active: World): void {
  for (const entity of active.entities) {
    entity.autopilot = false;
    entity.orders.move = null;
    entity.path = [];
    entity.pathIndex = 0;
    entity.motion = 'stationary';
  }
}

/** Teleports the player lance onto a zone so a capture can be observed directly. */
function occupy(world: World, zoneId: string, team: number): void {
  const zone = zoneById(world, zoneId);
  if (zone === null) throw new Error(`no zone ${zoneId}`);

  for (const entity of world.entities) {
    if (entity.team === team) entity.pos = { x: zone.x, y: zone.y };
    else entity.pos = { x: 24, y: 24 };
  }
}

let world: World;

beforeEach(() => {
  world = build();
});

describe('mission set-up', () => {
  it('loads zones, objectives and triggers from JSON', () => {
    expect(world.zones).toHaveLength(2);
    expect(world.objectives).toHaveLength(3);
    expect(world.triggers).toHaveLength(2);
    expect(world.reserves).toHaveLength(1);
  });

  it('starts both sides with the mission resource pool', () => {
    expect(world.resources.get(0)).toBe(900);
    expect(world.resources.get(1)).toBe(900);
  });

  it('starts every zone under the garrison', () => {
    expect(world.zones.every((zone) => zone.owner === 1)).toBe(true);
  });

  it('starts every objective active', () => {
    expect(world.objectives.every((objective) => objective.status === 'active')).toBe(true);
  });
});

describe('zone capture', () => {
  it('flips a zone after the capture timer and pays resource points', () => {
    occupy(world, 'south_post', 0);
    const before = world.resources.get(0) ?? 0;
    const zone = zoneById(world, 'south_post');

    run(world, Math.ceil((zone?.captureSeconds ?? 8) / world.dt) + 5);

    expect(zone?.owner).toBe(0);
    expect(world.resources.get(0) ?? 0).toBeGreaterThan(before);
    expect(eventsOfType(world.events, 'zone_captured').length).toBeGreaterThan(0);
  });

  it('does not flip while an enemy contests it', () => {
    const zone = zoneById(world, 'south_post');
    if (zone === null) return;

    for (const entity of world.entities) entity.pos = { x: zone.x, y: zone.y };
    run(world, 400);

    expect(zone.owner).toBe(1);
    expect(zone.contested).toBe(true);
  });

  it('needs presence, not a fly-past', () => {
    const zone = zoneById(world, 'south_post');
    if (zone === null) return;

    occupy(world, 'south_post', 0);
    run(world, 20);
    expect(zone.owner).toBe(1);
    expect(zone.progress).toBeGreaterThan(0);
  });
});

describe('objectives', () => {
  it('completes the capture objective once both posts are taken', () => {
    occupy(world, 'south_post', 0);
    run(world, 240);
    occupy(world, 'north_post', 0);
    run(world, 240);

    const objective = world.objectives.find((entry) => entry.id === 'take_posts');
    expect(objective?.status).toBe('complete');
  });

  it('ends the mission in success when the required objectives are met', () => {
    occupy(world, 'south_post', 0);
    run(world, 240);
    occupy(world, 'north_post', 0);
    run(world, 400);

    expect(world.missionStatus).toBe('success');
    expect(world.finished).toBe(true);
    expect(eventsOfType(world.events, 'mission_ended')[0]?.status).toBe('success');
  });

  it('fails the mission when the lance is wiped out', () => {
    for (const entity of world.entities) {
      if (entity.team === 0) entity.locations.centre_torso.destroyed = true;
      if (entity.team === 0) entity.destroyed = true;
    }
    run(world, 5);

    expect(world.missionStatus).toBe('failure');
    const survive = world.objectives.find((entry) => entry.id === 'lance_survives');
    expect(survive?.status).toBe('failed');
  });

  it('reports objectives on the battle result', () => {
    const result = runBattle(catalog, { seed: 'objectives', missionId: MISSION, playerTeam: 0 });
    expect(result.objectives).toHaveLength(3);
    expect(result.objectives.map((entry) => entry.id)).toContain('take_posts');
    expect(result.missionStatus === 'success' || result.missionStatus === 'failure').toBe(true);
  });
});

describe('triggers', () => {
  it('fires the timed opening message', () => {
    run(world, 60);
    expect(eventsOfType(world.events, 'mission_message').map((event) => event.text).join(' ')).toMatch(
      /garrisoned/,
    );
  });

  it('drops the relief lance when the south post falls', () => {
    const before = world.entities.filter((entity) => entity.team === 1).length;

    occupy(world, 'south_post', 0);
    run(world, 240);

    const after = world.entities.filter((entity) => entity.team === 1).length;
    expect(after, 'no reinforcements arrived').toBe(before + 2);
    expect(eventsOfType(world.events, 'trigger_fired').map((event) => event.triggerId)).toContain(
      'relief_lance',
    );
  });

  it('gives the reinforcements unique ids and enemy autopilot', () => {
    occupy(world, 'south_post', 0);
    run(world, 240);

    const ids = world.entities.map((entity) => entity.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      world.entities.filter((entity) => entity.team === 1).every((entity) => entity.autopilot),
    ).toBe(true);
  });

  it('only fires a once-trigger once', () => {
    occupy(world, 'south_post', 0);
    run(world, 600);

    const fired = eventsOfType(world.events, 'trigger_fired').filter(
      (event) => event.triggerId === 'relief_lance',
    );
    expect(fired).toHaveLength(1);
  });

  it('reveals the map region the trigger names', () => {
    occupy(world, 'south_post', 0);
    run(world, 240);
    expect(world.reveals.length).toBeGreaterThan(0);
  });
});

describe('support calls', () => {
  function target(): { x: number; y: number } {
    const enemy = world.entities.find((entity) => entity.team === 1);
    return enemy === undefined ? { x: 400, y: 400 } : { ...enemy.pos };
  }

  it('exposes all six calls with a cost', () => {
    expect(SUPPORT_CALLS).toHaveLength(6);
    for (const call of SUPPORT_CALLS) {
      expect(world.rules.support[call].cost).toBeGreaterThan(0);
    }
  });

  it('refuses a call the team cannot afford', () => {
    world.resources.set(0, 0);
    const result = callSupport(world, 0, 'artillery_strike', target());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/needs/);
  });

  it('refuses a target off the map', () => {
    expect(callSupport(world, 0, 'artillery_strike', { x: 99_999, y: 99_999 }).ok).toBe(false);
  });

  it('charges the cost up front', () => {
    const before = world.resources.get(0) ?? 0;
    callSupport(world, 0, 'artillery_strike', target());
    expect(world.resources.get(0)).toBe(before - world.rules.support.artillery_strike.cost);
  });

  it.each(SUPPORT_CALLS)('%s resolves after its delay', (call: SupportCallId) => {
    world.resources.set(0, 10_000);
    const result = callSupport(world, 0, call, target(), 0);
    expect(result.ok, result.reason ?? '').toBe(true);

    const delay = Math.ceil(world.rules.support[call].delaySeconds / world.dt) + 2;
    run(world, delay);

    const resolved = eventsOfType(world.events, 'support_resolved').map((event) => event.call);
    expect(resolved, `${call} never resolved`).toContain(call);
  });

  it('artillery damages an enemy under the impact point', () => {
    world.resources.set(0, 10_000);
    freeze(world);
    const enemy = world.entities.find((entity) => entity.team === 1) as MechEntity;
    const before = enemy.stats.damageTaken;

    callSupport(world, 0, 'artillery_strike', { ...enemy.pos });
    run(world, Math.ceil(world.rules.support.artillery_strike.delaySeconds / world.dt) + 3);

    expect(enemy.stats.damageTaken).toBeGreaterThan(before);
  });

  it('an air strike hits along its heading and spares the flank', () => {
    world.resources.set(0, 10_000);
    const enemy = world.entities.find((entity) => entity.team === 1) as MechEntity;
    const aside = world.entities.filter((entity) => entity.team === 1)[1];
    if (aside === undefined) return;

    freeze(world);
    enemy.pos = { x: 500, y: 400 };
    aside.pos = { x: 500, y: 700 };

    callSupport(world, 0, 'air_strike', { x: 500, y: 400 }, 0);
    run(world, Math.ceil(world.rules.support.air_strike.delaySeconds / world.dt) + 3);

    expect(enemy.stats.damageTaken).toBeGreaterThan(0);
    expect(aside.stats.damageTaken).toBe(0);
  });

  it('never damages the team that called it', () => {
    world.resources.set(0, 10_000);
    freeze(world);
    const friendly = world.entities.find((entity) => entity.team === 0) as MechEntity;
    callSupport(world, 0, 'artillery_strike', { ...friendly.pos });
    run(world, Math.ceil(world.rules.support.artillery_strike.delaySeconds / world.dt) + 3);

    expect(friendly.stats.damageTaken).toBe(0);
  });

  it('a repair truck puts armour back on a damaged friendly', () => {
    world.resources.set(0, 10_000);
    freeze(world);
    const friendly = world.entities.find((entity) => entity.team === 0) as MechEntity;
    friendly.locations.left_arm.armour = 1;

    callSupport(world, 0, 'repair_truck', { ...friendly.pos });
    run(world, Math.ceil(world.rules.support.repair_truck.delaySeconds / world.dt) + 60);

    expect(friendly.locations.left_arm.armour).toBeGreaterThan(1);
  });

  it('a minefield detonates on an enemy and spends a mine', () => {
    world.resources.set(0, 10_000);
    freeze(world);
    const enemy = world.entities.find((entity) => entity.team === 1) as MechEntity;

    callSupport(world, 0, 'minelayer', { ...enemy.pos });
    run(world, Math.ceil(world.rules.support.minelayer.delaySeconds / world.dt) + 4);

    expect(enemy.stats.damageTaken).toBeGreaterThan(0);
    const field = world.support.minefields[0];
    expect(field?.mines ?? world.rules.support.minelayer.mines).toBeLessThan(
      world.rules.support.minelayer.mines,
    );
  });

  it('a sensor probe reveals the ground it is called on', () => {
    world.resources.set(0, 10_000);
    callSupport(world, 0, 'sensor_probe', { x: 700, y: 300 });
    run(world, 3);
    expect(world.reveals.some((reveal) => reveal.x === 700)).toBe(true);
  });

  it('a reinforcement drops a reserve mech and empties the dropship', () => {
    world.resources.set(0, 10_000);
    const before = world.entities.filter((entity) => entity.team === 0).length;

    expect(callSupport(world, 0, 'reinforcement', { x: 200, y: 800 }).ok).toBe(true);
    run(world, Math.ceil(world.rules.support.reinforcement.delaySeconds / world.dt) + 3);

    expect(world.entities.filter((entity) => entity.team === 0).length).toBe(before + 1);
    expect(world.reserves).toHaveLength(0);
    expect(callSupport(world, 0, 'reinforcement', { x: 200, y: 800 }).reason).toMatch(/reserves/);
  });

  it('the reinforcement answers to the player, not the AI', () => {
    world.resources.set(0, 10_000);
    callSupport(world, 0, 'reinforcement', { x: 200, y: 800 });
    run(world, Math.ceil(world.rules.support.reinforcement.delaySeconds / world.dt) + 3);

    const dropped = world.entities[world.entities.length - 1];
    expect(dropped?.team).toBe(0);
    expect(dropped?.autopilot).toBe(false);
    expect(isOperational(dropped as MechEntity)).toBe(true);
  });
});

describe('delayed fire', () => {
  it('lands where the mech was, not where it went', () => {
    world.resources.set(0, 10_000);
    const enemy = world.entities.find((entity) => entity.team === 1) as MechEntity;
    const called = { ...enemy.pos };

    callSupport(world, 0, 'artillery_strike', called);
    run(world, Math.ceil(world.rules.support.artillery_strike.delaySeconds / world.dt) + 3);

    const moved = Math.hypot(enemy.pos.x - called.x, enemy.pos.y - called.y);
    const radius = world.rules.support.artillery_strike.radius;
    if (moved > radius * 2) expect(enemy.stats.damageTaken).toBe(0);
  });
});

describe('determinism with objectives', () => {
  it('replays identically for a given seed', () => {
    const first = runBattle(catalog, { seed: 'mission:9', missionId: MISSION, playerTeam: 0 });
    const second = runBattle(catalog, { seed: 'mission:9', missionId: MISSION, playerTeam: 0 });
    expect(first).toEqual(second);
  });
});
