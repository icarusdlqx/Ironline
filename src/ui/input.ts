import type { Vec2 } from '../sim/types';
import { isOperational } from '../sim/types';
import type { Engine } from './engine';
import { useGame } from './store';

/** How far off a mech, in screen pixels, a click still counts as hitting it. */
const PICK_RADIUS = 34;
const PAN_SPEED = 620;
const ZOOM_STEP = 1.12;
/** Ground metres panned per pixel dragged, per metre of camera distance. */
const PAN_PER_PIXEL = 0.0022;

function pointerToScreen(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent): Vec2 {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

export function attachInput(engine: Engine, canvas: HTMLCanvasElement): () => void {
  const viewport = (): { width: number; height: number } => engine.renderer.viewport;

  const held = new Set<string>();
  let panning = false;
  let lastPan: Vec2 | null = null;
  /** Where a left-drag started, in world space, while a marquee is open. */
  let marqueeFrom: Vec2 | null = null;
  let marqueeScreenFrom: Vec2 | null = null;

  const DRAG_THRESHOLD = 6;

  /** Every mech of the player's that falls inside the dragged box. */
  const selectWithin = (a: Vec2, b: Vec2, add: boolean): void => {
    const state = useGame.getState();
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);

    const inside = engine.world.entities
      .filter(
        (entity) =>
          entity.team === state.playerTeam &&
          isOperational(entity) &&
          entity.pos.x >= minX &&
          entity.pos.x <= maxX &&
          entity.pos.y >= minY &&
          entity.pos.y <= maxY,
      )
      .map((entity) => entity.id);

    if (inside.length === 0 && !add) {
      state.setSelection([]);
      return;
    }
    state.setSelection(add ? [...new Set([...state.selection, ...inside])] : inside);
  };

  // Every click has to become a point on the battlefield, whichever way the
  // camera has been spun. The terrain mesh is offered to the ray first so that
  // clicking a ridge means the ridge and not the flat ground behind it.
  const toWorld = (event: PointerEvent | WheelEvent): Vec2 =>
    engine.renderer.camera.screenToWorld(
      pointerToScreen(canvas, event),
      viewport(),
      engine.renderer.groundMesh,
    );

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
      // A strafing run needs a direction as well as a point: press to aim, drag
      // to lay the run-in, release to call it. Everything else fires on the press.
      if (engine.supportNeedsHeading(state.supportMode)) {
        engine.supportAim = { call: state.supportMode, at: world, to: world };
        return;
      }
      engine.callSupport(state.supportMode, world);
      state.setSupportMode(null);
      return;
    }

    if (event.button === 2) {
      const target = engine.renderer.entityAtScreen(
        engine.world,
        pointerToScreen(canvas, event),
        PICK_RADIUS,
      );
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
      } else if (state.orderMode === 'jump') {
        engine.orderJump(world);
      } else {
        const target = engine.renderer.entityAtScreen(
          engine.world,
          pointerToScreen(canvas, event),
          PICK_RADIUS,
        );
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

    const picked = engine.renderer.entityAtScreen(
      engine.world,
      pointerToScreen(canvas, event),
      PICK_RADIUS,
    );
    if (picked === null) {
      // Empty ground: open a marquee. A plain click closes it as a deselect.
      marqueeFrom = world;
      marqueeScreenFrom = pointerToScreen(canvas, event);
      engine.selectionBox = { a: world, b: world };
      state.patch({ marquee: null });
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

    const aim = engine.supportAim;
    if (aim !== null) {
      engine.supportAim = { ...aim, to: toWorld(event) };
      return;
    }

    if (marqueeFrom !== null) {
      engine.selectionBox = { a: marqueeFrom, b: toWorld(event) };
      // The box the player is dragging is a screen rectangle, so it is drawn
      // as one over the canvas rather than projected back onto the ground.
      const now = pointerToScreen(canvas, event);
      if (marqueeScreenFrom !== null) {
        useGame.getState().patch({
          marquee: {
            x: Math.min(marqueeScreenFrom.x, now.x),
            y: Math.min(marqueeScreenFrom.y, now.y),
            width: Math.abs(now.x - marqueeScreenFrom.x),
            height: Math.abs(now.y - marqueeScreenFrom.y),
          },
        });
      }
      return;
    }

    if (!panning || lastPan === null) return;
    const screen = pointerToScreen(canvas, event);

    // Pan in the plane the player is looking at, scaled so a drag moves the
    // ground under the cursor by roughly the distance dragged.
    const scale = engine.renderer.camera.distance * PAN_PER_PIXEL;
    engine.renderer.camera.panBy((lastPan.x - screen.x) * scale, (screen.y - lastPan.y) * scale);
    lastPan = screen;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    panning = false;
    lastPan = null;

    const aim = engine.supportAim;
    if (aim !== null) {
      engine.supportAim = null;
      engine.callSupport(aim.call, aim.at, toWorld(event));
      useGame.getState().setSupportMode(null);
      return;
    }

    if (marqueeFrom !== null) {
      const screen = pointerToScreen(canvas, event);
      const dragged =
        marqueeScreenFrom !== null &&
        Math.hypot(screen.x - marqueeScreenFrom.x, screen.y - marqueeScreenFrom.y) >
          DRAG_THRESHOLD;

      if (dragged) selectWithin(marqueeFrom, toWorld(event), event.shiftKey);
      else if (!event.shiftKey) useGame.getState().setSelection([]);

      marqueeFrom = null;
      marqueeScreenFrom = null;
      engine.selectionBox = null;
      useGame.getState().patch({ marquee: null });
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    engine.renderer.camera.zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  };

  const onContextMenu = (event: MouseEvent): void => event.preventDefault();

  const onKeyDown = (event: KeyboardEvent): void => {
    const state = useGame.getState();

    // A browser shortcut is not a battle order. Ctrl+R has to reload the page
    // without also putting the lance into run mode, and Cmd+T has to open a tab
    // without switching the heat governor off. Nor should the chorded key stick
    // in `held` and pan the camera for ever once focus moves to the new tab.
    // Control groups are the exception: those are bound with Ctrl or Cmd.
    if ((event.ctrlKey || event.metaKey || event.altKey) && !event.code.startsWith('Digit')) {
      return;
    }

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
        engine.setPosture('hold_position');
        return;
      case 'KeyB':
        engine.setPosture('return_fire');
        return;
      case 'KeyK':
        engine.setPosture('keep_facing');
        return;
      case 'KeyT':
        engine.toggleHeatSafety();
        return;
      case 'KeyJ':
        state.setOrderMode('jump');
        return;
      case 'Escape':
        state.setOrderMode(null);
        state.setSupportMode(null);
        state.setSelection([]);
        return;
      case 'KeyE':
        state.setSelection(
          state.units.filter((unit) => unit.alive).map((unit) => unit.id),
        );
        return;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
      case 'Digit6':
      case 'Digit7':
      case 'Digit8':
      case 'Digit9': {
        const slot = Number(event.code.slice(5));
        if (event.shiftKey) {
          // Weapon groups are per-mech and rarer than picking a lance element,
          // so the bare number keys go to control groups.
          if (slot <= 4) engine.toggleGroup(slot);
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          state.assignControlGroup(slot, state.selection);
          return;
        }
        const bound = (state.controlGroups[slot] ?? []).filter((id) =>
          state.units.some((unit) => unit.id === id && unit.alive),
        );
        if (bound.length > 0) state.setSelection(bound);
        return;
      }
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

  // Keyup lands on whoever has focus, so a key released after the window loses
  // it is never cleared and the camera drifts on its own until it is pressed
  // again. Losing focus means nothing is held any more.
  const onBlur = (): void => held.clear();

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
      const speed = PAN_SPEED * delta * (engine.renderer.camera.distance / 620);
      // Screen-space directions, so the keys keep meaning the same thing on
      // screen after the camera has been swung round.
      engine.renderer.camera.panBy(dx * speed, -dy * speed);
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
  window.addEventListener('blur', onBlur);

  return () => {
    cameraRunning = false;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
