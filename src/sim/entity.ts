import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Design } from '../schema/design';
import type { Catalog } from '../schema/load';
import type { Pilot } from '../schema/pilot';
import type { ConstructionRules, Rules } from '../schema/rules';
import { splitArmour } from './loadout';
import { emptyOrders } from './orders';
import { sensorRangeFor, signatureFor } from './sensors';
import {
  WEAPON_GROUPS,
  type AmmoBin,
  type LocationState,
  type MechEntity,
  type Vec2,
  type WeaponMount,
} from './types';

export interface LocationDamage {
  armour: number;
  rearArmour: number;
  internal: number;
  destroyed: boolean;
}

export interface SpawnParams {
  id: number;
  team: number;
  designId: string;
  pilotId: string;
  spawn: Vec2;
  facingDegrees: number;
  autopilot?: boolean;
  controller?: 'orders' | 'tactical' | 'baseline';
  /** Overrides the catalogue lookup, for refitted or salvaged campaign mechs. */
  design?: Design;
  pilot?: Pilot;
  /** Carries battle damage forward, for a mech deployed before repairs finish. */
  damage?: Partial<Record<MechLocation, LocationDamage>>;
}

const GROUP_BY_WEAPON_TYPE = { energy: 1, ballistic: 2, missile: 3 } as const;

const DEGREES_TO_RADIANS = Math.PI / 180;

function buildLocations(
  rules: ConstructionRules,
  armour: Record<MechLocation, number>,
  internals: Record<MechLocation, number>,
): Record<MechLocation, LocationState> {
  const entries = LOCATIONS.map((location) => {
    const plate = splitArmour(rules, location, armour[location]);
    return [
      location,
      {
        armour: plate.front,
        armourMax: plate.front,
        rearArmour: plate.rear,
        rearArmourMax: plate.rear,
        internal: internals[location],
        internalMax: internals[location],
        destroyed: false,
      } satisfies LocationState,
    ];
  });
  return Object.fromEntries(entries) as Record<MechLocation, LocationState>;
}

function applyStartingDamage(
  locations: Record<MechLocation, LocationState>,
  damage: Partial<Record<MechLocation, LocationDamage>>,
): void {
  for (const location of LOCATIONS) {
    const carried = damage[location];
    if (carried === undefined) continue;
    const state = locations[location];
    state.armour = Math.max(0, Math.min(state.armourMax, carried.armour));
    state.rearArmour = Math.max(0, Math.min(state.rearArmourMax, carried.rearArmour));
    state.internal = Math.max(0, Math.min(state.internalMax, carried.internal));
    state.destroyed = carried.destroyed || state.internal <= 0;
    if (state.destroyed) {
      state.armour = 0;
      state.rearArmour = 0;
      state.internal = 0;
    }
  }
}

