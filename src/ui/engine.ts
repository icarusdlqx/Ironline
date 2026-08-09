import type { MechLocation } from '../schema/common';
import { loadCatalog } from '../schema/load';
import { Renderer } from '../render3d/scene';
import { restoreIntent } from '../sim/governor';
import {
  isHoldingFire,
  issueAttack,
  issueJump,
  issueMove,
  issueStop,
  setGroupEnabled,
  setHoldFire,
  setPosture,
} from '../sim/orders';
import { callSupport, headingBetween, isDirectional, type SupportCallId } from '../sim/support';
import {
  findEntity,
  isOperational,
  type EntityId,
  type MechEntity,
  type Posture,
  type Vec2,
  type World,
} from '../sim/types';
import { createWorld, stepWorld, toResult, type BattleResult, type LanceEntry } from '../sim/world';
import { attachInput } from './input';
import { snapshotUnits } from './snapshot';
import { useGame, type OrderMode } from './store';

const HUD_INTERVAL_SECONDS = 0.1;
const SMOKE_INTERVAL_SECONDS = 0.7;
const MAX_CATCHUP_STEPS = 5;

export interface EngineOptions {
  missionId?: string;
  seed?: string;
  playerTeam?: number;
  playerLance?: LanceEntry[];
}

export class Engine {
  readonly world: World;
  readonly renderer: Renderer;
  readonly maxTicks: number;

  private running = true;
  private accumulator = 0;
  private lastFrame = 0;
  private hudTimer = 0;
  private smokeTimer = 0;
  private detachInput: (() => void) | null = null;

  constructor(world: World, renderer: Renderer, maxTicks: number) {
    this.world = world;
    this.renderer = renderer;
    this.maxTicks = maxTicks;
  }

  get paused(): boolean {
    return useGame.getState().paused;
  }

  setPaused(paused: boolean): void {
    useGame.getState().patch({ paused });
  }

  togglePause(): void {
    this.setPaused(!this.paused);
  }

  attach(canvas: HTMLCanvasElement): void {
    this.detachInput = attachInput(this, canvas);
  }

