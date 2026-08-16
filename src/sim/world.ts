import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Design } from '../schema/design';
import type { Catalog } from '../schema/load';
import type { Pilot } from '../schema/pilot';
import { decideBaseline } from './ai/baseline';
import { buildFrameArcTables } from './arcs';
import { difficultyTier, resolveDisengagement, runTeamAi } from './ai/tactical';
import { separateBodies } from './collision';
import { resolveProjectiles, updateWeapons } from './combat';
import { createMech, type LocationDamage } from './entity';
import { emit } from './events';
import { updateDesignation } from './designation';
import { updateHeat } from './heat';
import { createObjectives, evaluateMission, updateObjectives } from './objectives';
import { createSupportState, updateSupport } from './support';
import { createTriggers, updateTriggers } from './triggers';
import { createZones, updateZones } from './zones';
import { updateMovement, updateTorso } from './movement';
import { updatePlayerControl } from './orders';
import { createRng, type RngSeed } from './rng';
import { updateStability } from './stability';
import { createVision, updateVision } from './sensors';
import { createTerrainGrid } from './terrain';
import { isOperational, type MechEntity, type World } from './types';

export interface LanceEntry {
  design: Design;
  pilot: Pilot;
  damage?: Partial<Record<MechLocation, LocationDamage>>;
}

export type ControllerId = 'orders' | 'tactical' | 'baseline';

export interface WorldOptions {
  seed: RngSeed;
  missionId: string;
  maxTicks?: number;
  playerTeam?: number;
  /** Replaces the mission's own player lance with campaign mechs and pilots. */
  playerLance?: LanceEntry[];
  /** How the player's own lance is driven when nobody is at the controls. */
  playerController?: ControllerId;
  /** Which side each opposing lance is driven by, and how well. */
  enemyController?: ControllerId;
  difficulty?: string;
}

export interface UnitCondition {
  armour: number;
  rearArmour: number;
  internal: number;
  destroyed: boolean;
}

export interface UnitResult {
  id: number;
  team: number;
  name: string;
  designId: string;
  pilotId: string;
  alive: boolean;
  killMethod: string | null;
  pilotDead: boolean;
  /** Knocks the pilot took in the field. They ride home as infirmary days. */
  pilotWounds: number;
  pilotEjected: boolean;
  withdrew: boolean;
  legged: boolean;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
  ammoSpent: number;
  heatPeak: number;
  kills: number;
  condition: Record<MechLocation, UnitCondition>;
}

export interface ObjectiveResult {
  id: string;
  label: string;
  required: boolean;
  status: string;
  progress: number;
}

export interface BattleResult {
  seed: RngSeed;
  missionId: string;
  missionStatus: 'active' | 'success' | 'failure';
  missionReason: string | null;
  objectives: ObjectiveResult[];
  ticks: number;
  durationSeconds: number;
  winner: number | null;
  decided: boolean;
  units: UnitResult[];
  weapons: { weaponId: string; shots: number; hits: number; damage: number; heat: number }[];
}

function clampSkill(value: number): number {
  return Math.max(1, Math.min(5, value));
}

