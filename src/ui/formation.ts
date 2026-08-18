import { bodyRadius } from '../sim/collision';
import type { MechEntity, Vec2, World } from '../sim/types';
import type { FormationPreset } from './formationPreset';
import { useGame } from './store';

export interface FormationOffset {
  across: number;
  along: number;
}

export interface FormationPoint extends FormationOffset {
  at: Vec2;
}

export interface FormationTerrain {
  width: number;
  height: number;
  tileSize: number;
  toTile: (point: Vec2) => { column: number; row: number };
  passable: (column: number, row: number) => boolean;
  tileCentre: (column: number, row: number) => Vec2;
}

export interface FormationReservation {
  at: Vec2;
  radius: number;
}

interface Axes {
  forward: Vec2;
  lateral: Vec2;
}

function centreOffsets(offsets: readonly FormationOffset[]): FormationOffset[] {
  const count = Math.max(1, offsets.length);
  const centre = offsets.reduce(
    (sum, offset) => ({
      across: sum.across + offset.across / count,
      along: sum.along + offset.along / count,
    }),
    { across: 0, along: 0 },
  );
  return offsets.map((offset) => ({
    across: offset.across - centre.across,
    along: offset.along - centre.along,
  }));
}

function gridOffsets(count: number): FormationOffset[] {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const offsets: FormationOffset[] = [];
  for (let row = 0; row < rows; row += 1) {
    const rowStart = row * columns;
    const rowCount = Math.min(columns, count - rowStart);
    for (let column = 0; column < rowCount; column += 1) {
      offsets.push({
        across: column - (rowCount - 1) / 2,
        along: row - (rows - 1) / 2,
      });
    }
  }
  return offsets;
}

function wedgeOffsets(count: number): FormationOffset[] {
  const offsets: FormationOffset[] = [{ across: 0, along: 0 }];
  let rank = 1;
  while (offsets.length < count) {
    if (count - offsets.length === 1) {
      offsets.push({ across: 0, along: -rank });
      break;
    }
    offsets.push({ across: -rank, along: -rank }, { across: rank, along: -rank });
    rank += 1;
  }
  return offsets;
}

export function formationOffsets(preset: FormationPreset, count: number): FormationOffset[] {
  if (count <= 0) return [];
  let offsets: FormationOffset[];
  if (preset === 'line') {
    offsets = Array.from({ length: count }, (_, index) => ({
      across: index - (count - 1) / 2,
      along: 0,
    }));
  } else if (preset === 'column') {
    // A zero-width file routes every forward rank through the machines that
    // have already stopped behind it. Two narrow lanes leave room to pass.
    offsets = Array.from({ length: count }, (_, index) => ({
      across: index === 0 ? 0 : index % 2 === 1 ? -0.5 : 0.5,
      along: index - (count - 1) / 2,
    }));
  } else if (preset === 'wedge') {
    offsets = wedgeOffsets(count);
  } else {
    offsets = gridOffsets(count).map((offset) =>
      preset === 'box'
        ? { across: offset.across * 1.5, along: offset.along * 1.1 }
        : offset,
    );
  }
  return centreOffsets(offsets);
}

function axesBetween(centre: Vec2, destination: Vec2): Axes {
  const travelX = destination.x - centre.x;
  const travelY = destination.y - centre.y;
  const length = Math.hypot(travelX, travelY);
  const forward = length > 1 ? { x: travelX / length, y: travelY / length } : { x: 0, y: -1 };
  return { forward, lateral: { x: -forward.y, y: forward.x } };
}

export function formationPoints(
  centre: Vec2,
  destination: Vec2,
  preset: FormationPreset,
  count: number,
  spacing: number,
): FormationPoint[] {
  const axes = axesBetween(centre, destination);
  return formationOffsets(preset, count).map((offset) => ({
    ...offset,
    at: {
      x:
        destination.x +
        axes.lateral.x * offset.across * spacing +
        axes.forward.x * offset.along * spacing,
      y:
        destination.y +
        axes.lateral.y * offset.across * spacing +
        axes.forward.y * offset.along * spacing,
    },
  }));
}

function clearsReservations(
  at: Vec2,
  radius: number,
  reserved: readonly FormationReservation[],
): boolean {
  return reserved.every(
    (entry) => Math.hypot(at.x - entry.at.x, at.y - entry.at.y) >= radius + entry.radius,
  );
}

function searchPassable(
  terrain: FormationTerrain,
  column: number,
  row: number,
  raw: { column: number; row: number },
  asked: Vec2,
  reserved: readonly FormationReservation[],
  radius: number,
  avoidReserved: boolean,
): Vec2 | null {
  const limit = Math.max(terrain.width, terrain.height);
  for (let searchRadius = 0; searchRadius <= limit; searchRadius += 1) {
    for (let offsetRow = -searchRadius; offsetRow <= searchRadius; offsetRow += 1) {
      for (let offsetColumn = -searchRadius; offsetColumn <= searchRadius; offsetColumn += 1) {
        if (Math.max(Math.abs(offsetColumn), Math.abs(offsetRow)) !== searchRadius) continue;
        const candidateColumn = column + offsetColumn;
        const candidateRow = row + offsetRow;
        if (
          candidateColumn < 0 ||
          candidateRow < 0 ||
          candidateColumn >= terrain.width ||
          candidateRow >= terrain.height
        ) {
          continue;
        }
        if (!terrain.passable(candidateColumn, candidateRow)) continue;
        const exact = candidateColumn === raw.column && candidateRow === raw.row;
        const at = exact ? { ...asked } : terrain.tileCentre(candidateColumn, candidateRow);
        if (avoidReserved && !clearsReservations(at, radius, reserved)) continue;
        return at;
      }
    }
  }
  return null;
}

