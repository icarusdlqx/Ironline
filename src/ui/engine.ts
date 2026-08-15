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
import { AudioDirector } from './audio';
import { hitPreview } from '../sim/preview';
import { snapshotUnits } from './snapshot';
import { useGame, type HitPreviewView, type OrderMode } from './store';

const HUD_INTERVAL_SECONDS = 0.1;
const SMOKE_INTERVAL_SECONDS = 0.7;
const MAX_CATCHUP_STEPS = 5;

export interface EngineOptions {
  missionId?: string;
  seed?: string;
  playerTeam?: number;
  playerLance?: LanceEntry[];
  /** Difficulty tier id from the rules; the sim default when absent. */
  difficulty?: string;
}

export class Engine {
  readonly world: World;
  readonly renderer: Renderer;
  readonly maxTicks: number;
  /** Every sound in the battle. Silent until the first user gesture unlocks it. */
  readonly audio = new AudioDirector();

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

  /** The rates on offer. Walking to the fight should cost patience, not time. */
  static readonly SPEEDS = [1, 2, 4] as const;

  setSpeed(speed: number): void {
    if (!Engine.SPEEDS.includes(speed as 1 | 2 | 4)) return;
    useGame.getState().patch({ speed, paused: false });
  }

  /** Steps along 1× → 2× → 4×, clamped at the ends rather than wrapping. */
  nudgeSpeed(direction: 1 | -1): void {
    const current = useGame.getState().speed;
    const at = Engine.SPEEDS.findIndex((speed) => speed >= current);
    const index = Math.max(0, Math.min(Engine.SPEEDS.length - 1, (at === -1 ? 0 : at) + direction));
    this.setSpeed(Engine.SPEEDS[index] ?? 1);
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
    this.audio.stopAmbient();
    this.detachInput?.();
    for (const run of this.teardown) run();
    this.renderer.destroy();
  }

