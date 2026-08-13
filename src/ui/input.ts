import type { MechEntity, Vec2 } from '../sim/types';
import { isOperational } from '../sim/types';
import type { Engine } from './engine';
import { useGame } from './store';

/** How far off a mech, in screen pixels, a click still counts as hitting it. */
const PICK_RADIUS = 34;
const PAN_SPEED = 620;
const ZOOM_STEP = 1.12;
/** Ground metres panned per pixel dragged, per metre of camera distance. */
const PAN_PER_PIXEL = 0.0022;

function pointerToScreen(
  canvas: HTMLCanvasElement,
  event: PointerEvent | WheelEvent | MouseEvent,
): Vec2 {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

/**
 * Whether this is a secondary click — the one that gives orders.
 *
 * It is not enough to check for button two. On macOS a Ctrl+click is the
 * standard secondary click, and Firefox reports it as button zero with the
 * control key held; several trackpad configurations do the same. Reading only
 * button two means orders silently do nothing on a Mac.
 */
function isSecondary(event: PointerEvent | MouseEvent): boolean {
  return event.button === 2 || (event.button === 0 && event.ctrlKey);
}

export function attachInput(engine: Engine, canvas: HTMLCanvasElement): () => void {
  const viewport = (): { width: number; height: number } => engine.renderer.viewport;

  const held = new Set<string>();
  let panning = false;
  let lastPan: Vec2 | null = null;
  /**
   * Fingers currently on the glass, by pointer id.
   *
   * A phone has no second mouse button, no scroll wheel and no keyboard, so
   * the touch grammar has to carry the whole game: drag the ground to pan,
   * pinch to zoom, tap a mech to select or attack it, tap the ground to send
   * the selection there.
   */
  const touches = new Map<number, Vec2>();
  /** Distance between two fingers when the pinch began, and the zoom then. */
  let pinchFrom: number | null = null;
  /** Set once a touch has moved far enough to be a drag rather than a tap. */
  let touchDragged = false;
  /** Timestamp of the last order given from a pointer event, to de-duplicate. */
  let orderedAt = -1_000;
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

  /**
   * The mech a click at this point would act on. Hostiles win ties: with a
   * lance selected the interesting thing near the pointer is almost always the
   * enemy, and a friendly standing in front of one should not shield it.
   */
  const pickAt = (screen: Vec2): MechEntity | null => {
    const state = useGame.getState();
    const hostile = engine.renderer.entityAtScreen(
      engine.world,
      screen,
      PICK_RADIUS,
      (entity) => entity.team !== state.playerTeam && isOperational(entity),
    );
    if (hostile !== null) return hostile;
    return engine.renderer.entityAtScreen(engine.world, screen, PICK_RADIUS);
  };

  /**
   * Marks what the pointer is over. The ring this draws is the only way a
   * player can tell "the game does not think I am pointing at that mech" apart
   * from "the click did nothing", so it is worth a raycast per move.
   */
  const updateHover = (screen: Vec2): void => {
    const over = pickAt(screen);
    engine.hoveredId = over?.id ?? null;

    const state = useGame.getState();
    const attackable =
      over !== null && over.team !== state.playerTeam && engine.selectedEntities().length > 0;
    canvas.style.cursor = attackable ? 'crosshair' : 'default';
  };

  /** How far apart the two fingers on the glass are. */
  const pinchSpan = (): number => {
    const [a, b] = [...touches.values()];
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };

  /** Below this a touch is a tap; above it, the player is dragging the map. */
  const TAP_SLOP = 10;

  const onTouchMove = (event: PointerEvent): void => {
    const now = pointerToScreen(canvas, event);
    const was = touches.get(event.pointerId);
    touches.set(event.pointerId, now);

    if (touches.size >= 2) {
      // Pinch, measured against the span the gesture is currently at rather
      // than the one it started at, so the zoom tracks the fingers.
      const span = pinchSpan();
      if (pinchFrom !== null && pinchFrom > 0 && span > 0) {
        engine.renderer.camera.zoomBy(span / pinchFrom);
        pinchFrom = span;
      }
      return;
    }

    if (was === undefined || lastPan === null) return;
    if (Math.hypot(now.x - lastPan.x, now.y - lastPan.y) > TAP_SLOP) touchDragged = true;
    if (!touchDragged) return;

    // Drag the ground rather than a selection box. With no keyboard and no
    // wheel this is the only way to see the rest of the battlefield.
    const scale = engine.renderer.camera.distance * PAN_PER_PIXEL;
    engine.renderer.camera.panBy((was.x - now.x) * scale, (now.y - was.y) * scale);
  };

  /**
   * A tap, resolved when the finger comes off. Taps do what a click does — pick
   * a mech, attack a hostile — and a tap on open ground sends the selection
   * there, which on a desktop is what the second mouse button is for.
   */
  const onTouchEnd = (event: PointerEvent): void => {
    const screen = touches.get(event.pointerId) ?? pointerToScreen(canvas, event);
    touches.delete(event.pointerId);
    if (touches.size < 2) pinchFrom = null;

    const dragged = touchDragged;
    touchDragged = false;
    lastPan = null;
    if (dragged || touches.size > 0) return;

    const state = useGame.getState();
    const world = engine.renderer.camera.screenToWorld(
      screen,
      viewport(),
      engine.renderer.groundMesh,
    );

    if (state.supportMode !== null) {
      engine.callSupport(state.supportMode, world);
      state.setSupportMode(null);
      return;
    }

    const picked = pickAt(screen);

    if (state.orderMode !== null) {
      if (state.orderMode === 'move' || state.orderMode === 'run') {
        engine.orderMove(world, state.orderMode === 'run');
      } else if (state.orderMode === 'attack_move') {
        engine.orderMove(world, false, { engage: true });
      } else if (state.orderMode === 'jump') {
        engine.orderJump(world);
      } else if (picked !== null && picked.team !== state.playerTeam) {
        engine.orderAttack(
          picked.id,
          state.orderMode === 'called_shot' ? state.calledShotLocation : null,
        );
      }
      state.setOrderMode(null);
      return;
    }

    if (picked === null) {
      if (engine.selectedEntities().length > 0) engine.orderMove(world, false);
      return;
    }

    if (picked.team !== state.playerTeam && isOperational(picked)) {
      if (engine.selectedEntities().length > 0) engine.orderAttack(picked.id, null);
      else state.setSelection([picked.id]);
      return;
    }

    engine.audio.select();
    state.setSelection([picked.id]);
  };

  const onPointerDown = (event: PointerEvent): void => {
    // The first gesture is what the browser lets audio start from.
    engine.audio.unlock();
    // Capture keeps a drag alive when the pointer leaves the canvas. It is a
    // convenience, and browsers differ on when the id is capturable, so a
    // refusal here must not be allowed to take the click down with it.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // No capture; drags that leave the canvas just end early.
    }
    const world = toWorld(event);
    const state = useGame.getState();

    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, pointerToScreen(canvas, event));
      if (touches.size === 2) {
        // A second finger turns the gesture into a pinch. Whatever the first
        // finger had started doing is abandoned rather than fought with.
        pinchFrom = pinchSpan();
        panning = false;
        lastPan = null;
        marqueeFrom = null;
        marqueeScreenFrom = null;
        engine.selectionBox = null;
        state.patch({ marquee: null });
        return;
      }
      touchDragged = false;
      lastPan = pointerToScreen(canvas, event);
      return;
    }

    if (event.button === 1) {
      panning = true;
      lastPan = pointerToScreen(canvas, event);
      return;
    }

    if (state.supportMode !== null && event.button === 0 && !event.ctrlKey) {
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

    if (isSecondary(event)) {
      orderedAt = event.timeStamp;
      const target = pickAt(pointerToScreen(canvas, event));
      if (target !== null && target.team !== state.playerTeam && isOperational(target)) {
        engine.orderAttack(target.id, null);
      } else {
        // Shift strings the clicks into a route rather than replacing it.
        engine.orderMove(world, false, { queued: event.shiftKey });
      }
      state.setOrderMode(null);
      return;
    }

    if (state.orderMode !== null) {
      if (state.orderMode === 'move' || state.orderMode === 'run') {
        engine.orderMove(world, state.orderMode === 'run', { queued: event.shiftKey });
      } else if (state.orderMode === 'attack_move') {
        engine.orderMove(world, false, { engage: true, queued: event.shiftKey });
      } else if (state.orderMode === 'jump') {
        engine.orderJump(world);
      } else {
        const target = pickAt(pointerToScreen(canvas, event));
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

    const picked = pickAt(pointerToScreen(canvas, event));
    if (picked === null) {
      // Empty ground: open a marquee. A plain click closes it as a deselect.
      marqueeFrom = world;
      marqueeScreenFrom = pointerToScreen(canvas, event);
      engine.selectionBox = { a: world, b: world };
      state.patch({ marquee: null });
      return;
    }

    // Left-clicking a hostile while your own machines are selected is an
    // attack order. Right-click is still the usual way to give one, but a
    // trackpad with no configured secondary click would otherwise leave the
    // player no way at all to pick a target — and selecting an enemy on its
    // own does nothing except throw away the selection they had.
    if (
      picked.team !== state.playerTeam &&
      isOperational(picked) &&
      engine.selectedEntities().length > 0
    ) {
      engine.orderAttack(picked.id, null);
      return;
    }

    engine.audio.select();
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
    if (event.pointerType === 'touch') {
      onTouchMove(event);
      return;
    }

    engine.cursorWorld = toWorld(event);
    updateHover(pointerToScreen(canvas, event));

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

    if (event.pointerType === 'touch') {
      onTouchEnd(event);
      return;
    }

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

  /**
   * Backstop for browsers that route the secondary click straight to the
   * context menu without a pointerdown carrying button two. If the pointer
   * path already handled this click, the timestamp check swallows it so the
   * order is not given twice.
   */
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    if (event.timeStamp - orderedAt < 400) return;

    const state = useGame.getState();
    if (state.supportMode !== null) return;

    const screen = pointerToScreen(canvas, event);
    const world = engine.renderer.camera.screenToWorld(
      screen,
      viewport(),
      engine.renderer.groundMesh,
    );
    const target = pickAt(screen);
    if (target !== null && target.team !== state.playerTeam && isOperational(target)) {
      engine.orderAttack(target.id, null);
    } else {
      engine.orderMove(world, event.shiftKey);
    }
    state.setOrderMode(null);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    engine.audio.unlock();
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
      case 'KeyA':
        // WASD-pan keeps A only while the palette is closed; an order beats a pan.
        state.setOrderMode('attack_move');
        return;
      case 'KeyQ':
        // The one targeting control that needs no pointer at all.
        engine.targetNearest();
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

    // A is an order key now (attack-move), so panning lives on the arrows
    // alone: half of WASD stealing the map while the other half gives orders
    // would be worse than either scheme.
    let dx = 0;
    let dy = 0;
    if (held.has('ArrowLeft')) dx -= 1;
    if (held.has('ArrowRight')) dx += 1;
    if (held.has('ArrowUp')) dy -= 1;
    if (held.has('ArrowDown')) dy += 1;

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
  // Safari cancels a touch when its own gestures take over, and a cancelled
  // finger that stays in the map leaves the game convinced a pinch is still in
  // progress and refusing every tap after it.
  canvas.addEventListener('pointercancel', onPointerUp);
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
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
