import { describe, expect, it } from 'vitest';
import { catalog, spawnDesign } from '../../tests/support';
import { LOCATIONS } from '../schema/common';
import { createMech } from './entity';
import { isOperational } from './types';
import { createWorld, runBattle, stepWorld } from './world';

describe('createMech', () => {
  const world = createWorld(catalog, { seed: 'entity', missionId: 'skirmish_ridge' });

  it('builds locations from the design armour and the chassis internals', () => {
    const design = catalog.designs.get('sentinel_brawler');
    const chassis = catalog.chassis.get('sentinel_snl2');
    expect(design).toBeDefined();
    expect(chassis).toBeDefined();

    const mech = createMech(catalog, catalog.rules, {
      id: 99,
      team: 0,
      designId: 'sentinel_brawler',
      pilotId: 'kessa_vale',
      spawn: { x: 100, y: 100 },
      facingDegrees: 0,
    });

    for (const location of LOCATIONS) {
      expect(mech.locations[location].armour).toBe(design?.armour[location]);
      expect(mech.locations[location].internal).toBe(chassis?.internals[location]);
      expect(mech.locations[location].destroyed).toBe(false);
    }
  });

  it('fills ammo bins from tonnage and rounds per ton', () => {
    const mech = createMech(catalog, catalog.rules, {
      id: 98,
      team: 0,
      designId: 'rampart_breaker',
      pilotId: 'dorn_hess',
      spawn: { x: 100, y: 100 },
      facingDegrees: 0,
    });

    const gauss = mech.ammoBins.find((bin) => bin.weaponId === 'gauss_rifle');
    const load = catalog.designs
      .get('rampart_breaker')
      ?.ammo.find((entry) => entry.weaponId === 'gauss_rifle');
    const perTon = catalog.weapons.get('gauss_rifle')?.ammoPerTon ?? 0;

    expect(gauss?.rounds).toBe((load?.tons ?? 0) * perTon);
    expect(gauss?.protectedByCase).toBe(true);
  });

  it('derives speed from engine rating and tonnage', () => {
    const mech = createMech(catalog, catalog.rules, {
      id: 97,
      team: 0,
      designId: 'wisp_scout',
      pilotId: 'marek_sud',
      spawn: { x: 100, y: 100 },
      facingDegrees: 0,
    });

    const chassis = catalog.chassis.get('wisp_wsp1');
    const expected =
      ((chassis?.engineRating ?? 0) / (chassis?.tonnage ?? 1)) *
      catalog.rules.movement.walkSpeedFactor;

    expect(mech.walkSpeed).toBeCloseTo(expected, 6);
    expect(mech.runSpeed).toBeCloseTo(expected * catalog.rules.movement.runMultiplier, 6);
  });

  it('gives lighter mechs a faster turn rate', () => {
    const light = spawnDesign(world, 'wisp_scout');
    const heavy = spawnDesign(world, 'colossus_siege');
    expect(light.turnRate).toBeGreaterThan(heavy.turnRate);
  });

  it('spreads walking speed across the weight classes', () => {
    const speeds = ['wisp_scout', 'sentinel_sniper', 'warden_lancer', 'colossus_siege'].map(
      (designId) => spawnDesign(world, designId).walkSpeed,
    );
    // §3.3 wants a real spread: a scout should roughly triple an assault's pace.
    for (let index = 1; index < speeds.length; index += 1) {
      expect(speeds[index] ?? 0).toBeLessThan(speeds[index - 1] ?? 0);
    }
    expect((speeds[0] ?? 0) / (speeds[speeds.length - 1] ?? 1)).toBeGreaterThan(2.5);
  });

  it('rejects unknown content', () => {
    expect(() =>
      createMech(catalog, catalog.rules, {
        id: 96,
        team: 0,
        designId: 'no_such_design',
        pilotId: 'kessa_vale',
        spawn: { x: 0, y: 0 },
        facingDegrees: 0,
      }),
    ).toThrow(/unknown design/);
  });
});

describe('createWorld', () => {
  it('deploys every unit in the mission', () => {
    const world = createWorld(catalog, { seed: 'deploy', missionId: 'skirmish_ridge' });
    const expected = world.mission.lances.reduce((total, lance) => total + lance.units.length, 0);

    expect(world.entities).toHaveLength(expected);
    expect(new Set(world.entities.map((entity) => entity.id)).size).toBe(expected);
    expect(new Set(world.entities.map((entity) => entity.team)).size).toBe(2);
  });

  it('runs at the tick rate from the rules', () => {
    const world = createWorld(catalog, { seed: 'tickrate', missionId: 'skirmish_ridge' });
    expect(world.dt).toBeCloseTo(1 / catalog.rules.simulation.tickRate, 10);
  });

  it('rejects an unknown mission', () => {
    expect(() => createWorld(catalog, { seed: 'x', missionId: 'nope' })).toThrow(/unknown mission/);
  });
});

