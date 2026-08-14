import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, makeGrid, OPEN_LEGEND, playerWorld, unitOf } from '../../tests/support';
import { hitChance } from './combat';
import { createVision, isVisibleTo, updateVision } from './sensors';
import type { MechEntity, World } from './types';

let world: World;
let scout: MechEntity;
let enemy: MechEntity;

const TILE = 40;
const SPAN = 60;

/** Open ground everywhere, with trees on the listed tiles and nowhere else. */
function ground(wooded: readonly { x: number; y: number }[] = []): void {
  const rows = Array.from({ length: SPAN }, () => Array.from({ length: SPAN }, () => '.'));
  for (const at of wooded) {
    const row = rows[Math.floor(at.y / TILE)];
    if (row !== undefined) row[Math.floor(at.x / TILE)] = 'f';
  }
  world.terrain = makeGrid({
    legend: OPEN_LEGEND,
    tiles: rows.map((row) => row.join('')),
    tileSize: TILE,
  });
}

/** Drops a stand of trees on one tile, leaving the rest of the map alone. */
function wood(at: { x: number; y: number }): void {
  ground([at]);
}

/** Puts the hostile `metres` off the scout's nose and re-runs detection. */
function standOff(metres: number): boolean {
  enemy.pos = { x: scout.pos.x + metres, y: scout.pos.y };
  world.vision = createVision(world, scout.team);
  updateVision(world, world.vision);
  return isVisibleTo(world.vision, enemy);
}

beforeEach(() => {
  world = playerWorld('terrain-effects');
  scout = unitOf(world, 'hornet_spotter');
  enemy = unitOf(world, 'bulwark_burner');

  // Flat, empty ground with nothing to break the sightline, so the only thing
  // under test is the tile the hostile happens to be standing on.
  ground();
  scout.pos = { x: 200, y: 200 };
});

describe('forest concealment', () => {
  it('has to be walked up on in the trees', () => {
    const open = catalog.rules.terrain.types.open?.signatureFactor ?? 1;
    const forest = catalog.rules.terrain.types.forest?.signatureFactor ?? 1;
    expect(forest).toBeLessThan(open);

    // A standoff that reads clearly in the open. Only the one tile the hostile
    // is standing on changes between the two halves of this test, so nothing
    // but its signature can account for the difference — in particular the
    // sightline is identical, and never blocks on the target's own tile.
    const reach = scout.sensorRange * enemy.signature;
    const between = reach * ((forest + open) / 2);

    expect(standOff(between)).toBe(true);

    wood(enemy.pos);
    expect(standOff(between)).toBe(false);
  });

  it('leaves the trees behind when the mech walks out', () => {
    const forest = catalog.rules.terrain.types.forest?.signatureFactor ?? 1;
    const reach = scout.sensorRange * enemy.signature;
    const between = reach * ((forest + 1) / 2);

    standOff(between);
    wood(enemy.pos);
    expect(standOff(between)).toBe(false);

    // One tile nearer, out from under the canopy, and the scope has it again.
    // Concealment is where a mech is standing, not something it carries.
    expect(standOff(between - 40)).toBe(true);
  });

  it('gives no cover in the water — the river pays in heat, not in hiding', () => {
    expect(catalog.rules.terrain.types.water?.signatureFactor).toBe(1);
    expect(catalog.rules.terrain.types.water?.heatDissipationMultiplier).toBeGreaterThan(1);
  });
});

describe('the high ground', () => {
  beforeEach(() => {
    // A step: level 2 on the left half, level 0 on the right.
    world.terrain = makeGrid({
      legend: OPEN_LEGEND,
      tiles: Array.from({ length: 4 }, () => '.'.repeat(4)),
      elevation: Array.from({ length: 4 }, () => '2200'),
      tileSize: 100,
    });
    scout.pos = { x: 50, y: 150 };
    enemy.pos = { x: 350, y: 150 };
  });

  it('shoots better looking down than looking up', () => {
    const gun = catalog.weapons.get('medium_laser');
    expect(gun).toBeDefined();
    if (gun === undefined) return;

    const range = Math.hypot(enemy.pos.x - scout.pos.x, enemy.pos.y - scout.pos.y);
    const downhill = hitChance(world, scout, enemy, gun, range, 1);
    const uphill = hitChance(world, enemy, scout, gun, range, 1);

    expect(downhill).toBeGreaterThan(uphill);
  });

  it('caps the advantage, so a tall map is not a firing range', () => {
    const gun = catalog.weapons.get('medium_laser');
    expect(gun).toBeDefined();
    if (gun === undefined) return;

    const rules = catalog.rules.combat.elevation;
    world.terrain = makeGrid({
      legend: OPEN_LEGEND,
      tiles: Array.from({ length: 4 }, () => '.'.repeat(4)),
      // Nine levels of relief, far past the cap.
      elevation: Array.from({ length: 4 }, () => '9900'),
      tileSize: 100,
    });

    const range = Math.hypot(enemy.pos.x - scout.pos.x, enemy.pos.y - scout.pos.y);
    const flat = hitChance(world, enemy, enemy, gun, range, 1);
    const towering = hitChance(world, scout, enemy, gun, range, 1);

    expect(towering / flat).toBeLessThanOrEqual(rules.accuracyPerLevel ** rules.maxLevels + 1e-9);
  });
});