export function createWorld(catalog: Catalog, options: WorldOptions): World {
  const mission = catalog.missions.get(options.missionId);
  if (mission === undefined) throw new Error(`unknown mission "${options.missionId}"`);

  const mapData = catalog.maps.get(mission.mapId);
  if (mapData === undefined) throw new Error(`unknown map "${mission.mapId}"`);

  const playerTeam = options.playerTeam ?? null;
  const playerController = options.playerController ?? 'orders';
  const enemyController = options.enemyController ?? 'tactical';
  const tier = catalog.rules.difficulty.tiers[
    options.difficulty ?? catalog.rules.difficulty.default
  ];
  const entities: MechEntity[] = [];
  let nextId = 1;

  for (const lance of mission.lances) {
    const override = lance.team === playerTeam ? options.playerLance : undefined;
    // The drop is sized by tonnage, not by how many berths the mission author
    // happened to draw: a lance bigger than the authored one fans its extra
    // machines out beside the authored spawn points.
    const slots =
      override === undefined
        ? lance.units
        : override.map((_, index) => {
            const authored = lance.units[index];
            if (authored !== undefined) return authored;
            const anchor = lance.units[index % Math.max(1, lance.units.length)];
            if (anchor === undefined) throw new Error('a lance cannot spawn with no units');
            const extra = index - lance.units.length + 1;
            return {
              ...anchor,
              spawn: {
                x: anchor.spawn.x + 16 * extra * (index % 2 === 0 ? 1 : -1),
                y: anchor.spawn.y + 12 * extra,
              },
            };
          });

    slots.forEach((unit, index) => {
      const entry = override?.[index];
      entities.push(
        createMech(catalog, catalog.rules, {
          id: nextId,
          team: lance.team,
          designId: entry?.design.id ?? unit.designId,
          pilotId: entry?.pilot.id ?? unit.pilotId,
          spawn: unit.spawn,
          facingDegrees: unit.facingDegrees,
          autopilot: lance.team !== playerTeam,
          controller: lance.team === playerTeam ? playerController : enemyController,
          ...(entry === undefined ? {} : { design: entry.design, pilot: entry.pilot }),
          ...(entry?.damage === undefined ? {} : { damage: entry.damage }),
        }),
      );
      nextId += 1;
    });
  }

  if (options.playerLance !== undefined && options.playerLance.length === 0) {
    throw new Error('a player lance must contain at least one mech');
  }

  // Difficulty adjusts who the enemy are, never how much punishment they soak.
  if (tier !== undefined && tier.skillDelta !== 0) {
    for (const entity of entities) {
      if (entity.team === playerTeam) continue;
      entity.pilot.gunnery = clampSkill(entity.pilot.gunnery + tier.skillDelta);
      entity.pilot.piloting = clampSkill(entity.pilot.piloting + tier.skillDelta);
      entity.pilot.sensors = clampSkill(entity.pilot.sensors + tier.skillDelta);
    }
  }

  const hitLocationTable = LOCATIONS.map((location: MechLocation) => ({
    value: location,
    weight: catalog.rules.combat.hitLocationWeights[location],
  })).filter((entry) => entry.weight > 0);

  const world: World = {
    tick: 0,
    dt: 1 / catalog.rules.simulation.tickRate,
    rng: createRng(options.seed),
    catalog,
    rules: catalog.rules,
    terrain: createTerrainGrid(mapData, catalog.rules.terrain),
    mission,
    entities,
    projectiles: [],
    events: [],
    hitLocationTable,
    arcHitTables: buildFrameArcTables(catalog.rules),
    weaponStats: new Map(),
    playerTeam,
    vision: null,

    resources: new Map(
      mission.lances.map((lance) => [lance.team, mission.startingResourcePoints]),
    ),
    zones: createZones(mission.zones),
    objectives: createObjectives(mission.objectives),
    triggers: createTriggers(mission.triggers),
    support: createSupportState(),
    reveals: [],
    reserves: mission.reserves.map((unit) => ({
      designId: unit.designId,
      pilotId: unit.pilotId,
      facingDegrees: unit.facingDegrees,
    })),
    missionStatus: 'active',
    missionReason: null,
    difficulty: options.difficulty ?? catalog.rules.difficulty.default,

    finished: false,
    winner: null,
  };

  if (playerTeam !== null) {
    world.vision = createVision(world, playerTeam);
    updateVision(world, world.vision);
  }

  return world;
}

function teamsWithSurvivors(world: World): number[] {
  const teams = new Set<number>();
  for (const entity of world.entities) {
    if (isOperational(entity)) teams.add(entity.team);
  }
  return [...teams].sort((a, b) => a - b);
}

function finish(world: World, winner: number | null): void {
  world.finished = true;
  world.winner = winner;
  emit(world.events, { type: 'battle_ended', tick: world.tick, winner });
}

function checkBattleEnd(world: World, maxTicks: number): void {
  const timedOut = world.tick >= maxTicks;

  if (world.objectives.length > 0) {
    const playerTeam = world.playerTeam ?? 0;
    const verdict = evaluateMission(world, playerTeam, timedOut);

    if (verdict.status !== 'active') {
      world.missionStatus = verdict.status;
      world.missionReason = verdict.reason;
      emit(world.events, {
        type: 'mission_ended',
        tick: world.tick,
        status: verdict.status,
        reason: verdict.reason ?? '',
      });
      if (verdict.status === 'success') {
        finish(world, playerTeam);
      } else {
        // A failed mission still has a victor if exactly one other side is left.
        const others = teamsWithSurvivors(world).filter((team) => team !== playerTeam);
        finish(world, others.length === 1 ? (others[0] ?? null) : null);
      }
      return;
    }

    if (!timedOut) return;
  }

  const survivors = teamsWithSurvivors(world);

  if (survivors.length <= 1) {
    finish(world, survivors[0] ?? null);
    return;
  }

  if (world.tick < maxTicks) return;

  const counts = new Map<number, number>();
  for (const entity of world.entities) {
    if (isOperational(entity)) counts.set(entity.team, (counts.get(entity.team) ?? 0) + 1);
  }

  let leader: number | null = null;
  let best = -1;
  let tied = false;
  for (const team of survivors) {
    const count = counts.get(team) ?? 0;
    if (count > best) {
      best = count;
      leader = team;
      tied = false;
    } else if (count === best) {
      tied = true;
    }
  }

  finish(world, tied ? null : leader);
}

