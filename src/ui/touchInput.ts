import type { MechEntity, Vec2 } from '../sim/types';
import { isOperational } from '../sim/types';
import type { Engine } from './engine';
import { useGame } from './store';
import { TouchGesture } from './touchGesture';

const TAP_SLOP = 10;
const PAN_PER_PIXEL = 0.0022;

interface TouchInputOptions {
  engine: Engine;
  pickAt: (screen: Vec2) => MechEntity | null;
  screenWorld: (screen: Vec2) => Vec2;
  onPinchStart: () => void;
}

/** The phone's camera and order grammar, kept apart from mouse and keyboard state. */
export class TouchInput {
  private readonly gesture = new TouchGesture();
  private pinchFrom: number | null = null;
  private panFrom: Vec2 | null = null;

  constructor(private readonly options: TouchInputOptions) {}

  get active(): boolean {
    return this.gesture.size > 0;
  }

  start(pointerId: number, screen: Vec2, world: Vec2): void {
    const { engine } = this.options;
    const fingers = this.gesture.start(pointerId, screen);
    engine.cursorWorld = world;

    if (fingers >= 2) {
      this.pinchFrom = this.gesture.span();
      this.panFrom = null;
      engine.supportAim = null;
      this.options.onPinchStart();
      return;
    }

    const support = useGame.getState().supportMode;
    if (support !== null && engine.supportNeedsHeading(support)) {
      engine.supportAim = { call: support, at: world, to: world };
      this.panFrom = null;
      return;
    }
    this.panFrom = screen;
  }

  move(pointerId: number, screen: Vec2): void {
    const { engine } = this.options;
    const moved = this.gesture.move(pointerId, screen);
    if (useGame.getState().supportMode !== null) {
      engine.cursorWorld = this.options.screenWorld(screen);
    }

    if (this.gesture.size >= 2) {
      if (this.pinchFrom !== null && this.pinchFrom > 0 && moved.span > 0) {
        engine.renderer.camera.zoomBy(moved.span / this.pinchFrom);
        this.pinchFrom = moved.span;
      }
      return;
    }

    const aim = engine.supportAim;
    if (aim !== null) {
      const to = engine.cursorWorld ?? this.options.screenWorld(screen);
      engine.cursorWorld = to;
      engine.supportAim = { ...aim, to };
      return;
    }

    if (moved.previous === null || this.panFrom === null) return;
    if (Math.hypot(screen.x - this.panFrom.x, screen.y - this.panFrom.y) > TAP_SLOP) {
      this.gesture.consume();
    }
    if (!this.gesture.suppressesTap) return;

    const scale = engine.renderer.camera.distance * PAN_PER_PIXEL;
    engine.renderer.camera.panBy(
      (moved.previous.x - screen.x) * scale,
      (screen.y - moved.previous.y) * scale,
    );
  }

  finish(pointerId: number, fallback: Vec2): void {
    const { engine } = this.options;
    const ended = this.gesture.finish(pointerId, fallback);
    if (this.gesture.size < 2) this.pinchFrom = null;
    this.panFrom = null;
    if (!ended.commitTap) {
      engine.supportAim = null;
      return;
    }

    const state = useGame.getState();
    const world = this.options.screenWorld(ended.point);
    const aim = engine.supportAim;
    if (aim !== null) {
      engine.supportAim = null;
      const result = engine.callSupport(aim.call, aim.at, aim.to);
      if (result.ok) state.setSupportMode(null);
      return;
    }

    if (state.supportMode !== null) {
      const result = engine.callSupport(state.supportMode, world);
      if (result.ok) state.setSupportMode(null);
      return;
    }

    const picked = this.options.pickAt(ended.point);
    if (state.orderMode !== null) {
      if (state.orderMode === 'move' || state.orderMode === 'run') {
        engine.orderMove(world, state.orderMode === 'run', { queued: state.queueOrders });
      } else if (state.orderMode === 'attack_move') {
        engine.orderMove(world, false, { engage: true, queued: state.queueOrders });
      } else if (state.orderMode === 'jump') {
        engine.orderJump(world);
      } else {
        if (picked === null || picked.team === state.playerTeam || !isOperational(picked)) return;
        engine.orderAttack(
          picked.id,
          state.orderMode === 'called_shot' ? state.calledShotLocation : null,
        );
      }
      const routeMode =
        state.orderMode === 'move' || state.orderMode === 'run' || state.orderMode === 'attack_move';
      if (!state.queueOrders || !routeMode) state.setOrderMode(null);
      return;
    }

    if (picked === null) {
      if (engine.selectedEntities().length > 0) {
        engine.orderMove(world, false, { queued: state.queueOrders });
      }
      return;
    }
    if (picked.team !== state.playerTeam && isOperational(picked)) {
      if (engine.selectedEntities().length > 0) engine.orderAttack(picked.id, null);
      else state.setSelection([picked.id]);
      return;
    }
    engine.audio.select();
    state.setSelection([picked.id]);
  }

  cancel(pointerId: number): void {
    this.gesture.cancel(pointerId);
    if (this.gesture.size < 2) this.pinchFrom = null;
    this.panFrom = null;
    this.options.engine.supportAim = null;
  }

  cancelAll(): void {
    this.gesture.reset();
    this.pinchFrom = null;
    this.panFrom = null;
    this.options.engine.supportAim = null;
  }
}
