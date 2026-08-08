import type { MechLocation } from '../schema/common';
import type { Catalog } from '../schema/load';
import type { Mission } from '../schema/mission';
import type { Rules } from '../schema/rules';
import type { SimEvent } from './events';
import type { ObjectiveState } from './objectives';
import type { OrderState } from './orders';
import type { Rng } from './rng';
import type { TeamVision } from './sensors';
import type { Reveal, SupportState } from './support';
import type { TerrainGrid } from './terrain';
import type { TriggerState } from './triggers';
import type { ZoneState } from './zones';

export type EntityId = number;

export interface Vec2 {
  x: number;
  y: number;
}

export type MotionState = 'stationary' | 'walk' | 'run' | 'jump';

export type KillMethod = 'centre_torso' | 'head' | 'ammo_explosion';

export interface LocationState {
  armour: number;
  armourMax: number;
  internal: number;
  internalMax: number;
  destroyed: boolean;
}

export const WEAPON_GROUPS = 4;

export interface WeaponMount {
  index: number;
  weaponId: string;
  location: MechLocation;
  group: number;
  cooldown: number;
  destroyed: boolean;
}

export interface AmmoBin {
  index: number;
  weaponId: string;
  location: MechLocation;
  rounds: number;
  roundsMax: number;
  protectedByCase: boolean;
  destroyed: boolean;
}

export interface PilotState {
  id: string;
  name: string;
  gunnery: number;
  piloting: number;
  sensors: number;
  dead: boolean;
  ejected: boolean;
}

export interface UnitStats {
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
  ammoSpent: number;
  heatPeak: number;
  kills: number;
}

export interface MechEntity {
  id: EntityId;
  team: number;
  name: string;
  designId: string;
  chassisId: string;
  tonnage: number;
  pilot: PilotState;

  pos: Vec2;
  facing: number;
  motion: MotionState;
  walkSpeed: number;
  runSpeed: number;
  turnRate: number;

  locations: Record<MechLocation, LocationState>;
  weapons: WeaponMount[];
  ammoBins: AmmoBin[];

  heat: number;
  heatCapacity: number;
  heatSinks: number;
  dissipationPerSecond: number;
  shutdownRemaining: number;

  incomingAccuracyFactor: number;
  outgoingAccuracyFactor: number;
  destroyed: boolean;
  killMethod: KillMethod | null;

  autopilot: boolean;
  orders: OrderState;
  groupEnabled: boolean[];
  sensorRange: number;

  targetId: EntityId | null;
  calledShot: MechLocation | null;
  path: Vec2[];
  pathIndex: number;
  nextPathTick: number;

  stats: UnitStats;
}

export interface Projectile {
  shooterId: EntityId;
  targetId: EntityId;
  weaponId: string;
  hit: boolean;
  location: MechLocation;
  damage: number;
  impactTick: number;
}

export interface WeaponStat {
  shots: number;
  hits: number;
  damage: number;
  heat: number;
}

export interface World {
  tick: number;
  dt: number;
  rng: Rng;
  catalog: Catalog;
  rules: Rules;
  terrain: TerrainGrid;
  mission: Mission;
  entities: MechEntity[];
  projectiles: Projectile[];
  events: SimEvent[];
  hitLocationTable: readonly { value: MechLocation; weight: number }[];
  weaponStats: Map<string, WeaponStat>;
  playerTeam: number | null;
  vision: TeamVision | null;

  resources: Map<number, number>;
  zones: ZoneState[];
  objectives: ObjectiveState[];
  triggers: TriggerState[];
  support: SupportState;
  reveals: Reveal[];
  reserves: { designId: string; pilotId: string; facingDegrees: number }[];
  missionStatus: 'active' | 'success' | 'failure';
  missionReason: string | null;

  finished: boolean;
  winner: number | null;
}

export function isOperational(entity: MechEntity): boolean {
  return !entity.destroyed && !entity.pilot.dead && !entity.pilot.ejected;
}

export function isImmobile(entity: MechEntity): boolean {
  return entity.locations.left_leg.destroyed && entity.locations.right_leg.destroyed;
}

export function legPenaltyFactor(entity: MechEntity, singleLegFactor: number): number {
  if (isImmobile(entity)) return 0;
  const lost = entity.locations.left_leg.destroyed || entity.locations.right_leg.destroyed;
  return lost ? singleLegFactor : 1;
}

export function findEntity(world: World, id: EntityId | null): MechEntity | null {
  if (id === null) return null;
  return world.entities.find((entity) => entity.id === id) ?? null;
}

export function findAmmoBin(entity: MechEntity, weaponId: string): AmmoBin | null {
  return (
    entity.ammoBins.find(
      (bin) => bin.weaponId === weaponId && !bin.destroyed && bin.rounds > 0,
    ) ?? null
  );
}
