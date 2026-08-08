import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Design } from '../schema/design';
import type { Catalog } from '../schema/load';
import type { Pilot } from '../schema/pilot';
import { runBasicAi } from './ai/basic';
import { resolveProjectiles, updateWeapons } from './combat';
import { createMech, type LocationDamage } from './entity';
import { emit } from './events';
import { updateHeat } from './heat';
import { updateMovement } from './movement';
import { updatePlayerControl } from './orders';
import { createRng, type RngSeed } from './rng';
import { createVision, updateVision } from './sensors';
import { createTerrainGrid } from './terrain';
import { isOperational, type MechEntity, type World } from './types';

export interface LanceEntry {
  design: Design;
  pilot: Pilot;
  damage?: Partial<Record<MechLocation, LocationDamage>>;
}

export interface WorldOptions {
  seed: RngSeed;
  missionId: string;
  maxTicks?: number;
  playerTeam?: number;
  /** Replaces the mission's own player lance with campaign mechs and pilots. */
  playerLance?: LanceEntry[];
}

export interface UnitCondition {
  armour: number;
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
  pilotEjected: boolean;
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

export interface BattleResult {
  seed: RngSeed;
  missionId: string;
  ticks: number;
  durationSeconds: number;
  winner: number | null;
  decided: boolean;
  units: UnitResult[];
  weapons: { weaponId: string; shots: number; hits: number; damage: number; heat: number }[];
}

export function createWorld(catalog: Catalog, options: WorldOptions): World {
  const mission = catalog.missions.get(options.missionId);
  if (mission === undefined) throw new Error(`unknown mission "${options.missionId}"`);

  const mapData = catalog.maps.get(mission.mapId);
  if (mapData === undefined) throw new Error(`unknown map "${mission.mapId}"`);

  const playerTeam = options.playerTeam ?? null;
  const entities: MechEntity[] = [];
  let nextId = 1;

  for (const lance of mission.lances) {
    const override = lance.team === playerTeam ? options.playerLance : undefined;
    const slots = override === undefined ? lance.units : lance.units.slice(0, override.length);

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
    weaponStats: new Map(),
    playerTeam,
    vision: null,
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

  if (world.vision !== null) updateVision(world, world.vision);

  if ((world.tick - 1) % world.rules.simulation.aiDecisionIntervalTicks === 0) {
    for (const entity of world.entities) {
      if (entity.autopilot) runBasicAi(world, entity);
      else updatePlayerControl(world, entity);
    }
  }

  for (const entity of world.entities) updateMovement(world, entity);
  for (const entity of world.entities) updateWeapons(world, entity);

  resolveProjectiles(world);
  checkBattleEnd(world, maxTicks);
}

export function toResult(world: World, seed: RngSeed, maxTicks: number): BattleResult {
  return {
    seed,
    missionId: world.mission.id,
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
      pilotEjected: entity.pilot.ejected,
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
