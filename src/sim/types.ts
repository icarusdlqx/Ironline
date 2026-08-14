import type { MechLocation } from '../schema/common';
import type { ArcTables } from './arcs';
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

/**
 * A standing instruction the pilot follows between orders.
 *
 * - `free` takes orders and shoots at whatever it can reach.
 * - `hold_position` will not move, and engages at will from where it stands.
 * - `return_fire` will not move and stays quiet until something shoots it.
 * - `keep_facing` moves where told while holding its nose on the target, so
 *   the thick plating stays between the pilot and the guns.
 */
export type Posture = 'free' | 'hold_position' | 'return_fire' | 'keep_facing';

export const POSTURES: readonly Posture[] = [
  'free',
  'hold_position',
  'return_fire',
  'keep_facing',
];

/** A jump in flight. The mech is off the ground and nothing on it can stop the arc. */
export interface JumpState {
  from: Vec2;
  to: Vec2;
  /** Seconds flown and seconds the arc takes; height peaks halfway between. */
  elapsed: number;
  duration: number;
}

export type KillMethod = 'centre_torso' | 'head' | 'ammo_explosion';

export interface LocationState {
  armour: number;
  armourMax: number;
  /**
   * The plate over the back, thinner than the glacis. Zero on everything but
   * the torsos — a rearArmourMax of 0 is how the rest of the code asks whether
   * a location has a back at all.
   */
  rearArmour: number;
  rearArmourMax: number;
  internal: number;
  internalMax: number;
  destroyed: boolean;
}

export const WEAPON_GROUPS = 4;

export type Stance = 'close' | 'hold' | 'back_off' | 'withdraw';

export interface AiState {
  withdrawing: boolean;
  coolingDown: boolean;
  focusTargetId: EntityId | null;
  /** Where this mech has committed to walk, and until when. Re-deciding every
   *  half second is what makes a lance pirouette instead of manoeuvre. */
  destination: Vec2 | null;
  commitUntilTick: number;
  stance: Stance;
}

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
  /** Specialities, which is what makes two pilots of the same rating differ. */
  traits: string[];
  /** How readily this pilot's fire finds something behind the plate. */
  criticalChanceFactor: number;
  /** Their odds of walking away from a wreck, applied by the campaign. */
  survivalFactor: number;
  /**
   * Knocks taken this battle. Never fatal in the field — a coin-flip loss from
   * one bad fall is miserable — but they ride home as infirmary days.
   */
  wounds: number;
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
  /** Weapon bearing relative to the hull, so a mech can move one way and shoot another. */
  torsoOffset: number;
  /** What actually happened this tick. Combat reads this. */
  motion: MotionState;
  /** What the controller asked for. Movement restores it once the mech is aligned. */
  intendedMotion: MotionState;
  walkSpeed: number;
  runSpeed: number;
  turnRate: number;

  /** How far the jets can throw this mech, and what they charge for it. */
  jumpRange: number;
  jumpHeat: number;
  /** Seconds until the jets can fire again. */
  jumpCooldown: number;
  /** The arc currently being flown, or null when the mech is on the ground. */
  jump: JumpState | null;

  locations: Record<MechLocation, LocationState>;
  weapons: WeaponMount[];
  ammoBins: AmmoBin[];

  heat: number;
  heatCapacity: number;
  heatSinks: number;
  dissipationPerSecond: number;
  shutdownRemaining: number;

  /** How badly the mech has been shoved about, and how far off its feet that is. */
  stability: number;
  /** Seconds left on the ground. Zero means upright. */
  downRemaining: number;
  /** Tick until which the mech cannot be shoved again, having just got up. */
  footingUntilTick: number;

  incomingAccuracyFactor: number;
  outgoingAccuracyFactor: number;
  /** Anti-missile fire thinning an incoming volley. 1 means no AMS aboard. */
  amsMissileFactor: number;
  /** Trait-derived: steadier on the move, tougher, better legs, lance-wide gunnery. */
  movingAccuracyFactor: number;
  damageTakenFactor: number;
  legLossFactor: number;
  lanceAccuracyFactor: number;
  traits: string[];
  /** How far a TAG or NARC carrier can paint a target, and for how long. */
  designatorRange: number;
  designatorSeconds: number;
  /** Tick until which someone has this mech painted for the whole lance. */
  designatedUntilTick: number;
  destroyed: boolean;
  withdrawn: boolean;
  killMethod: KillMethod | null;

  /** The standing instruction this mech is following between orders. */
  posture: Posture;
  /** Who last put fire on this mech, and the tick that memory expires. */
  threatenedBy: EntityId | null;
  threatenedUntilTick: number;

  autopilot: boolean;
  controller: 'orders' | 'tactical' | 'baseline';
  ai: AiState;
  orders: OrderState;
  /** What is actually firing this tick: the pilot's intent, minus whatever the
   *  reactor governor has shed to stay out of shutdown. */
  groupEnabled: boolean[];
  /** What the pilot asked for. The governor may fire less than this, never more. */
  groupIntent: boolean[];
  /** Reactor governor: sheds hot weapon groups rather than risking a shutdown. */
  heatSafety: boolean;
  sensorRange: number;
  /** How far into somebody else's sensor range this mech has to walk to be seen. */
  signature: number;

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
  /**
   * Where the shot was fired from. The arc it lands on is worked out at impact
   * against this, not against wherever the shooter has walked to since — but
   * against the target's facing at impact, so turning to meet incoming fire is
   * worth doing.
   */
  from: Vec2;
  /** The location the pilot called, if any. Resolved with the arc at impact. */
  calledShot: MechLocation | null;
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
  /** Fire arriving from above — artillery, air strikes, mines — has no arc. */
  hitLocationTable: readonly { value: MechLocation; weight: number }[];
  /** One table per attack arc and flank, resolved once at world creation. */
  arcHitTables: ArcTables;
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
  difficulty: string;

  finished: boolean;
  winner: number | null;
}

export function isOperational(entity: MechEntity): boolean {
  return !entity.destroyed && !entity.withdrawn && !entity.pilot.dead && !entity.pilot.ejected;
}

export function isImmobile(entity: MechEntity): boolean {
  return entity.locations.left_leg.destroyed && entity.locations.right_leg.destroyed;
}

/** On the ground: cannot move, turn, twist or shoot, and easy to hit. */
export function isDown(entity: MechEntity): boolean {
  return entity.downRemaining > 0;
}

/** Rocking, but still upright. The next big hit is the one that floors it. */
export function isStaggered(entity: MechEntity, staggerThreshold: number): boolean {
  return !isDown(entity) && entity.stability >= staggerThreshold;
}

export function legPenaltyFactor(entity: MechEntity, singleLegFactor: number): number {
  if (isImmobile(entity)) return 0;
  const lost = entity.locations.left_leg.destroyed || entity.locations.right_leg.destroyed;
  if (!lost) return 1;
  // Reinforced actuators claw back part of the loss, never more than all of it.
  return Math.min(1, singleLegFactor * entity.legLossFactor);
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