describe('stepWorld', () => {
  it('advances the tick and stops once the battle is decided', () => {
    const world = createWorld(catalog, { seed: 'step', missionId: 'skirmish_ridge' });
    stepWorld(world, 100);
    expect(world.tick).toBe(1);

    world.finished = true;
    stepWorld(world, 100);
    expect(world.tick).toBe(1);
  });

  it('moves mechs toward the enemy over the opening seconds', () => {
    const world = createWorld(catalog, { seed: 'advance', missionId: 'skirmish_ridge' });
    const scout = world.entities[0];
    expect(scout).toBeDefined();

    const start = { ...(scout?.pos ?? { x: 0, y: 0 }) };
    for (let tick = 0; tick < 200; tick += 1) stepWorld(world, 6000);

    const moved = Math.hypot((scout?.pos.x ?? 0) - start.x, (scout?.pos.y ?? 0) - start.y);
    expect(moved).toBeGreaterThan(10);
  });
});

describe('runBattle', () => {
  it('is deterministic for a given seed', () => {
    const first = runBattle(catalog, { seed: 'battle:7', missionId: 'skirmish_ridge' });
    const second = runBattle(catalog, { seed: 'battle:7', missionId: 'skirmish_ridge' });
    expect(first).toEqual(second);
  });

  it('diverges for a different seed', () => {
    const a = runBattle(catalog, { seed: 'battle:7', missionId: 'skirmish_ridge' });
    const b = runBattle(catalog, { seed: 'battle:8', missionId: 'skirmish_ridge' });
    expect(a).not.toEqual(b);
  });

  it('reaches a decision well inside the time limit', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const result = runBattle(catalog, { seed, missionId: 'skirmish_ridge' });
      expect(result.decided).toBe(true);
      expect(result.winner).not.toBeNull();
      expect(result.ticks).toBeLessThan(catalog.rules.simulation.maxBattleTicks);
    }
  });

  it('leaves exactly one team standing', () => {
    const result = runBattle(catalog, { seed: 'survivors', missionId: 'skirmish_ridge' });
    const survivingTeams = new Set(
      result.units.filter((unit) => unit.alive).map((unit) => unit.team),
    );
    expect(survivingTeams.size).toBe(1);
    expect([...survivingTeams][0]).toBe(result.winner);
  });

  it('records a kill method for every destroyed mech', () => {
    const result = runBattle(catalog, { seed: 'methods', missionId: 'skirmish_ridge' });
    for (const unit of result.units) {
      if (unit.alive) expect(unit.killMethod).toBeNull();
      else expect(unit.killMethod).not.toBeNull();
    }
  });

  it('keeps per-unit accounting self-consistent', () => {
    const result = runBattle(catalog, { seed: 'accounting', missionId: 'skirmish_ridge' });

    const dealt = result.units.reduce((total, unit) => total + unit.damageDealt, 0);
    const taken = result.units.reduce((total, unit) => total + unit.damageTaken, 0);
    const kills = result.units.reduce((total, unit) => total + unit.kills, 0);
    const destroyed = result.units.filter((unit) => !unit.alive).length;

    expect(taken).toBeGreaterThanOrEqual(dealt);
    expect(kills).toBeLessThanOrEqual(destroyed);

    for (const unit of result.units) {
      expect(unit.shotsHit).toBeLessThanOrEqual(unit.shotsFired);
    }
  });

  it('honours a shortened time limit', () => {
    const result = runBattle(catalog, {
      seed: 'clipped',
      missionId: 'skirmish_ridge',
      maxTicks: 40,
    });
    expect(result.ticks).toBe(40);
    expect(result.decided).toBe(false);
  });
});

describe('battle world invariants', () => {
  it('never leaves a destroyed mech operational', () => {
    const world = createWorld(catalog, { seed: 'invariants', missionId: 'skirmish_ridge' });
    while (!world.finished && world.tick < 6000) {
      stepWorld(world, 6000);
      for (const entity of world.entities) {
        if (entity.destroyed) expect(isOperational(entity)).toBe(false);
        expect(entity.heat).toBeGreaterThanOrEqual(0);
      }
    }
    expect(world.finished).toBe(true);
  });
});