  // Fixed 20Hz simulation; the renderer interpolates between steps at display rate.
  private tick(deltaSeconds: number): void {
    const state = useGame.getState();

    if (!state.paused && !this.world.finished) {
      // Fast-forward stretches how much battle each real second buys. The sim
      // still steps at its fixed rate — determinism never rides on the clock.
      this.accumulator += deltaSeconds * state.speed;
      // The step cap is the spiral-of-death guard: a frame that cannot keep up
      // must shed sim time rather than fall further behind forever. It has to
      // scale with the chosen speed, though, or a slow display quietly caps
      // fast-forward at whatever rate the guard was tuned for at 1×.
      const cap = MAX_CATCHUP_STEPS * state.speed;
      let steps = 0;
      while (this.accumulator >= this.world.dt && steps < cap) {
        this.accumulator -= this.world.dt;
        steps += 1;
        this.forceStep();
      }
      if (steps >= cap) this.accumulator = 0;
    }

    this.smokeTimer += deltaSeconds;
    if (this.smokeTimer >= SMOKE_INTERVAL_SECONDS) {
      this.smokeTimer = 0;
      this.emitDamageSmoke();
    }

    const alpha = state.paused ? 1 : Math.min(1, this.accumulator / this.world.dt);
    this.renderer.draw(this.world, alpha, deltaSeconds, {
      selection: new Set(state.selection),
      hovered: this.hoveredId,
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
  /**
   * The mech under the pointer. Drawn as a ring, so the player can see what the
   * game thinks they are pointing at before they commit to a click — which is
   * the difference between "this control is broken" and "I missed".
   */
  hoveredId: EntityId | null = null;
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
    this.audio.listenAt = this.renderer.camera.target;
    this.audio.consume(this.world, events);
    this.logEvents(events);
  }

  private emitDamageSmoke(): void {
    for (const entity of this.world.entities) {
      if (!isOperational(entity)) continue;
      // Front and back together, so a mech stripped from behind smokes too.
      const damaged = Object.values(entity.locations).some(
        (location) =>
          location.destroyed ||
          location.armour + location.rearArmour <
            (location.armourMax + location.rearArmourMax) * 0.35,
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
      } else if (event.type === 'critical_hit') {
        const entity = findEntity(this.world, event.entityId as EntityId);
        const where = String(event.location).replace(/_/g, ' ');
        const wrecked = event.component === null ? null : String(event.component);
        push(
          wrecked === null
            ? `Critical hit on ${entity?.name ?? 'Unit'} — ${where}`
            : `Critical hit on ${entity?.name ?? 'Unit'} — ${where} ${wrecked} wrecked`,
        );
      } else if (event.type === 'location_destroyed') {
        const entity = findEntity(this.world, event.entityId as EntityId);
        const where = String(event.location).replace(/_/g, ' ');
        push(`${entity?.name ?? 'Unit'} lost its ${where}`);
      } else if (event.type === 'shutdown') {
        const entity = findEntity(this.world, event.entityId as EntityId);
        push(`${entity?.name ?? 'Unit'} shut down from heat`);
      } else if (event.type === 'knocked_down') {
        const entity = findEntity(this.world, event.entityId as EntityId);
        push(`${entity?.name ?? 'Unit'} goes down`);
      } else if (event.type === 'stood_up') {
        const entity = findEntity(this.world, event.entityId as EntityId);
        push(`${entity?.name ?? 'Unit'} back on its feet`);
      } else if (event.type === 'pilot_injured') {
        const entity = findEntity(this.world, event.entityId as EntityId);
        push(`${entity?.pilot.name ?? 'Pilot'} hurt in the fall`);
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

  /** Every hostile the lance has ever laid eyes on, for the new-contact brake. */
  private readonly sighted = new Set<EntityId>();
  private contactsSeeded = false;

  /**
   * Drops fast-forward the moment a hostile nobody has seen before appears.
   * Mechs blink in and out of sensor shadow all battle, so re-acquiring an old
   * contact is not news — only a machine this lance has never laid eyes on
   * pulls the clock back to 1×. Whatever was already visible at the drop is
   * seeded silently: the opening of a mirror match is not a surprise.
   */
  private brakeOnNewContact(enemies: readonly { id: EntityId }[]): void {
    if (!this.contactsSeeded) {
      this.contactsSeeded = true;
      for (const enemy of enemies) this.sighted.add(enemy.id);
      return;
    }
    let fresh = false;
    for (const enemy of enemies) {
      if (this.sighted.has(enemy.id)) continue;
      this.sighted.add(enemy.id);
      fresh = true;
    }
    const state = useGame.getState();
    if (fresh && state.speed > 1) {
      state.patch({ speed: 1 });
      state.pushLog('New contact — speed back to 1×.');
    }
  }

  /** The to-hit readout: primary selection priced against cursor or target. */
  private previewFor(selection: readonly EntityId[]): HitPreviewView | null {
    const shooterId = selection.find(
      (id) => findEntity(this.world, id)?.team === (this.world.playerTeam ?? 0),
    );
    const shooter = shooterId === undefined ? null : findEntity(this.world, shooterId);
    if (shooter === null || !isOperational(shooter)) return null;

    const hoveredEntity = this.hoveredId === null ? null : findEntity(this.world, this.hoveredId);
    const hovered =
      hoveredEntity !== null && hoveredEntity.team !== shooter.team && isOperational(hoveredEntity)
        ? hoveredEntity
        : null;
    const target = hovered ?? findEntity(this.world, shooter.targetId);
    if (target === null) return null;

    const preview = hitPreview(this.world, shooter, target);
    if (preview === null) return null;

    return {
      shooterId: shooter.id,
      targetId: target.id,
      targetName: target.name,
      range: preview.range,
      hover: hovered !== null,
      weapons: preview.weapons.map((weapon) => ({
        index: weapon.index,
        chance: weapon.chance,
        blocked: weapon.blocked,
      })),
      factors: preview.factors,
    };
  }

  private publish(): void {
    const playerTeam = this.world.playerTeam ?? 0;
    const { units, enemies } = snapshotUnits(this.world, playerTeam);
    const state = useGame.getState();

    this.brakeOnNewContact(enemies);

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
      hitPreview: this.previewFor(selection),
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

  orderMove(
    to: Vec2,
    run: boolean,
    options: { engage?: boolean; queued?: boolean } = {},
  ): void {
    let moved = 0;
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      // A queued leg keeps the pace of the order it extends.
      const pace = options.queued === true ? (entity.orders.move?.run ?? run) : run;
      issueMove(this.world, entity, to, pace, options);
      moved += 1;
    }
    if (moved > 0) this.audio.order();
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
      this.audio.order();
      push(`${ordered} mech${ordered === 1 ? '' : 's'} targeting ${target.name}.`);
    }
  }

  /**
   * Puts the selection onto the nearest hostile anyone can see.
   *
   * A keyboard route to a target matters more than it looks. Clicking a mech
   * is the natural way to pick one, and when that fails — a trackpad, an odd
   * browser, a machine that is four pixels tall at this zoom — there has to be
   * a way to fight that does not involve hitting anything with a pointer.
   */
  targetNearest(): void {
    const ids = this.selectedEntities();
    const anchor = findEntity(this.world, ids[0] ?? null);
    if (anchor === null) {
      useGame.getState().pushLog('No mech selected to give that order to.');
      return;
    }

    let best: MechEntity | null = null;
    let bestRange = Infinity;
    for (const entity of this.world.entities) {
      if (entity.team === anchor.team || !isOperational(entity)) continue;
      if (this.world.vision !== null && !this.world.vision.visible.has(entity.id)) continue;
      const range = Math.hypot(entity.pos.x - anchor.pos.x, entity.pos.y - anchor.pos.y);
      if (range >= bestRange) continue;
      best = entity;
      bestRange = range;
    }

    if (best === null) {
      useGame.getState().pushLog('Nothing hostile on sensors.');
      return;
    }
    this.orderAttack(best.id, null);
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
    ...(options.difficulty === undefined ? {} : { difficulty: options.difficulty }),
  });

  const mission = catalog.missions.get(missionId);
  const mapData = catalog.maps.get(mission?.mapId ?? '');
  if (mapData === undefined) throw new Error(`mission "${missionId}" has no map`);

  // The mission's own choice first, then the map's, then the default rig — so a
  // night raid overrides the ground it borrows without touching the map file.
  const atmosphereId = mission?.atmosphereId ?? mapData.atmosphereId;
  const atmosphere = catalog.atmospheres.get(atmosphereId);
  if (atmosphere === undefined) throw new Error(`unknown atmosphere "${atmosphereId}"`);

  const renderer = new Renderer(host, world, mapData, atmosphere);
  const engine = new Engine(world, renderer, catalog.rules.simulation.maxBattleTicks);
  renderer.onFootfall = (at, tonnage) => engine.audio.footfall(at, tonnage);
  engine.audio.setAmbient(atmosphereId);
  engine.attach(renderer.canvas);

  const onResize = (): void => renderer.resize();
  globalThis.addEventListener('resize', onResize);
  engine.onDestroy(() => globalThis.removeEventListener('resize', onResize));

  // A handle on the running battle from the browser console. Kept in the built
  // game as well as in development: this is a single-player game with nothing
  // to cheat at but yourself, and it is the only way to tell a control that is
  // broken apart from a control that is working on something else.
  (globalThis as unknown as { __ironline?: unknown }).__ironline = { engine, world, useGame };

  useGame.getState().patch({
    ready: true,
    playerTeam,
    missionName: mission?.name ?? missionId,
    briefing: mission?.briefing ?? '',
    briefingSeen: false,
    paused: true,
    speed: 1,
    hitPreview: null,
    supportMode: null,
    heatTiers: catalog.rules.heat.tiers.map((tier) => tier.fraction),
  });
  engine.start();
  return engine;
}