export function stepWorld(world: World, maxTicks: number): void {
  if (world.finished) return;

  world.tick += 1;

  for (const entity of world.entities) updateHeat(world, entity);
  // Before the AI decides, so a mech that stands up this tick can act on it.
  for (const entity of world.entities) updateStability(world, entity);

  if (world.vision !== null) updateVision(world, world.vision);

  if ((world.tick - 1) % world.rules.simulation.aiDecisionIntervalTicks === 0) {
    const tier = difficultyTier(world, world.difficulty);

    for (const team of new Set(world.entities.map((entity) => entity.team))) {
      runTeamAi(world, team, tier);
    }

    for (const entity of world.entities) {
      if (entity.controller === 'baseline') decideBaseline(world, entity);
      else if (entity.controller === 'orders') updatePlayerControl(world, entity);
    }
  }

  updateDesignation(world);

  for (const entity of world.entities) updateMovement(world, entity);
  // After everything has moved, so contact is resolved against where the mechs
  // ended the tick rather than against a half-updated field.
  separateBodies(world);
  for (const entity of world.entities) updateTorso(world, entity);
  for (const entity of world.entities) updateWeapons(world, entity);

  resolveProjectiles(world);
  resolveDisengagement(world);
  updateSupport(world);
  updateZones(world);
  updateObjectives(world);
  updateTriggers(world);
  checkBattleEnd(world, maxTicks);
}

export function toResult(world: World, seed: RngSeed, maxTicks: number): BattleResult {
  return {
    seed,
    missionId: world.mission.id,
    missionStatus: world.missionStatus,
    missionReason: world.missionReason,
    objectives: world.objectives.map((objective) => ({
      id: objective.id,
      label: objective.label,
      required: objective.required,
      status: objective.status,
      progress: objective.progress,
    })),
    ticks: world.tick,
    durationSeconds: world.tick * world.dt,
    winner: world.winner,
    decided: world.finished && world.tick < maxTicks,
    units: world.entities.map((entity) => ({
      id: entity.id,
      team: entity.team,
      name: entity.name,
      designId: entity.designId,
      pilotId: entity.pilot.id,
      alive: isOperational(entity),
      killMethod: entity.killMethod,
      pilotDead: entity.pilot.dead,
      pilotWounds: entity.pilot.wounds,
      pilotEjected: entity.pilot.ejected,
      withdrew: entity.withdrawn,
      legged: entity.locations.left_leg.destroyed && entity.locations.right_leg.destroyed,
      damageDealt: entity.stats.damageDealt,
      damageTaken: entity.stats.damageTaken,
      shotsFired: entity.stats.shotsFired,
      shotsHit: entity.stats.shotsHit,
      ammoSpent: entity.stats.ammoSpent,
      heatPeak: entity.stats.heatPeak,
      kills: entity.stats.kills,
      condition: Object.fromEntries(
        LOCATIONS.map((location) => [
          location,
          {
            armour: entity.locations[location].armour,
            rearArmour: entity.locations[location].rearArmour,
            internal: entity.locations[location].internal,
            destroyed: entity.locations[location].destroyed,
          },
        ]),
      ) as Record<MechLocation, UnitCondition>,
    })),
    weapons: [...world.weaponStats.entries()]
      .map(([weaponId, stat]) => ({ weaponId, ...stat }))
      .sort((a, b) => a.weaponId.localeCompare(b.weaponId)),
  };
}

export function runBattle(catalog: Catalog, options: WorldOptions): BattleResult {
  const world = createWorld(catalog, options);
  const maxTicks = options.maxTicks ?? catalog.rules.simulation.maxBattleTicks;

  while (!world.finished && world.tick < maxTicks) {
    stepWorld(world, maxTicks);
    world.events.length = 0;
  }

  return toResult(world, options.seed, maxTicks);
}
