import {
  findEntity,
  isOperational,
  type EntityId,
  type Vec2,
  type World,
} from '../sim/types';

export interface CameraNavigationEngine {
  readonly world: World;
  readonly renderer: { readonly camera: { centreOn: (point: Vec2) => void } };
  selectedEntities: () => EntityId[];
}

/** Arrow keys name the view's destination; panBy takes the counter-motion used by dragging. */
export function arrowPanDelta(held: ReadonlySet<string>, distance: number): Vec2 {
  const horizontal = Number(held.has('ArrowRight')) - Number(held.has('ArrowLeft'));
  const vertical = Number(held.has('ArrowDown')) - Number(held.has('ArrowUp'));
  return { x: horizontal === 0 ? 0 : -horizontal * distance, y: vertical * distance };
}

export function selectedCentre(engine: CameraNavigationEngine): Vec2 | null {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const id of engine.selectedEntities()) {
    const entity = findEntity(engine.world, id);
    if (entity === null || !isOperational(entity)) continue;
    x += entity.pos.x;
    y += entity.pos.y;
    count += 1;
  }
  return count === 0 ? null : { x: x / count, y: y / count };
}

export function centreOnSelection(engine: CameraNavigationEngine | null): boolean {
  if (engine === null) return false;
  const centre = selectedCentre(engine);
  if (centre === null) return false;
  engine.renderer.camera.centreOn(centre);
  return true;
}