export function createMech(catalog: Catalog, rules: Rules, params: SpawnParams): MechEntity {
  const design = params.design ?? catalog.designs.get(params.designId);
  if (design === undefined) throw new Error(`unknown design "${params.designId}"`);

  const chassis = catalog.chassis.get(design.chassisId);
  if (chassis === undefined) throw new Error(`unknown chassis "${design.chassisId}"`);

  const pilot = params.pilot ?? catalog.pilots.get(params.pilotId);
  if (pilot === undefined) throw new Error(`unknown pilot "${params.pilotId}"`);

  const caseLocations = new Set(
    design.equipment
      .filter((fit) => catalog.equipment.get(fit.equipmentId)?.stats.ammo_blast_containment)
      .map((fit) => fit.location),
  );

  const weapons: WeaponMount[] = design.mounts.map((mount, index) => ({
    index,
    weaponId: mount.weaponId,
    location: mount.location,
    group: GROUP_BY_WEAPON_TYPE[catalog.weapons.get(mount.weaponId)?.type ?? 'energy'],
    cooldown: 0,
    destroyed: false,
  }));

  const ammoBins: AmmoBin[] = design.ammo.map((load, index) => {
    const weapon = catalog.weapons.get(load.weaponId);
    const rounds = load.tons * (weapon?.ammoPerTon ?? 0);
    return {
      index,
      weaponId: load.weaponId,
      location: load.location,
      rounds,
      roundsMax: rounds,
      protectedByCase: caseLocations.has(load.location),
      destroyed: false,
    };
  });

  // Chassis traits are the hull's own character, applied before anything bolted on.
  let incomingAccuracyFactor = 1;
  let outgoingAccuracyFactor = 1;
  let movingAccuracyFactor = 1;
  let speedFactor = 1;
  let dissipationFactor = 1;
  let damageTakenFactor = 1;
  let legLossFactor = 1;
  let lanceAccuracyFactor = 1;
  let traitSensorFactor = 1;
  let signatureFactor = 1;

  for (const traitId of chassis.traits) {
    const trait = rules.traits.entries[traitId];
    if (trait === undefined) continue;
    incomingAccuracyFactor *= trait.incomingAccuracyFactor;
    movingAccuracyFactor *= trait.movingAccuracyFactor;
    speedFactor *= trait.speedFactor;
    dissipationFactor *= trait.dissipationFactor;
    damageTakenFactor *= trait.damageTakenFactor;
    legLossFactor *= trait.legLossFactor;
    traitSensorFactor *= trait.sensorRangeFactor;
    signatureFactor *= trait.signatureFactor;
    lanceAccuracyFactor *= trait.lanceAccuracyFactor;
  }
  // What the pilot brings on top of the hull. A speciality is the difference
  // between two people with the same gunnery rating.
  let criticalChanceFactor = 1;
  let survivalFactor = 1;
  for (const traitId of pilot.traits) {
    const trait = rules.pilotTraits.entries[traitId];
    if (trait === undefined) continue;
    outgoingAccuracyFactor *= trait.accuracyFactor;
    incomingAccuracyFactor *= trait.incomingAccuracyFactor;
    movingAccuracyFactor *= trait.movingAccuracyFactor;
    dissipationFactor *= trait.dissipationFactor;
    traitSensorFactor *= trait.sensorRangeFactor;
    criticalChanceFactor *= trait.criticalChanceFactor;
    survivalFactor *= trait.survivalFactor;
  }

  let amsMissileFactor = 1;
  let sensorRangeFactor = 1;
  let designatorRange = 0;
  let designatorSeconds = 0;
  let jumpRange = 0;
  let jumpHeat = 0;
  for (const fit of design.equipment) {
    const stats = catalog.equipment.get(fit.equipmentId)?.stats ?? {};
    incomingAccuracyFactor *= stats.incoming_accuracy_factor ?? 1;
    outgoingAccuracyFactor *= stats.accuracy_factor ?? 1;
    amsMissileFactor *= stats.ams_missile_factor ?? 1;
    sensorRangeFactor *= stats.sensor_range_factor ?? 1;
    // Each jet adds its own reach and its own heat. A chassis with no jump
    // gear in its gyro cannot use them however many are bolted on.
    if (chassis.jumpCapable) {
      jumpRange += stats.jump_distance ?? 0;
      jumpHeat += stats.heat_per_jump ?? 0;
    }
    // The longest-reaching designator wins, and it carries its own dwell time.
    if ((stats.designator_range ?? 0) > designatorRange) {
      designatorRange = stats.designator_range ?? 0;
      designatorSeconds = stats.designator_seconds ?? 0;
    }
  }

  const sinkStats = catalog.equipment.get(design.heatSinkId)?.stats ?? {};
  const dissipationPerSink = sinkStats.dissipation ?? 1;

  const frame = rules.frames.entries[chassis.frame];
  // An emplacement's reactor is there to turn the guns, not the hull. Zeroing
  // the pace here rather than refusing to move it later means everything that
  // reasons about speed — whether it can outrun what is chasing it, whether
  // backing off would work — gets the right answer without knowing about frames.
  const walkSpeed = !frame.mobile
    ? 0
    : (chassis.engineRating / chassis.tonnage) * rules.movement.walkSpeedFactor * speedFactor;

  const locations = buildLocations(rules.construction, design.armour, chassis.internals);
  if (params.damage !== undefined) applyStartingDamage(locations, params.damage);

  const destroyedLocations = LOCATIONS.filter((location) => locations[location].destroyed);
  for (const mount of weapons) {
    if (destroyedLocations.includes(mount.location)) mount.destroyed = true;
  }
  for (const bin of ammoBins) {
    if (destroyedLocations.includes(bin.location)) {
      bin.destroyed = true;
      bin.rounds = 0;
    }
  }

  return {
    id: params.id,
    team: params.team,
    name: design.name,
    designId: design.id,
    chassisId: chassis.id,
    frame: chassis.frame,
    mobile: frame.mobile,
    knockable: frame.knockable,
    twistLimit: Math.min(
      Math.PI,
      rules.movement.torsoTwistDegrees * frame.twistFactor * DEGREES_TO_RADIANS,
    ),
    tonnage: chassis.tonnage,
    pilot: {
      id: pilot.id,
      name: pilot.name,
      gunnery: pilot.gunnery,
      piloting: pilot.piloting,
      sensors: pilot.sensors,
      traits: [...pilot.traits],
      criticalChanceFactor,
      survivalFactor,
      wounds: 0,
      dead: false,
      ejected: false,
    },

    pos: { x: params.spawn.x, y: params.spawn.y },
    facing: params.facingDegrees * DEGREES_TO_RADIANS,
    torsoOffset: 0,
    motion: 'stationary',
    intendedMotion: 'stationary',
    walkSpeed,
    runSpeed: walkSpeed * rules.movement.runMultiplier,
    jumpRange,
    jumpHeat,
    jumpCooldown: 0,
    jump: null,
    posture: 'free',
    threatenedBy: null,
    threatenedUntilTick: 0,
    turnRate: !frame.mobile
      ? 0
      : rules.movement.turnRateDegreesPerSecond *
        (rules.movement.turnRateReferenceTonnage / chassis.tonnage) *
        DEGREES_TO_RADIANS,

    locations,
    weapons,
    ammoBins,

    heat: 0,
    heatCapacity: rules.heat.capacityBase + rules.heat.capacityPerSink * design.heatSinks,
    heatSinks: design.heatSinks,
    dissipationPerSecond:
      design.heatSinks *
      dissipationPerSink *
      rules.heat.dissipationPerSinkPerSecond *
      dissipationFactor,
    shutdownRemaining: 0,

    closestApproach: Number.POSITIVE_INFINITY,
    stalledTicks: 0,

    stability: 0,
    downRemaining: 0,
    footingUntilTick: 0,

    incomingAccuracyFactor,
    outgoingAccuracyFactor,
    destroyed: false,
    withdrawn: false,
    killMethod: null,

    autopilot: params.autopilot ?? true,
    controller: params.controller ?? ((params.autopilot ?? true) ? 'tactical' : 'orders'),
    ai: {
      withdrawing: false,
      coolingDown: false,
      focusTargetId: null,
      destination: null,
      commitUntilTick: 0,
      stance: 'close',
    },
    orders: emptyOrders(),
    groupEnabled: Array.from({ length: WEAPON_GROUPS }, () => true),
    groupIntent: Array.from({ length: WEAPON_GROUPS }, () => true),
    heatSafety: true,
    sensorRange: sensorRangeFor(rules.sensors, pilot.sensors) * sensorRangeFactor * traitSensorFactor,
    signature: signatureFor(rules.sensors, chassis.tonnage) * signatureFactor,
    amsMissileFactor,
    movingAccuracyFactor,
    damageTakenFactor,
    legLossFactor,
    lanceAccuracyFactor,
    traits: [...chassis.traits],
    designatorRange,
    designatorSeconds,
    designatedUntilTick: -1,

    targetId: null,
    calledShot: null,
    path: [],
    pathIndex: 0,
    nextPathTick: 0,

    stats: {
      damageDealt: 0,
      damageTaken: 0,
      shotsFired: 0,
      shotsHit: 0,
      ammoSpent: 0,
      heatPeak: 0,
      kills: 0,
    },
  };
}