  start(): void {
    const frame = (now: number): void => {
      if (!this.running) return;
      const deltaSeconds = this.lastFrame === 0 ? 0 : Math.min(0.25, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.tick(deltaSeconds);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private readonly teardown: (() => void)[] = [];

  /** Extra cleanup the creator wants run when the battle screen goes away. */
  onDestroy(run: () => void): void {
    this.teardown.push(run);
  }

  destroy(): void {
    this.running = false;
    this.detachInput?.();
    for (const run of this.teardown) run();
    this.renderer.destroy();
  }

  // Fixed 20Hz simulation; the renderer interpolates between steps at display rate.
  private tick(deltaSeconds: number): void {
    const state = useGame.getState();

    if (!state.paused && !this.world.finished) {
      this.accumulator += deltaSeconds;
      let steps = 0;
      while (this.accumulator >= this.world.dt && steps < MAX_CATCHUP_STEPS) {
        this.accumulator -= this.world.dt;
        steps += 1;
        this.forceStep();
      }
      if (steps === MAX_CATCHUP_STEPS) this.accumulator = 0;
    }

    this.smokeTimer += deltaSeconds;
    if (this.smokeTimer >= SMOKE_INTERVAL_SECONDS) {
      this.smokeTimer = 0;
      this.emitDamageSmoke();
    }

    const alpha = state.paused ? 1 : Math.min(1, this.accumulator / this.world.dt);
    this.renderer.draw(this.world, alpha, deltaSeconds, {
      selection: new Set(state.selection),
      hovered: null,
      cursor: this.cursorWorld,
      orderMode: state.orderMode,
      selectionBox: this.selectionBox,
      supportRun: this.supportRun(),
    });

    this.hudTimer += deltaSeconds;
    if (this.hudTimer >= HUD_INTERVAL_SECONDS) {
      this.hudTimer = 0;
      this.publish();
    }
  }

  cursorWorld: Vec2 | null = null;
  /** The marquee currently being dragged, in world space. */
  selectionBox: { a: Vec2; b: Vec2 } | null = null;
  /** Aim point and cursor for the run-in the player is drawing, in world space. */
  supportAim: { call: SupportCallId; at: Vec2; to: Vec2 } | null = null;

  /** The footprint to draw for the run-in being dragged, or null when none is. */
  private supportRun(): {
    at: Vec2;
    heading: number;
    length: number;
    width: number;
  } | null {
    const aim = this.supportAim;
    if (aim === null || aim.call !== 'air_strike') return null;
    const config = this.world.rules.support.air_strike;
    return {
      at: aim.at,
      heading: this.headingFor(aim.at, aim.to),
      length: config.length,
      width: config.width,
    };
  }

  /**
   * The run-in the player dragged out. A press with no meaningful drag leaves
   * the aircraft to come in over the lance that called it, which is both the
   * safe default and the one a player would expect without being told.
   */
  private headingFor(at: Vec2, to: Vec2): number {
    const drag = Math.hypot(to.x - at.x, to.y - at.y);
    if (drag >= this.world.terrain.tileSize) return headingBetween(at, to);

    const team = this.world.playerTeam ?? 0;
    let x = 0;
    let y = 0;
    let count = 0;
    for (const entity of this.world.entities) {
      if (entity.team !== team || !isOperational(entity)) continue;
      x += entity.pos.x;
      y += entity.pos.y;
      count += 1;
    }
    if (count === 0) return 0;
    return headingBetween({ x: x / count, y: y / count }, at);
  }

  forceStep(): void {
    if (this.world.finished) return;
    stepWorld(this.world, this.maxTicks);
    this.renderer.snapshot(this.world);
    const events = this.world.events.splice(0, this.world.events.length);
    this.renderer.consumeEvents(this.world, events);
    this.logEvents(events);
  }

  private emitDamageSmoke(): void {
    for (const entity of this.world.entities) {
      if (!isOperational(entity)) continue;
      const damaged = Object.values(entity.locations).some(
        (location) => location.destroyed || location.armour < location.armourMax * 0.35,
      );
      if (!damaged) continue;
      const at = this.renderer.positionOf(entity.id);
      if (at !== null) this.renderer.spawnSmoke(at);
    }
  }

  private logEvents(events: readonly { type: string; [key: string]: unknown }[]): void {
    const push = useGame.getState().pushLog;
    for (const event of events) {
      if (event.type === 'mech_destroyed') {
        const entity = findEntity(this.world, event.entityId as EntityId);
        push(`${entity?.name ?? 'Unit'} destroyed — ${String(event.method)}`);
      } else if (event.type === 'ammo_explosion') {
        const entity = findEntity(this.world, event.entityId as EntityId);
        push(`${entity?.name ?? 'Unit'} ammo detonation in ${String(event.location)}`);
      } else if (event.type === 'shutdown') {
        const entity = findEntity(this.world, event.entityId as EntityId);
        push(`${entity?.name ?? 'Unit'} shut down from heat`);
      } else if (event.type === 'mission_message') {
        push(String(event.text));
      } else if (event.type === 'zone_captured') {
        const zone = this.world.zones.find((entry) => entry.id === event.zoneId);
        push(`${zone?.name ?? 'Zone'} taken by team ${String(event.team)} (+${String(event.resourcePoints)} RP)`);
      } else if (event.type === 'objective_settled') {
        const objective = this.world.objectives.find((entry) => entry.id === event.objectiveId);
        push(`${objective?.label ?? 'Objective'}: ${String(event.status)}`);
      } else if (event.type === 'unit_spawned') {
        push(`${String(event.name)} arrives on the field`);
      } else if (event.type === 'support_resolved') {
        push(`${String(event.call).replace(/_/g, ' ')} on target`);
      } else if (event.type === 'mission_ended') {
        push(`Mission ${String(event.status)} — ${String(event.reason)}`);
      } else if (event.type === 'battle_ended') {
        const winner = event.winner;
        push(winner === null ? 'Battle ended — draw' : `Battle ended — team ${String(winner)} wins`);
      }
    }
  }

  private publish(): void {
    const playerTeam = this.world.playerTeam ?? 0;
    const { units, enemies } = snapshotUnits(this.world, playerTeam);
    const state = useGame.getState();

    const selection = state.selection.filter((id) => {
      const entity = findEntity(this.world, id);
      return entity !== null && isOperational(entity);
    });

    state.patch({
      tick: this.world.tick,
      elapsedSeconds: this.world.tick * this.world.dt,
      finished: this.world.finished,
      winner: this.world.winner,
      units,
      enemies,
      playerTeam,
      resourcePoints: Math.floor(this.world.resources.get(playerTeam) ?? 0),
      reservesLeft: this.world.reserves.length,
      missionStatus: this.world.missionStatus,
      missionReason: this.world.missionReason,
      objectives: this.world.objectives.map((objective) => ({
        id: objective.id,
        label: objective.label,
        required: objective.required,
        status: objective.status,
        progress: objective.progress,
      })),
      zones: this.world.zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        owner: zone.owner,
        contender: zone.contender,
        progress: zone.progress,
        captureSeconds: zone.captureSeconds,
        contested: zone.contested,
      })),
      ...(selection.length === state.selection.length ? {} : { selection }),
    });
  }

  /**
   * What an order applies to. Clicking a hostile can put it in the selection so
   * the player can read its state, and an order must never reach it: without
   * this filter, a right-click on open ground walks the enemy mech there.
   */
  selectedEntities(): EntityId[] {
    const team = this.world.playerTeam ?? 0;
    return useGame
      .getState()
      .selection.filter((id) => findEntity(this.world, id)?.team === team);
  }

