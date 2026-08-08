import { Application } from 'pixi.js';
import type { MechLocation } from '../schema/common';
import { loadCatalog } from '../schema/load';
import { Renderer } from '../render/scene';
import { issueAttack, issueMove, issueStop, setGroupEnabled, setHoldFire } from '../sim/orders';
import { callSupport, type SupportCallId } from '../sim/support';
import { findEntity, isOperational, type EntityId, type Vec2, type World } from '../sim/types';
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
  readonly app: Application;
  readonly maxTicks: number;

  private running = true;
  private accumulator = 0;
  private lastFrame = 0;
  private hudTimer = 0;
  private smokeTimer = 0;
  private detachInput: (() => void) | null = null;

  constructor(app: Application, world: World, renderer: Renderer, maxTicks: number) {
    this.app = app;
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

  destroy(): void {
    this.running = false;
    this.detachInput?.();
    this.app.destroy(true, { children: true });
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
    });

    this.hudTimer += deltaSeconds;
    if (this.hudTimer >= HUD_INTERVAL_SECONDS) {
      this.hudTimer = 0;
      this.publish();
    }
  }

  cursorWorld: Vec2 | null = null;

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

  selectedEntities(): EntityId[] {
    return useGame.getState().selection;
  }

  orderMove(to: Vec2, run: boolean): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      issueMove(this.world, entity, to, run);
    }
  }

  orderAttack(targetId: EntityId, calledShot: MechLocation | null): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot || entity.id === targetId) continue;
      issueAttack(entity, targetId, calledShot);
    }
  }

  orderStop(): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      issueStop(entity);
      entity.orders.attack = null;
    }
  }

  toggleHoldFire(): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      setHoldFire(entity, entity.groupEnabled.some((enabled) => enabled));
    }
  }

  toggleGroup(group: number): void {
    for (const id of this.selectedEntities()) {
      const entity = findEntity(this.world, id);
      if (entity === null || entity.autopilot) continue;
      setGroupEnabled(entity, group, entity.groupEnabled[group - 1] !== true);
    }
  }

  setOrderMode(mode: OrderMode): void {
    useGame.getState().setOrderMode(mode);
  }

  callSupport(call: SupportCallId, target: Vec2): { ok: boolean; reason: string | null } {
    const team = this.world.playerTeam ?? 0;
    const heading = this.cursorWorld === null ? 0 : 0;
    const result = callSupport(this.world, team, call, target, heading);
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

  const app = new Application();
  await app.init({
    background: 0x0d1013,
    resizeTo: host,
    antialias: true,
    preference: 'webgl',
  });

  host.appendChild(app.canvas);

  const renderer = new Renderer(app, world, mapData);
  const engine = new Engine(app, world, renderer, catalog.rules.simulation.maxBattleTicks);
  engine.attach(app.canvas);

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
