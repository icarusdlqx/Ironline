import { afterEach, describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { bodyRadius } from '../sim/collision';
import { issueMove } from '../sim/orders';
import type { MechEntity, Vec2, World } from '../sim/types';
import { createWorld } from '../sim/world';
import {
  formationDestinations,
  formationOffsets,
  formationPoints,
  repairFormationPoint,
  type FormationTerrain,
} from './formation';
import { FORMATION_PRESETS } from './formationPreset';
import { useGame } from './store';

const PRESETS = FORMATION_PRESETS.map((preset) => preset.id);

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

function centreOf(units: readonly MechEntity[]): Vec2 {
  return units.reduce(
    (sum, unit) => ({ x: sum.x + unit.pos.x / units.length, y: sum.y + unit.pos.y / units.length }),
    { x: 0, y: 0 },
  );
}

function pointKey(point: Vec2): string {
  return `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;
}

function expectArrivalFootprintsClear(
  world: World,
  units: readonly MechEntity[],
  orders: ReadonlyMap<number, Vec2>,
): void {
  for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
    const left = units[leftIndex];
    const leftAt = left === undefined ? undefined : orders.get(left.id);
    if (left === undefined || leftAt === undefined) throw new Error('left endpoint missing');
    for (let rightIndex = leftIndex + 1; rightIndex < units.length; rightIndex += 1) {
      const right = units[rightIndex];
      const rightAt = right === undefined ? undefined : orders.get(right.id);
      if (right === undefined || rightAt === undefined) throw new Error('right endpoint missing');
      const gap = Math.hypot(leftAt.x - rightAt.x, leftAt.y - rightAt.y);
      expect(gap).toBeGreaterThanOrEqual(
        bodyRadius(world, left) +
          bodyRadius(world, right) +
          world.rules.movement.arrivalRadius * 2 -
          1e-6,
      );
    }
  }
}

function blockedCentre(world: World): Vec2 {
  for (let row = 2; row < world.terrain.height - 2; row += 1) {
    for (let column = 2; column < world.terrain.width - 2; column += 1) {
      if (!world.terrain.passable(column, row)) return world.terrain.tileCentre(column, row);
    }
  }
  throw new Error('map has no blocked formation ground');
}

afterEach(() => useGame.getState().setFormationPreset('auto'));

describe('formation geometry', () => {
  it('centres every preset and keeps their four-machine silhouettes distinct', () => {
    const signatures = new Set<string>();
    for (const preset of PRESETS) {
      const offsets = formationOffsets(preset, 4);
      expect(offsets).toHaveLength(4);
      expect(offsets.reduce((sum, slot) => sum + slot.across, 0)).toBeCloseTo(0, 8);
      expect(offsets.reduce((sum, slot) => sum + slot.along, 0)).toBeCloseTo(0, 8);
      signatures.add(
        offsets
          .map((slot) => `${slot.across.toFixed(2)}:${slot.along.toFixed(2)}`)
          .sort()
          .join('|'),
      );
    }
    expect(signatures).toHaveLength(PRESETS.length);
  });

  it('rotates line slots with travel and scales them from one spacing value', () => {
    const east = formationPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 'line', 3, 20);
    const north = formationPoints({ x: 0, y: 0 }, { x: 0, y: 100 }, 'line', 3, 20);
    const wide = formationPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 'line', 3, 40);

    expect(east.map((slot) => slot.at.x)).toEqual([100, 100, 100]);
    expect(east.map((slot) => slot.at.y)).toEqual([-20, 0, 20]);
    expect(north.map((slot) => slot.at.x)).toEqual([20, 0, -20]);
    expect(north.map((slot) => slot.at.y)).toEqual([100, 100, 100]);
    expect(wide[0]?.at.y).toBe((east[0]?.at.y ?? 0) * 2);
  });

  it('keeps a column narrow but gives successive ranks separate lanes', () => {
    const offsets = formationOffsets('column', 4);
    const across = offsets.map((slot) => slot.across);
    const along = offsets.map((slot) => slot.along);
    const acrossSpan = Math.max(...across) - Math.min(...across);
    const alongSpan = Math.max(...along) - Math.min(...along);

    expect(acrossSpan).toBeGreaterThan(0);
    expect(alongSpan).toBeGreaterThan(acrossSpan * 2);
  });
});

describe('formation endpoint orders', () => {
  it.each(PRESETS)('leaves a single-machine %s order on the exact click', (preset) => {
    const { world, units } = battle();
    const unit = units[0];
    if (unit === undefined) throw new Error('no player unit');
    const destination = { x: 417.25, y: 612.75 };

    expect(formationDestinations(world, [unit], destination, preset).get(unit.id)).toEqual(
      destination,
    );
  });

  it.each(PRESETS)('gives a lance distinct passable %s endpoints', (preset) => {
    const { world, units } = battle();
    const destination = openCentre(world);
    const orders = formationDestinations(world, units, destination, preset);
    const places = [...orders.values()];
    const tiles = places.map((place) => world.terrain.toTile(place));

    expect(orders).toHaveLength(units.length);
    expect(new Set(tiles.map((tile) => `${tile.column}:${tile.row}`))).toHaveLength(units.length);
    expect(tiles.every((tile) => world.terrain.passable(tile.column, tile.row))).toBe(true);
    expectArrivalFootprintsClear(world, units, orders);
    expect(places.reduce((sum, place) => sum + place.x, 0) / places.length).toBeCloseTo(
      destination.x,
      5,
    );
    expect(places.reduce((sum, place) => sum + place.y, 0) / places.length).toBeCloseTo(
      destination.y,
      5,
    );
  });

  it.each(PRESETS)('assigns %s endpoints independently of selection order', (preset) => {
    const { world, units } = battle();
    const destination = openCentre(world);
    const forward = formationDestinations(world, units, destination, preset);
    const reverse = formationDestinations(world, [...units].reverse(), destination, preset);

    for (const unit of units) expect(reverse.get(unit.id)).toEqual(forward.get(unit.id));
  });

  it('keeps the heaviest machine in the centre-rear of a named preset', () => {
    const { world, units } = battle();
    const destination = openCentre(world);
    const centre = centreOf(units);
    const length = Math.hypot(destination.x - centre.x, destination.y - centre.y);
    const forward = {
      x: (destination.x - centre.x) / length,
      y: (destination.y - centre.y) / length,
    };
    const orders = formationDestinations(world, units, destination, 'column');
    const heaviest = [...units].sort(
      (left, right) => right.tonnage - left.tonnage || left.id - right.id,
    )[0];
    if (heaviest === undefined) throw new Error('no heaviest unit');
    const along = (point: Vec2): number =>
      (point.x - destination.x) * forward.x + (point.y - destination.y) * forward.y;
    const across = (point: Vec2): number =>
      Math.abs((point.x - destination.x) * -forward.y + (point.y - destination.y) * forward.x);
    const heavyAlong = along(orders.get(heaviest.id) ?? destination);
    const heavyAcross = across(orders.get(heaviest.id) ?? destination);

    expect(heavyAlong).toBe(Math.min(...[...orders.values()].map(along)));
    expect(heavyAcross).toBeCloseTo(Math.min(...[...orders.values()].map(across)), 5);
  });

  it('keeps the rest of a column in depth order behind the heavy slot', () => {
    const { world, units } = battle();
    const destination = openCentre(world);
    const centre = centreOf(units);
    const length = Math.hypot(destination.x - centre.x, destination.y - centre.y);
    const forward = {
      x: (destination.x - centre.x) / length,
      y: (destination.y - centre.y) / length,
    };
    const orders = formationDestinations(world, units, destination, 'column');
    const heaviest = [...units].sort(
      (left, right) => right.tonnage - left.tonnage || left.id - right.id,
    )[0];
    if (heaviest === undefined) throw new Error('no heaviest unit');
    const along = (point: Vec2): number => point.x * forward.x + point.y * forward.y;
    const remainder = units.filter((unit) => unit.id !== heaviest.id);
    const before = [...remainder].sort(
      (left, right) => along(left.pos) - along(right.pos) || left.id - right.id,
    );
    const after = [...remainder].sort(
      (left, right) =>
        along(orders.get(left.id) ?? destination) -
          along(orders.get(right.id) ?? destination) ||
        left.id - right.id,
    );

    expect(after.map((unit) => unit.id)).toEqual(before.map((unit) => unit.id));
  });

  it('reads the current battle selector when no preset is supplied', () => {
    const { world, units } = battle();
    const destination = openCentre(world);
    useGame.getState().setFormationPreset('wedge');

    expect(formationDestinations(world, units, destination)).toEqual(
      formationDestinations(world, units, destination, 'wedge'),
    );
  });

  it('keeps queued endpoints in the shape chosen when each leg was issued', () => {
    const { world, units } = battle();
    const firstAt = openCentre(world);
    const secondAt = { x: firstAt.x + world.terrain.tileSize * 2, y: firstAt.y };
    const first = formationDestinations(world, units, firstAt, 'line');
    const second = formationDestinations(world, units, secondAt, 'column');
    const issued = new Map<number, Vec2>();

    for (const unit of units) {
      expect(issueMove(world, unit, first.get(unit.id) ?? firstAt, true)).toBe(true);
      const endpoint = unit.orders.move?.to;
      if (endpoint === undefined) throw new Error('first endpoint missing');
      issued.set(unit.id, { ...endpoint });
    }
    for (const unit of units) {
      expect(
        issueMove(world, unit, second.get(unit.id) ?? secondAt, true, {
          queued: true,
          engage: true,
        }),
      ).toBe(true);
      expect(unit.orders.move?.to).toEqual(issued.get(unit.id));
      expect(unit.orders.queue[0]).toEqual({
        to: second.get(unit.id),
        run: true,
        engage: true,
      });
    }

    expect(new Set([...issued.values()].map(pointKey))).toHaveLength(units.length);
    expect(new Set([...second.values()].map(pointKey))).toHaveLength(units.length);
  });
});

describe('formation ground repair', () => {
  it.each(PRESETS)('repairs off-map %s slots to clear authored ground', (preset) => {
    const { world, units } = battle();
    const orders = formationDestinations(world, units, { x: -300, y: -300 }, preset);
    const tiles = [...orders.values()].map((point) => world.terrain.toTile(point));

    expect(
      tiles.every(
        (tile) =>
          tile.column >= 0 &&
          tile.row >= 0 &&
          tile.column < world.terrain.width &&
          tile.row < world.terrain.height &&
          world.terrain.passable(tile.column, tile.row),
      ),
    ).toBe(true);
    expect(new Set(tiles.map((tile) => `${tile.column}:${tile.row}`))).toHaveLength(units.length);
    expectArrivalFootprintsClear(world, units, orders);
  });

  it.each(PRESETS)('repairs blocked %s slots to arrival-clear ground', (preset) => {
    const { world, units } = battle();
    const destination = blockedCentre(world);
    const orders = formationDestinations(world, units, destination, preset);
    const targetTile = world.terrain.toTile(destination);
    const tiles = [...orders.values()].map((point) => world.terrain.toTile(point));

    expect(world.terrain.passable(targetTile.column, targetTile.row)).toBe(false);
    expect(tiles.every((tile) => world.terrain.passable(tile.column, tile.row))).toBe(true);
    expect(new Set(tiles.map((tile) => `${tile.column}:${tile.row}`))).toHaveLength(units.length);
    expectArrivalFootprintsClear(world, units, orders);
  });

  it('searches beyond the local obstruction and reuses ground only as a final fallback', () => {
    const terrain: FormationTerrain = {
      width: 12,
      height: 12,
      tileSize: 10,
      toTile: (point) => ({ column: Math.floor(point.x / 10), row: Math.floor(point.y / 10) }),
      passable: (column, row) => column === 11 && row === 11,
      tileCentre: (column, row) => ({ x: column * 10 + 5, y: row * 10 + 5 }),
    };
    const reserved: Array<{ at: Vec2; radius: number }> = [];

    expect(repairFormationPoint(terrain, { x: 55, y: 55 }, reserved, 4)).toEqual({
      x: 115,
      y: 115,
    });
    expect(repairFormationPoint(terrain, { x: -20, y: -20 }, reserved, 4)).toEqual({
      x: 115,
      y: 115,
    });
  });
});
