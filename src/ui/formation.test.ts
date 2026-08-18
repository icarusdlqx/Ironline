import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { MechEntity, Vec2, World } from '../sim/types';
import { createWorld } from '../sim/world';
import { formationDestinations } from './formation';

function battle(): { world: World; units: MechEntity[] } {
  const world = createWorld(catalog, {
    missionId: 'skirmish_ridge',
    playerTeam: 0,
    seed: 'formation',
  });
  return { world, units: world.entities.filter((entity) => entity.team === 0) };
}

function openCentre(world: World): Vec2 {
  for (let row = 3; row < world.terrain.height - 3; row += 1) {
    for (let column = 3; column < world.terrain.width - 3; column += 1) {
      let open = true;
      for (let y = -3; y <= 3 && open; y += 1) {
        for (let x = -3; x <= 3; x += 1) {
          if (!world.terrain.passable(column + x, row + y)) open = false;
        }
      }
      if (open) return world.terrain.tileCentre(column, row);
    }
  }
  throw new Error('map has no open formation ground');
}

describe('group movement formations', () => {
  it('leaves a single-machine order on the exact click', () => {
    const { world, units } = battle();
    const unit = units[0];
    if (unit === undefined) throw new Error('no player unit');
    const destination = { x: 417.25, y: 612.75 };

    expect(formationDestinations(world, [unit], destination).get(unit.id)).toEqual(destination);
  });

  it('gives a lance distinct destinations centred on the order', () => {
    const { world, units } = battle();
    const destination = openCentre(world);
    const orders = formationDestinations(world, units, destination);
    const places = [...orders.values()];
    const tiles = places.map((place) => world.terrain.toTile(place));

    expect(orders).toHaveLength(units.length);
    expect(new Set(tiles.map((tile) => `${tile.column}:${tile.row}`))).toHaveLength(units.length);
    expect(places.reduce((sum, place) => sum + place.x, 0) / places.length).toBeCloseTo(
      destination.x,
      5,
    );
    expect(places.reduce((sum, place) => sum + place.y, 0) / places.length).toBeCloseTo(
      destination.y,
      5,
    );
  });

  it('assigns the same slots regardless of selection order', () => {
    const { world, units } = battle();
    const destination = openCentre(world);
    const forward = formationDestinations(world, units, destination);
    const reverse = formationDestinations(world, [...units].reverse(), destination);

    for (const unit of units) expect(reverse.get(unit.id)).toEqual(forward.get(unit.id));
  });

  it('reserves separate passable ground when a slot lands on an obstruction', () => {
    const { world, units } = battle();
    let blocked: Vec2 | null = null;
    for (let row = 0; row < world.terrain.height && blocked === null; row += 1) {
      for (let column = 0; column < world.terrain.width; column += 1) {
        if (!world.terrain.passable(column, row)) {
          blocked = world.terrain.tileCentre(column, row);
          break;
        }
      }
    }
    if (blocked === null) throw new Error('map has no obstruction');

    const places = [...formationDestinations(world, units, blocked).values()];
    const tiles = places.map((place) => world.terrain.toTile(place));
    expect(tiles.every((tile) => world.terrain.passable(tile.column, tile.row))).toBe(true);
    expect(new Set(tiles.map((tile) => `${tile.column}:${tile.row}`))).toHaveLength(units.length);
  });
});
