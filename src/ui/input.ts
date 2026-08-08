import type { Vec2 } from '../sim/types';
import { isOperational } from '../sim/types';
import type { Engine } from './engine';
import { useGame } from './store';

const PICK_RADIUS = 26;
const PAN_SPEED = 620;
const ZOOM_STEP = 1.12;

function pointerToScreen(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent): Vec2 {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

export function attachInput(engine: Engine, canvas: HTMLCanvasElement): () => void {
  const viewport = (): { width: number; height: number } => ({
    width: engine.app.screen.width,
    height: engine.app.screen.height,
  });

  const held = new Set<string>();
  let panning = false;
  let lastPan: Vec2 | null = null;

  const toWorld = (event: PointerEvent | WheelEvent): Vec2 =>
    engine.renderer.camera.screenToWorld(pointerToScreen(canvas, event), viewport());

  const onPointerDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId);
    const world = toWorld(event);

    if (event.button === 1) {
      panning = true;
      lastPan = pointerToScreen(canvas, event);
      return;
    }

    const state = useGame.getState();

    if (state.supportMode !== null && event.button === 0) {
      engine.callSupport(state.supportMode, world);
      state.setSupportMode(null);
      return;
    }

    if (event.button === 2) {
      const target = engine.renderer.entityAt(engine.world, world, PICK_RADIUS);
      if (target !== null && target.team !== state.playerTeam && isOperational(target)) {
        engine.orderAttack(target.id, null);
      } else {
        engine.orderMove(world, event.shiftKey);
      }
      state.setOrderMode(null);
      return;
    }

    if (state.orderMode !== null) {
      if (state.orderMode === 'move' || state.orderMode === 'run') {
        engine.orderMove(world, state.orderMode === 'run');
      } else {
        const target = engine.renderer.entityAt(engine.world, world, PICK_RADIUS);
        if (target !== null && target.team !== state.playerTeam) {
          engine.orderAttack(
            target.id,
            state.orderMode === 'called_shot' ? state.calledShotLocation : null,
          );
        }
      }
      state.setOrderMode(null);
      return;
    }

    const picked = engine.renderer.entityAt(engine.world, world, PICK_RADIUS);
    if (picked === null) {
      state.setSelection([]);
      return;
    }

    if (event.shiftKey) {
      const next = state.selection.includes(picked.id)
        ? state.selection.filter((id) => id !== picked.id)
        : [...state.selection, picked.id];
      state.setSelection(next);
    } else {
      state.setSelection([picked.id]);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    engine.cursorWorld = toWorld(event);

    if (!panning || lastPan === null) return;
    const screen = pointerToScreen(canvas, event);
    const zoom = engine.renderer.camera.zoom;
    engine.renderer.camera.panBy((lastPan.x - screen.x) / zoom, (lastPan.y - screen.y) / zoom);
    lastPan = screen;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    panning = false;
    lastPan = null;
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    engine.renderer.camera.zoomAt(factor, pointerToScreen(canvas, event), viewport());
  };

  const onContextMenu = (event: MouseEvent): void => event.preventDefault();

  const onKeyDown = (event: KeyboardEvent): void => {
    const state = useGame.getState();
    held.add(event.code);

    switch (event.code) {
      case 'Space':
        event.preventDefault();
        engine.togglePause();
        return;
      case 'KeyM':
        state.setOrderMode('move');
        return;
      case 'KeyR':
        state.setOrderMode('run');
        return;
      case 'KeyF':
        state.setOrderMode('attack');
        return;
      case 'KeyC':
        state.setOrderMode('called_shot');
        return;
      case 'KeyH':
        engine.toggleHoldFire();
        return;
      case 'KeyG':
        engine.orderStop();
        return;
      case 'Escape':
        state.setOrderMode(null);
        state.setSupportMode(null);
        state.setSelection([]);
        return;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
        engine.toggleGroup(Number(event.code.slice(5)));
        return;
      case 'Tab': {
        event.preventDefault();
        const ids = state.units.filter((unit) => unit.alive).map((unit) => unit.id);
        if (ids.length === 0) return;
        const current = state.selection[0];
        const index = current === undefined ? -1 : ids.indexOf(current);
        const next = ids[(index + 1) % ids.length];
        if (next !== undefined) state.setSelection([next]);
        return;
      }
      default:
        return;
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.code);
  };

  let lastCameraFrame = 0;
  const cameraFrame = (now: number): void => {
    const delta = lastCameraFrame === 0 ? 0 : Math.min(0.1, (now - lastCameraFrame) / 1000);
    lastCameraFrame = now;

    let dx = 0;
    let dy = 0;
    if (held.has('ArrowLeft') || held.has('KeyA')) dx -= 1;
    if (held.has('ArrowRight') || held.has('KeyD')) dx += 1;
    if (held.has('ArrowUp') || held.has('KeyW')) dy -= 1;
    if (held.has('ArrowDown') || held.has('KeyS')) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const speed = (PAN_SPEED * delta) / engine.renderer.camera.zoom;
      engine.renderer.camera.panBy(dx * speed, dy * speed);
    }

    if (cameraRunning) requestAnimationFrame(cameraFrame);
  };

  let cameraRunning = true;
  requestAnimationFrame(cameraFrame);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    cameraRunning = false;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}