export function repairFormationPoint(
  terrain: FormationTerrain,
  asked: Vec2,
  reserved: FormationReservation[],
  radius = 0,
): Vec2 {
  const raw = terrain.toTile(asked);
  const column = Math.max(0, Math.min(terrain.width - 1, raw.column));
  const row = Math.max(0, Math.min(terrain.height - 1, raw.row));
  const found =
    searchPassable(terrain, column, row, raw, asked, reserved, radius, true) ??
    searchPassable(terrain, column, row, raw, asked, reserved, radius, false) ??
    terrain.tileCentre(column, row);

  reserved.push({ at: found, radius });
  return found;
}

function groupCentre(units: readonly MechEntity[]): Vec2 {
  return units.reduce(
    (sum, unit) => ({ x: sum.x + unit.pos.x / units.length, y: sum.y + unit.pos.y / units.length }),
    { x: 0, y: 0 },
  );
}

function autoUnitOrder(units: readonly MechEntity[], axes: Axes): MechEntity[] {
  return [...units].sort((left, right) => {
    const leftAcross = left.pos.x * axes.lateral.x + left.pos.y * axes.lateral.y;
    const rightAcross = right.pos.x * axes.lateral.x + right.pos.y * axes.lateral.y;
    if (leftAcross !== rightAcross) return leftAcross - rightAcross;
    const leftAlong = left.pos.x * axes.forward.x + left.pos.y * axes.forward.y;
    const rightAlong = right.pos.x * axes.forward.x + right.pos.y * axes.forward.y;
    return leftAlong - rightAlong || left.id - right.id;
  });
}

function presetUnitOrder(units: readonly MechEntity[]): MechEntity[] {
  return [...units].sort((left, right) => right.tonnage - left.tonnage || left.id - right.id);
}

function columnUnitOrder(units: readonly MechEntity[], axes: Axes): MechEntity[] {
  const byWeight = presetUnitOrder(units);
  const heavy = byWeight[0];
  if (heavy === undefined) return [];

  // The heavy owns the protected rear slot. Everyone else keeps their depth
  // order so a single-file move does not require three machines to overtake.
  const remainder = units
    .filter((unit) => unit.id !== heavy.id)
    .sort((left, right) => {
      const leftAlong = left.pos.x * axes.forward.x + left.pos.y * axes.forward.y;
      const rightAlong = right.pos.x * axes.forward.x + right.pos.y * axes.forward.y;
      return leftAlong - rightAlong || left.id - right.id;
    });
  return [heavy, ...remainder];
}

function autoSlotOrder(left: FormationPoint, right: FormationPoint): number {
  return left.across - right.across || left.along - right.along;
}

function protectedSlotOrder(left: FormationPoint, right: FormationPoint): number {
  return (
    Math.abs(left.across) - Math.abs(right.across) ||
    left.along - right.along ||
    left.across - right.across
  );
}

function columnSlotOrder(left: FormationPoint, right: FormationPoint): number {
  return left.along - right.along || left.across - right.across;
}

/** Separate endpoints keep a selected group from pathing into one footprint. */
export function formationDestinations(
  world: World,
  units: readonly MechEntity[],
  destination: Vec2,
  requestedPreset?: FormationPreset,
): Map<number, Vec2> {
  if (units.length <= 1) {
    return new Map(units.map((unit) => [unit.id, { ...destination }]));
  }

  // Sampling the UI choice here fixes it into the issued endpoints; later
  // changes cannot bend a route that is already waiting in the order queue.
  const preset = requestedPreset ?? useGame.getState().formationPreset;
  const centre = groupCentre(units);
  const axes = axesBetween(centre, destination);
  // A pilot may stop one arrival radius short. Reserving that uncertainty on
  // both slots keeps a nominally clear formation clear after the march ends.
  const protectedRadius = (unit: MechEntity): number =>
    bodyRadius(world, unit) + world.rules.movement.arrivalRadius;
  const clearance = Math.max(...units.map((unit) => protectedRadius(unit) * 2));
  const spacing = Math.max(world.terrain.tileSize * 1.5, clearance);
  const slots = formationPoints(centre, destination, preset, units.length, spacing).sort(
    preset === 'auto'
      ? autoSlotOrder
      : preset === 'column'
        ? columnSlotOrder
        : protectedSlotOrder,
  );
  const orderedUnits =
    preset === 'auto'
      ? autoUnitOrder(units, axes)
      : preset === 'column'
        ? columnUnitOrder(units, axes)
        : presetUnitOrder(units);
  const reserved: FormationReservation[] = [];
  return new Map(
    orderedUnits.map((unit, index) => [
      unit.id,
      repairFormationPoint(
        world.terrain,
        slots[index]?.at ?? destination,
        reserved,
        protectedRadius(unit),
      ),
    ]),
  );
}
