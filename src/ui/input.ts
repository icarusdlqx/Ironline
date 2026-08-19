import type { MechEntity, Vec2 } from '../sim/types';
import { isOperational } from '../sim/types';
import type { Engine } from './engine';
import { useGame } from './store';
import { TouchInput } from './touchInput';
import { isInteractiveKeyTarget, shouldIgnoreBattleKey } from './battleKeyboard';

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
  const battleFinished = (): boolean => engine.world.finished || useGame.getState().finished;
  const canAct = (): boolean => useGame.getState().briefingSeen && !battleFinished();

  const held = new Set<string>();
  let panning = false;
  let lastPan: Vec2 | null = null;
  /** Timestamp of the last order given from a pointer event, to de-duplicate. */
  let orderedAt = -1_000;
  /** Where a left-drag started, in world space, while a marquee is open. */
  let marqueeFrom: Vec2 | null = null;
  let marqueeScreenFrom: Vec2 | null = null;
  /**
   * The machine a marquee was dragged out from, if any. A box that started on
   * one of the player's own mechs and caught nothing leaves that mech
   * selected: the player pressed it deliberately, and taking the selection
   * away for a gesture that found nothing is how a click becomes a mystery.
   */
  let marqueeFromMech: number | null = null;
  /**
   * A press on one of the player's own mechs. The machine is selected on the
   * press — instantly, so the ring answers the click — and this record keeps
   * the press point so a drag from there can still open a marquee.
   *
   * Selecting on release instead cost the player their selection every time a
   * click wobbled: the pointer crossing a few pixels turned the click into a
   * box that caught nothing and cleared everything, and the destination order
   * that followed then had nothing to act on. A stalled frame makes that
   * wobble near-certain, which is exactly when it was reported.
   */
  let pressedOnMech: { id: number; screen: Vec2; world: Vec2 } | null = null;
  /**
   * The pointer's last known place on the canvas, and whether it has moved
   * since hover was last resolved. Pointer events only carry where the mouse
   * is; what the game says is under it — the hovered mech, the cursor's ground
   * point — is resolved once per frame from here instead of once per event,
   * because each resolution costs a raycast into the terrain and a pick over
   * every machine on the field.
   */
  let lastPointer: Vec2 | null = null;
  let pointerDirty = false;
  let lastHoverTick = -1;
  let lastCameraKey = '';
  let lastCursorStyle = '';

  const DRAG_THRESHOLD = 6;
  /**
   * How far a press that landed on one of the player's own machines must
   * travel before it counts as a box-select rather than a click. Wider than a
   * bare-ground drag on purpose: clicking a mech is the commonest action in
   * the game, and the cost of misreading it — losing the selection — is worse
   * than the cost of a box that takes a moment longer to open.
   */
  const MECH_DRAG_THRESHOLD = 14;

  /**
   * Every mech of the player's that falls inside the dragged box — measured on
   * screen, in the same pixels the box is drawn in. Judging it on the ground
   * instead selected a different set from the one the player had drawn round:
   * the camera is tilted, so a machine's feet sit well behind its body on
   * screen, and a box neatly around a lance contained almost none of them.
   */
  const selectWithin = (a: Vec2, b: Vec2, add: boolean): void => {
    const state = useGame.getState();
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);

    const inside = engine.world.entities
      .filter((entity) => entity.team === state.playerTeam && isOperational(entity))
      .filter((entity) => {
        // The hull counts, not a point at its centre: a machine the box cuts
        // through is one the player drew their box around.
        const body = engine.renderer.screenBodyOf(entity);
        return (
          body.x + body.radius >= minX &&
          body.x - body.radius <= maxX &&
          body.y + body.radius >= minY &&
          body.y - body.radius <= maxY
        );
      })
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
  const screenWorld = (screen: Vec2): Vec2 =>
    engine.renderer.camera.screenToWorld(screen, viewport(), engine.renderer.groundMesh);
  const toWorld = (event: PointerEvent | WheelEvent): Vec2 =>
    screenWorld(pointerToScreen(canvas, event));

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

  const touchInput = new TouchInput({
    engine,
    pickAt,
    screenWorld,
    zoomBetween: (factor, from, to) =>
      engine.renderer.camera.zoomBetween(
        factor,
        from,
        to,
        viewport(),
        engine.renderer.groundMesh,
      ),
    canAct,
    onPinchStart: () => {
      panning = false;
      lastPan = null;
      marqueeFrom = null;
      marqueeScreenFrom = null;
      engine.selectionBox = null;
      useGame.getState().patch({ marquee: null });
    },
  });

  /**
   * Marks what the pointer is over. The ring this draws is the only way a
   * player can tell "the game does not think I am pointing at that mech" apart
   * from "the click did nothing", so it is worth a pick per frame.
   */
  const updateHover = (screen: Vec2): void => {
    const over = pickAt(screen);
    engine.hoveredId = over?.id ?? null;

    const state = useGame.getState();
    const attackable =
      over !== null && over.team !== state.playerTeam && engine.selectedEntities().length > 0;
    // Only written on change: assigning the same cursor string every frame
    // still costs the browser a style pass.
    const style = state.supportMode !== null || attackable ? 'crosshair' : 'default';
    if (style !== lastCursorStyle) {
      lastCursorStyle = style;
      canvas.style.cursor = style;
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (battleFinished()) return;
    // A press whose release never arrived — the pointer left the window, the
    // browser cancelled it — must not leave a gesture half-open for this one
    // to trip over.
    pressedOnMech = null;
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
      const screen = pointerToScreen(canvas, event);
      touchInput.start(event.pointerId, screen, world);
      return;
    }

    if (event.button === 1) {
      panning = true;
      lastPan = pointerToScreen(canvas, event);
      return;
    }

    // The field may be inspected while the briefing is open, but no click may
    // quietly become an order that starts executing the moment Deploy is tapped.
    if (!state.briefingSeen) return;

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

    // Selected now, but the press may yet become a box-select dragged out
    // from this machine — which is the only way to marquee a bunched lance.
    if (picked.team === state.playerTeam) {
      pressedOnMech = { id: picked.id, screen: pointerToScreen(canvas, event), world };
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (battleFinished()) return;
    if (event.pointerType === 'touch') {
      touchInput.move(event.pointerId, pointerToScreen(canvas, event));
      return;
    }

    // What is under the pointer — the hovered mech, the cursor's ground point
    // — is resolved once per frame in the frame loop below, not here: the
    // browser can deliver a burst of moves per frame, and each resolution is
    // a raycast into the terrain plus a pick across the field.
    const screen = pointerToScreen(canvas, event);
    lastPointer = screen;
    pointerDirty = true;

    // A press that began on one of the player's machines has been dragged far
    // enough to mean a box: open the marquee from the press point. The mech is
    // already selected, and stays selected if the box catches nothing.
    if (pressedOnMech !== null) {
      const drag = Math.hypot(
        screen.x - pressedOnMech.screen.x,
        screen.y - pressedOnMech.screen.y,
      );
      if (drag > MECH_DRAG_THRESHOLD) {
        marqueeFrom = pressedOnMech.world;
        marqueeScreenFrom = pressedOnMech.screen;
        marqueeFromMech = pressedOnMech.id;
        engine.selectionBox = { a: pressedOnMech.world, b: pressedOnMech.world };
        useGame.getState().patch({ marquee: null });
        pressedOnMech = null;
      }
    }

    const aim = engine.supportAim;
    if (aim !== null) {
      engine.supportAim = { ...aim, to: screenWorld(screen) };
      return;
    }

    if (marqueeFrom !== null) {
      engine.selectionBox = { a: marqueeFrom, b: screenWorld(screen) };
      // The box the player is dragging is a screen rectangle, so it is drawn
      // as one over the canvas rather than projected back onto the ground.
      if (marqueeScreenFrom !== null) {
        useGame.getState().patch({
          marquee: {
            x: Math.min(marqueeScreenFrom.x, screen.x),
            y: Math.min(marqueeScreenFrom.y, screen.y),
            width: Math.abs(screen.x - marqueeScreenFrom.x),
            height: Math.abs(screen.y - marqueeScreenFrom.y),
          },
        });
      }
      return;
    }

    if (!panning || lastPan === null) return;

    // Pan in the plane the player is looking at, scaled so a drag moves the
    // ground under the cursor by roughly the distance dragged.
    const scale = engine.renderer.camera.distance * PAN_PER_PIXEL;
    engine.renderer.camera.panBy((lastPan.x - screen.x) * scale, (screen.y - lastPan.y) * scale);
    lastPan = screen;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);

    if (battleFinished()) {
      if (event.pointerType === 'touch') touchInput.cancel(event.pointerId);
      pressedOnMech = null;
      marqueeFrom = null;
      marqueeScreenFrom = null;
      marqueeFromMech = null;
      panning = false;
      lastPan = null;
      engine.selectionBox = null;
      engine.supportAim = null;
      useGame.getState().patch({ marquee: null });
      return;
    }

    if (event.pointerType === 'touch') {
      touchInput.finish(event.pointerId, pointerToScreen(canvas, event));
      return;
    }

    panning = false;
    lastPan = null;

    // A press on a machine that never became a drag: the selection it made on
    // the way down stands, and there is nothing left to decide.
    pressedOnMech = null;

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

      const before = useGame.getState().selection;
      if (dragged && marqueeScreenFrom !== null) {
        selectWithin(marqueeScreenFrom, screen, event.shiftKey);
      } else if (!event.shiftKey) useGame.getState().setSelection([]);

      // A box dragged out from one of the player's own machines that came up
      // empty leaves that machine selected. The press was deliberate; ending
      // it with nothing selected is how an order given next silently does
      // nothing, which reads as the game ignoring the click.
      if (marqueeFromMech !== null && useGame.getState().selection.length === 0) {
        const kept = before.includes(marqueeFromMech) ? before : [marqueeFromMech];
        useGame.getState().setSelection(kept);
      }

      marqueeFrom = null;
      marqueeScreenFrom = null;
      marqueeFromMech = null;
      engine.selectionBox = null;
      useGame.getState().patch({ marquee: null });
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (battleFinished()) return;
    engine.renderer.camera.zoomAt(
      event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
      pointerToScreen(canvas, event),
      viewport(),
      engine.renderer.groundMesh,
    );
  };

  /**
   * Backstop for browsers that route the secondary click straight to the
   * context menu without a pointerdown carrying button two. If the pointer
   * path already handled this click, the timestamp check swallows it so the
   * order is not given twice.
   */
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const state = useGame.getState();
    if (!state.briefingSeen || battleFinished()) return;
    if (event.timeStamp - orderedAt < 400) return;

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
      engine.orderMove(world, false, { queued: event.shiftKey });
    }
    state.setOrderMode(null);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const state = useGame.getState();
    if (
      shouldIgnoreBattleKey({
        briefingSeen: state.briefingSeen,
        finished: state.finished || engine.world.finished,
        interactiveTarget: isInteractiveKeyTarget(event.target),
        code: event.code,
        repeat: event.repeat,
      })
    ) {
      return;
    }
    engine.audio.unlock();

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
      case 'KeyV':
        engine.useAbilities();
        return;
      case 'KeyX':
        engine.alphaStrike();
        return;
      case 'KeyT':
        engine.toggleHeatSafety();
        return;
      case 'KeyJ':
        state.setOrderMode('jump');
        return;
      case 'Comma':
        engine.nudgeSpeed(-1);
        event.preventDefault();
        break;
      case 'Period':
        engine.nudgeSpeed(1);
        event.preventDefault();
        break;
      case 'KeyP':
        engine.togglePerf();
        break;
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
  const onBlur = (): void => {
    held.clear();
    // Losing the window mid-gesture ends the gesture rather than leaving a
    // marquee open across a tab switch, waiting to select on the way back.
    pressedOnMech = null;
    marqueeFrom = null;
    marqueeScreenFrom = null;
    marqueeFromMech = null;
    panning = false;
    lastPan = null;
    engine.selectionBox = null;
    engine.supportAim = null;
    touchInput.cancelAll();
    useGame.getState().patch({ marquee: null });
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (event.pointerType === 'touch') touchInput.cancel(event.pointerId);
    pressedOnMech = null;
    marqueeFrom = null;
    marqueeScreenFrom = null;
    marqueeFromMech = null;
    panning = false;
    lastPan = null;
    engine.selectionBox = null;
    engine.supportAim = null;
    useGame.getState().patch({ marquee: null });
  };

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

    if (battleFinished()) held.clear();
    if (!battleFinished() && (dx !== 0 || dy !== 0)) {
      const speed = PAN_SPEED * delta * (engine.renderer.camera.distance / 620);
      // Screen-space directions, so the keys keep meaning the same thing on
      // screen after the camera has been swung round.
      engine.renderer.camera.panBy(dx * speed, -dy * speed);
    }

    // Hover and the cursor's ground point, once per frame from wherever the
    // pointer last was. Recomputed when the pointer or the camera has moved,
    // or when the sim has stepped — a mech can walk under a resting cursor.
    // While the map is being panned or a marquee dragged, what is under the
    // pointer is not a question anyone is asking, so it is not answered.
    const busy =
      panning || marqueeFrom !== null || engine.supportAim !== null || touchInput.active;
    if (lastPointer !== null && !busy && !battleFinished()) {
      const camera = engine.renderer.camera;
      const cameraKey = `${camera.target.x}:${camera.target.y}:${camera.distance}`;
      const moved = pointerDirty || cameraKey !== lastCameraKey;
      if (moved) engine.cursorWorld = screenWorld(lastPointer);
      if (moved || engine.world.tick !== lastHoverTick) {
        updateHover(lastPointer);
        lastHoverTick = engine.world.tick;
      }
      pointerDirty = false;
      lastCameraKey = cameraKey;
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
  canvas.addEventListener('pointercancel', onPointerCancel);
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
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