  orderMove(to: Vec2, run: boolean): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      issueMove(this.world, entity, to, run);
    }
  }

  /** Fires the jets of whatever is selected and can jump, toward one point. */
  orderJump(to: Vec2): void {
    let fired = 0;
    let asked = 0;
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      asked += 1;
      if (issueJump(this.world, entity, to)) fired += 1;
    }
    if (asked > 0 && fired === 0) useGame.getState().pushLog('No selected mech can jump there.');
  }

  orderAttack(targetId: EntityId, calledShot: MechLocation | null): void {
    let ordered = 0;
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot || entity.id === targetId) continue;
      issueAttack(entity, targetId, calledShot);
      ordered += 1;
    }

    // Say so out loud. A target order that silently does nothing — because
    // nothing was selected, or the click missed — is the single hardest thing
    // to tell apart from a control that is simply broken.
    const target = findEntity(this.world, targetId);
    const push = useGame.getState().pushLog;
    if (ordered === 0) push('No mech selected to give that order to.');
    else if (target !== null) {
      push(`${ordered} mech${ordered === 1 ? '' : 's'} targeting ${target.name}.`);
    }
  }

  /**
   * Sets a standing order on the selection, or clears it if they are all
   * already following it — so the same key both commits and releases.
   */
  setPosture(posture: Posture): void {
    const ids = this.selectedEntities();
    const mechs = ids
      .map((id) => findEntity(this.world, id))
      .filter((entity): entity is MechEntity => entity !== null && !entity.autopilot);
    if (mechs.length === 0) return;

    const already = mechs.every((entity) => entity.posture === posture);
    for (const entity of mechs) setPosture(entity, already ? 'free' : posture);
  }

  orderStop(): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      issueStop(entity);
      entity.orders.attack = null;
    }
  }

  /**
   * Every weapon control reads and writes the pilot's INTENT, never the governor's
   * output. Reading groupEnabled means a mech the governor has throttled reports
   * "not firing", so Hold Fire decides it is already held and arms everything —
   * the control does the opposite of its label at exactly the moment it matters.
   */
  toggleHoldFire(): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      setHoldFire(entity, !isHoldingFire(entity));
    }
  }

  /** Hand heat management back to the player, or take it back. */
  toggleHeatSafety(): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      entity.heatSafety = !entity.heatSafety;
      // Switching the governor off stops it restoring anything, so hand the guns
      // back to whatever the pilot last asked for — not to everything.
      if (!entity.heatSafety) restoreIntent(entity);
    }
  }

  toggleGroup(group: number): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      setGroupEnabled(entity, group, entity.groupIntent[group - 1] !== true);
    }
  }

  setOrderMode(mode: OrderMode): void {
    useGame.getState().setOrderMode(mode);
  }

  /** True when the call needs a run-in dragged out rather than a single point. */
  supportNeedsHeading(call: SupportCallId): boolean {
    return isDirectional(this.world, call);
  }

  callSupport(
    call: SupportCallId,
    target: Vec2,
    /** Where the player dragged to; the aim point itself means "you choose". */
    runTo: Vec2 = target,
  ): { ok: boolean; reason: string | null } {
    const team = this.world.playerTeam ?? 0;
    const result = callSupport(this.world, team, call, target, this.headingFor(target, runTo));
    if (!result.ok && result.reason !== null) useGame.getState().pushLog(result.reason);
    return result;
  }

  result(): BattleResult {
    return toResult(this.world, String(this.world.rng.save().w), this.maxTicks);
  }
}

export async function createEngine(host: HTMLElement, options: EngineOptions = {}): Promise<Engine> {
  const catalog = loadCatalog();
  const missionId = options.missionId ?? 'skirmish_ridge';
  const playerTeam = options.playerTeam ?? 0;

  const world = createWorld(catalog, {
    seed: options.seed ?? 'skirmish',
    missionId,
    playerTeam,
    ...(options.playerLance === undefined ? {} : { playerLance: options.playerLance }),
  });

  const mission = catalog.missions.get(missionId);
  const mapData = catalog.maps.get(mission?.mapId ?? '');
  if (mapData === undefined) throw new Error(`mission "${missionId}" has no map`);

  const renderer = new Renderer(host, world, mapData);
  const engine = new Engine(world, renderer, catalog.rules.simulation.maxBattleTicks);
  engine.attach(renderer.canvas);

  const onResize = (): void => renderer.resize();
  globalThis.addEventListener('resize', onResize);
  engine.onDestroy(() => globalThis.removeEventListener('resize', onResize));

  if (import.meta.env.DEV) {
    (globalThis as unknown as { __ironline?: unknown }).__ironline = { engine, world, useGame };
  }

  useGame.getState().patch({
    ready: true,
    playerTeam,
    missionName: mission?.name ?? missionId,
    briefing: mission?.briefing ?? '',
    briefingSeen: false,
    paused: true,
    supportMode: null,
    heatTiers: catalog.rules.heat.tiers.map((tier) => tier.fraction),
  });
  engine.start();
  return engine;
}
