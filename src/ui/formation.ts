import { bodyRadius } from '../sim/collision';
import type { MechEntity, Vec2, World } from '../sim/types';

interface Slot {
  at: Vec2;
  across: number;
  along: number;
}

/** A group is ordered around the click so its machines do not share one footprint. */
export function formationDestinations(
  world: World,
  units: readonly MechEntity[],
  destination: Vec2,
): Map<number, Vec2> {
  if (units.length <= 1) {
    return new Map(units.map((unit) => [unit.id, { ...destination }]));
  }

  const centre = units.reduce(
    (sum, unit) => ({ x: sum.x + unit.pos.x / units.length, y: sum.y + unit.pos.y / units.length }),
    { x: 0, y: 0 },
  );
  const travelX = destination.x - centre.x;
  const travelY = destination.y - centre.y;
  const length = Math.hypot(travelX, travelY);
  const forward = length > 1 ? { x: travelX / length, y: travelY / length } : { x: 0, y: -1 };
  const lateral = { x: -forward.y, y: forward.x };
  const clearance = Math.max(...units.map((unit) => bodyRadius(world, unit) * 2));
  const spacing = Math.max(world.terrain.tileSize * 1.5, clearance + 6);
  const columns = Math.ceil(Math.sqrt(units.length));
  const rows = Math.ceil(units.length / columns);
  const slots: Slot[] = [];

  for (let row = 0; row < rows; row += 1) {
    const rowStart = row * columns;
    const rowCount = Math.min(columns, units.length - rowStart);
    for (let column = 0; column < rowCount; column += 1) {
      const across = column - (rowCount - 1) / 2;
      const along = row - (rows - 1) / 2;
      slots.push({
        across,
        along,
        at: {
          x: destination.x + lateral.x * across * spacing + forward.x * along * spacing,
          y: destination.y + lateral.y * across * spacing + forward.y * along * spacing,
        },
      });
    }
  }

  const orderedUnits = [...units].sort((left, right) => {
    const leftAcross = left.pos.x * lateral.x + left.pos.y * lateral.y;
    const rightAcross = right.pos.x * lateral.x + right.pos.y * lateral.y;
    if (leftAcross !== rightAcross) return leftAcross - rightAcross;
    const leftAlong = left.pos.x * forward.x + left.pos.y * forward.y;
    const rightAlong = right.pos.x * forward.x + right.pos.y * forward.y;
    return leftAlong - rightAlong || left.id - right.id;
  });
  slots.sort((left, right) => left.across - right.across || left.along - right.along);

  const reserved = new Set<string>();
  return new Map(
    orderedUnits.map((unit, index) => [
      unit.id,
      reservePassable(world, slots[index]?.at ?? destination, reserved),
    ]),
  );
}

function reservePassable(world: World, asked: Vec2, reserved: Set<string>): Vec2 {
  const grid = world.terrain;
  const raw = grid.toTile(asked);
  const column = Math.max(0, Math.min(grid.width - 1, raw.column));
  const row = Math.max(0, Math.min(grid.height - 1, raw.row));

  for (let radius = 0; radius <= 5; radius += 1) {
    for (let offsetRow = -radius; offsetRow <= radius; offsetRow += 1) {
      for (let offsetColumn = -radius; offsetColumn <= radius; offsetColumn += 1) {
        if (Math.max(Math.abs(offsetColumn), Math.abs(offsetRow)) !== radius) continue;
        const candidateColumn = column + offsetColumn;
        const candidateRow = row + offsetRow;
        const key = `${candidateColumn}:${candidateRow}`;
        if (reserved.has(key) || !grid.passable(candidateColumn, candidateRow)) continue;
        reserved.add(key);
        const exact = candidateColumn === raw.column && candidateRow === raw.row;
        return exact ? { ...asked } : grid.tileCentre(candidateColumn, candidateRow);
      }
    }
  }

  return { ...asked };
}
