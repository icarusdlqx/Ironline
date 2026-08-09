import { z } from 'zod';
import { IdSchema, MechLocationSchema, perLocation } from './common';

const Factor = z.number().positive().max(4);
const NameLike = z.string().min(1).max(60);
const Probability = z.number().min(0).max(1);

const MotionFactorsSchema = z.strictObject({
  stationary: Factor,
  walk: Factor,
  run: Factor,
  jump: Factor,
});

export const SimulationRulesSchema = z.strictObject({
  id: z.literal('simulation'),
  tickRate: z.number().int().min(1).max(120),
  aiDecisionIntervalTicks: z.number().int().positive(),
  aiPathIntervalTicks: z.number().int().positive(),
  maxBattleTicks: z.number().int().positive(),
  pathfindMaxNodes: z.number().int().positive(),
});

export const MovementRulesSchema = z.strictObject({
  id: z.literal('movement'),
  walkSpeedFactor: z.number().positive(),
  runMultiplier: z.number().min(1),
  turnRateDegreesPerSecond: z.number().positive(),
  turnRateReferenceTonnage: z.number().positive(),
  singleLegSpeedFactor: Probability,
  jumpDistancePerJet: z.number().positive(),
  jumpHeatPerJet: z.number().nonnegative(),
  jumpCooldownSeconds: z.number().positive(),
  /** Ground speed while airborne. Sets how long a mech spends off the ground. */
  jumpSpeed: z.number().positive(),
  /**
   * Speed multiplier for walking straight backwards, tapering to 1 head-on.
   * A mech holding its nose on a target while it repositions is crabbing, and
   * that costs pace.
   */
  offAxisSpeedFactor: Factor,
  moveAlignmentDegrees: z.number().positive().max(180),
  torsoTwistDegrees: z.number().positive().max(180),
  torsoTurnRateDegreesPerSecond: z.number().positive(),
  waypointRadius: z.number().positive(),
  arrivalRadius: z.number().positive(),
  /**
   * How much room a mech takes up on the ground, so two of them cannot stand
   * in the same spot. These have to agree with the radius the renderer draws a
   * hull at, or mechs visibly overlap while the simulation believes they are
   * clear of one another; a test holds the two together.
   */
  bodyRadiusBase: z.number().positive(),
  bodyRadiusPerTon: z.number().positive(),
  /**
   * Share of an overlap pushed out per tick. Below one, contact is a shove
   * rather than a snap, so two mechs squeezing through a gap ease past each
   * other instead of being fired apart.
   */
  separationRate: Factor,
});

/** Which side of a mech a shot came in on. */
export const ATTACK_ARCS = ['front', 'side', 'rear'] as const;
export type AttackArc = (typeof ATTACK_ARCS)[number];

/**
 * Hit locations named relative to the shot rather than to the mech, so one
 * table serves both flanks. "near" is the side the fire is coming from.
 */
const ArcHitWeightsSchema = z.strictObject({
  head: z.number().nonnegative(),
  centre_torso: z.number().nonnegative(),
  near_torso: z.number().nonnegative(),
  far_torso: z.number().nonnegative(),
  near_arm: z.number().nonnegative(),
  far_arm: z.number().nonnegative(),
  near_leg: z.number().nonnegative(),
  far_leg: z.number().nonnegative(),
});

const ArcProfileSchema = z.strictObject({
  /** Multiplies incoming damage. Rear plating is thinner than the glacis. */
  damageFactor: z.number().positive().max(4),
  hitLocationWeights: ArcHitWeightsSchema,
});

export const CombatRulesSchema = z.strictObject({
  id: z.literal('combat'),
  gunneryBase: z.array(Probability).length(5),
  rangeFactor: z.strictObject({
    short: Factor,
    medium: Factor,
    long: Factor,
    beyond: Factor,
  }),
  shooterMotion: MotionFactorsSchema,
  targetMotion: MotionFactorsSchema,
  minimumRangeFactor: Factor,
  maxRangeMultiplier: z.number().min(1),
  firingArcDegrees: z.number().positive().max(360),
  hitChanceFloor: Probability,
  hitChanceCeiling: Probability,
  /** Used by fire that arrives from above — artillery, air strikes, mines. */
  hitLocationWeights: perLocation(z.number().nonnegative()),
  /**
   * Where a shot lands and what it does depends on the side it came in on.
   * The two arc widths are measured across the nose and across the tail; what
   * is left over on each flank is the side arc.
   */
  attackArcs: z.strictObject({
    frontDegrees: z.number().positive().max(360),
    rearDegrees: z.number().positive().max(360),
    front: ArcProfileSchema,
    side: ArcProfileSchema,
    rear: ArcProfileSchema,
  }),
  calledShot: z.strictObject({
    accuracyFactor: Factor,
    locationChance: Probability,
  }),
  tagFactor: Factor,
  /** How long a mech under return-fire orders remembers who shot at it. */
  returnFireSeconds: z.number().positive(),
});

export const HeatTierSchema = z.strictObject({
  fraction: z.number().min(0).max(2),
  movementFactor: Factor,
  accuracyFactor: Factor,
  shutdownChancePerSecond: Probability,
  ammoExplosionChancePerSecond: Probability,
  forcedShutdown: z.boolean(),
});

export const HeatRulesSchema = z
  .strictObject({
    id: z.literal('heat'),
    capacityBase: z.number().positive(),
    capacityPerSink: z.number().nonnegative(),
    dissipationPerSinkPerSecond: z.number().positive(),
    shutdownSeconds: z.number().positive(),
    pilotingOverrideFactor: z.number().min(0).max(0.5),
    tiers: z.array(HeatTierSchema).min(1),
  })
  .superRefine((rules, ctx) => {
    const first = rules.tiers[0];
    if (first === undefined || first.fraction !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['tiers', 0],
        message: 'the first heat tier must start at fraction 0 so every heat level resolves',
      });
    }
    for (let index = 1; index < rules.tiers.length; index += 1) {
      const previous = rules.tiers[index - 1];
      const current = rules.tiers[index];
      if (previous !== undefined && current !== undefined && current.fraction <= previous.fraction) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiers', index, 'fraction'],
          message: 'heat tiers must be listed in ascending order of fraction',
        });
      }
    }
  });

export const DamageRulesSchema = z
  .strictObject({
    id: z.literal('damage'),
    transfer: perLocation(MechLocationSchema.nullable()),
    ammoExplosionDamagePerRound: z.number().nonnegative(),
    ammoExplosionCap: z.number().positive(),
    volatileExplosionFactor: z.number().nonnegative(),
    headDestroyedEjectionChance: Probability,
    legDestroyedSpeedFactor: Probability,
    /**
     * What happens when a shot gets past the plate and into the frame. A
     * critical is not simply more damage: it is the shot that finds the thing
     * behind the armour, which is why it can silence a weapon the mech was
     * relying on rather than just shortening the fight.
     */
    critical: z.strictObject({
      /** Damage multiplier on the penetrating shot itself. */
      damageMultiplier: z.number().min(1).max(5),
      /** Chance the crit also wrecks something fitted in that location. */
      componentChance: Probability,
      /** A ruined leg actuator, as a share of the mech's pace. */
      actuatorSpeedFactor: Factor,
      /** A ruined arm actuator, as a share of the mech's gunnery. */
      actuatorAccuracyFactor: Factor,
      /** A wrecked sensor head, as a share of the mech's gunnery. */
      sensorAccuracyFactor: Factor,
    }),
  })
  .superRefine((rules, ctx) => {
    if (rules.transfer.centre_torso !== null || rules.transfer.head !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['transfer'],
        message: 'head and centre_torso must terminate the transfer chain (null)',
      });
    }
  });

export const TerrainTypeSchema = z.strictObject({
  moveMultiplier: z.number().min(0).max(4),
  coverFactor: Factor,
  losObstruction: z.number().min(0).max(4),
  heatDissipationMultiplier: Factor,
  passable: z.boolean(),
});

/** How a mech wants to fight, read off what it is actually carrying. */
export const COMBAT_ROLES = ['brawler', 'skirmisher', 'sniper', 'missile_boat', 'scout'] as const;
export type CombatRole = (typeof COMBAT_ROLES)[number];

const RoleProfileSchema = z.strictObject({
  /** Above 1 the mech presses; below 1 it gives ground and lets others lead. */
  aggression: z.number().positive().max(3),
  /** How far behind the lance's leading edge it prefers to sit, in metres. */
  standoff: z.number().min(-200).max(400),
});

export const AiRulesSchema = z.strictObject({
  id: z.literal('ai'),
  target: z.strictObject({
    vulnerabilityWeight: z.number().nonnegative(),
    threatWeight: z.number().nonnegative(),
    distancePenaltyPower: z.number().nonnegative().max(4),
    exposurePenaltyWeight: z.number().nonnegative(),
    focusFireBonus: z.number().min(1).max(4),
    switchHysteresis: z.number().min(1).max(4),
  }),
  positioning: z.strictObject({
    rangeSampleStep: z.number().positive(),
    rangeTolerance: z.number().positive(),
    repositionStep: z.number().positive(),
    candidateDirections: z.number().int().min(4).max(32),
    coverWeight: z.number().nonnegative(),
    elevationWeight: z.number().nonnegative(),
    flankWeight: z.number().nonnegative(),
    flankAngleDegrees: z.number().positive().max(180),
    spacingRadius: z.number().nonnegative(),
    spacingWeight: z.number().nonnegative(),
    backOffAdvantage: z.number().min(1).max(4),
    dpsWeight: z.number().nonnegative(),
    rangeErrorWeight: z.number().nonnegative(),
    closingWeight: z.number().nonnegative(),
    losPenalty: z.number().nonnegative(),
    commitSeconds: z.number().positive().max(30),
    approachArcDegrees: z.number().positive().max(180),
    approachProgressWeight: z.number().nonnegative(),
    approachExposureWeight: z.number().nonnegative(),
    stationWeight: z.number().nonnegative(),
  }),
  heat: z.strictObject({
    holdFireFraction: Probability,
    resumeFraction: Probability,
    finisherOverrideFraction: Probability,
    sustainFactor: z.number().positive().max(2),
  }),
  withdrawal: z.strictObject({
    structureFraction: Probability,
    resumeStructureFraction: Probability,
    disengageRangeFactor: z.number().min(1).max(4),
    mapEdgeDistance: z.number().positive(),
    losingStrengthRatio: z.number().positive().max(2),
    openRangeWeight: z.number().nonnegative(),
    concealmentBonus: z.number().nonnegative(),
  }),
  calledShot: z.strictObject({
    targetStructureFraction: Probability,
    chance: Probability,
  }),
  roles: z.strictObject({
    /** A weapon whose long bracket ends here or sooner counts as short-ranged. */
    shortRangeMetres: z.number().positive(),
    /** A weapon whose long bracket reaches this counts as long-ranged. */
    longRangeMetres: z.number().positive(),
    /** At or below this tonnage, a mech without a long-range battery scouts. */
    scoutTonnage: z.number().positive(),
    /** At or above this tonnage, a short-ranged mech brawls rather than skirmishes. */
    brawlerTonnage: z.number().positive(),
    /** Share of a mech's output that has to sit in a bracket to define its role. */
    longShare: Probability,
    indirectShare: Probability,
    shortShare: Probability,
    /** A minimum range this deep says the mech was built to shoot from the back. */
    minimumRangeMetres: z.number().nonnegative(),
    profiles: z.strictObject({
      brawler: RoleProfileSchema,
      skirmisher: RoleProfileSchema,
      sniper: RoleProfileSchema,
      missile_boat: RoleProfileSchema,
      scout: RoleProfileSchema,
    }),
  }),
});

export const TraitSchema = z.strictObject({
  label: NameLike,
  note: z.string().min(1).max(240),
  speedFactor: z.number().positive().max(2).default(1),
  incomingAccuracyFactor: z.number().positive().max(2).default(1),
  movingAccuracyFactor: z.number().positive().max(2).default(1),
  dissipationFactor: z.number().positive().max(2).default(1),
  sensorRangeFactor: z.number().positive().max(2).default(1),
  damageTakenFactor: z.number().positive().max(2).default(1),
  legLossFactor: z.number().positive().max(2).default(1),
  lanceAccuracyFactor: z.number().positive().max(2).default(1),
});

export const TraitRulesSchema = z.strictObject({
  id: z.literal('traits'),
  entries: z.record(IdSchema, TraitSchema),
});

/**
 * What a pilot brings that their skill numbers do not. Gunnery says how well
 * someone shoots; a speciality says what they are actually good at — holding a
 * gun steady at a dead run, riding a hot reactor, finding the seam in a hull.
 */
export const PilotTraitSchema = z.strictObject({
  label: NameLike,
  note: z.string().min(1).max(240),
  /** Marksmanship, over and above gunnery. */
  accuracyFactor: z.number().positive().max(2).default(1),
  /** How hard this pilot is to hit — jinking, cover, never standing still. */
  incomingAccuracyFactor: z.number().positive().max(2).default(1),
  /** Shooting on the move, which most pilots are bad at. */
  movingAccuracyFactor: z.number().positive().max(2).default(1),
  /** Running the reactor hotter than the manual allows. */
  dissipationFactor: z.number().positive().max(2).default(1),
  sensorRangeFactor: z.number().positive().max(2).default(1),
  /** Knowing where a hull comes apart. */
  criticalChanceFactor: z.number().positive().max(3).default(1),
  /** Walking away from a wreck they should not have walked away from. */
  survivalFactor: z.number().positive().max(2).default(1),
  /** How fast they learn. */
  xpFactor: z.number().positive().max(2).default(1),
});

export const PilotTraitRulesSchema = z.strictObject({
  id: z.literal('pilotTraits'),
  entries: z.record(IdSchema, PilotTraitSchema),
});

export const BalanceRulesSchema = z.strictObject({
  id: z.literal('balance'),
  /** How far a weapon may sit from its class median before the report flags it. */
  weaponBandFraction: z.number().positive().max(1),
});

export const DifficultyTierSchema = z.strictObject({
  skillDelta: z.number().int().min(-2).max(3),
  aggression: z.number().positive().max(3),
  lanceSizeDelta: z.number().int().min(-3).max(3),
  focusFire: z.boolean(),
  flanking: z.boolean(),
  coverSeeking: z.boolean(),
  calledShots: z.boolean(),
});

export const DifficultyRulesSchema = z.strictObject({
  id: z.literal('difficulty'),
  default: IdSchema,
  tiers: z.record(IdSchema, DifficultyTierSchema),
});

const SupportCallBase = { cost: z.number().int().nonnegative(), delaySeconds: z.number().nonnegative().max(60) };

export const SupportRulesSchema = z.strictObject({
  id: z.literal('support'),
  sensor_probe: z.strictObject({
    ...SupportCallBase,
    radius: z.number().positive(),
    durationSeconds: z.number().positive(),
  }),
  artillery_strike: z.strictObject({
    ...SupportCallBase,
    radius: z.number().positive(),
    damage: z.number().positive(),
    shots: z.number().int().positive().max(24),
    scatter: z.number().nonnegative(),
  }),
  air_strike: z.strictObject({
    ...SupportCallBase,
    length: z.number().positive(),
    width: z.number().positive(),
    damage: z.number().positive(),
    shots: z.number().int().positive().max(24),
  }),
  repair_truck: z.strictObject({
    ...SupportCallBase,
    radius: z.number().positive(),
    armourPerSecond: z.number().positive(),
    durationSeconds: z.number().positive(),
  }),
  minelayer: z.strictObject({
    ...SupportCallBase,
    radius: z.number().positive(),
    mines: z.number().int().positive().max(40),
    damage: z.number().positive(),
    durationSeconds: z.number().positive(),
  }),
  reinforcement: z.strictObject({ ...SupportCallBase }),
});

export const SalvageRulesSchema = z.strictObject({
  id: z.literal('salvage'),
  chassisRecoveryByOutcome: z.strictObject({
    centre_torso: Probability,
    head: Probability,
    ammo_explosion: Probability,
    legged: Probability,
    ejected: Probability,
  }),
  weaponRecoveryMin: Probability,
  weaponRecoveryMax: Probability,
  equipmentRecovery: Probability,
  destroyedLocationRecovery: Probability,
  hulkRebuildCostFraction: z.number().positive().max(1),
  hulkRebuildDays: z.number().int().positive(),
});

export const EconomyRulesSchema = z.strictObject({
  id: z.literal('economy'),
  negotiation: z.strictObject({
    payoutFloorFactor: z.number().positive().max(1),
    payoutCeilingFactor: z.number().min(1).max(4),
    steps: z.number().int().min(2).max(20),
  }),
  repair: z.strictObject({
    armourCostPerPoint: z.number().nonnegative(),
    internalCostPerPoint: z.number().nonnegative(),
    locationReplaceCostFraction: z.number().nonnegative().max(1),
    armourPointsPerDay: z.number().positive(),
    internalPointsPerDay: z.number().positive(),
    locationReplaceDays: z.number().nonnegative(),
    minimumDays: z.number().int().nonnegative(),
  }),
  pilot: z.strictObject({
    hireCostBase: z.number().nonnegative(),
    hireCostPerSkillPoint: z.number().nonnegative(),
    salaryPerDay: z.number().nonnegative(),
    injuryDaysBase: z.number().int().nonnegative(),
    injuryDaysPerWound: z.number().int().nonnegative(),
    injuryChanceOnMechLoss: Probability,
    deathChanceOnMechLoss: Probability,
  }),
  xp: z.strictObject({
    perHit: z.number().nonnegative(),
    perDamageDealt: z.number().nonnegative(),
    perKill: z.number().nonnegative(),
    missionSurvival: z.number().nonnegative(),
    missionWin: z.number().nonnegative(),
    skillCostBase: z.number().positive(),
    skillCostGrowth: z.number().min(1).max(5),
  }),
  market: z.strictObject({ sellFraction: z.number().positive().max(1) }),
});

export const ConstructionRulesSchema = z.strictObject({
  id: z.literal('construction'),
  engineWeightByRating: z.record(z.string().regex(/^\d+$/), z.number().positive()),
  structureWeightFraction: z.number().positive().max(1),
  armourPointsPerTon: z.number().positive(),
  ammoSlotsPerTon: z.number().positive(),
});

export const SensorRulesSchema = z.strictObject({
  id: z.literal('sensors'),
  baseRange: z.number().positive(),
  rangePerSkill: z.number().nonnegative(),
  ghostMemorySeconds: z.number().nonnegative(),
});

export const TerrainRulesSchema = z.strictObject({
  id: z.literal('terrain'),
  types: z.record(IdSchema, TerrainTypeSchema),
});

export type SimulationRules = z.infer<typeof SimulationRulesSchema>;
export type MovementRules = z.infer<typeof MovementRulesSchema>;
export type CombatRules = z.infer<typeof CombatRulesSchema>;
export type HeatRules = z.infer<typeof HeatRulesSchema>;
export type DamageRules = z.infer<typeof DamageRulesSchema>;
export type TerrainRules = z.infer<typeof TerrainRulesSchema>;
export type SensorRules = z.infer<typeof SensorRulesSchema>;
export type ConstructionRules = z.infer<typeof ConstructionRulesSchema>;
export type SalvageRules = z.infer<typeof SalvageRulesSchema>;
export type EconomyRules = z.infer<typeof EconomyRulesSchema>;
export type SupportRules = z.infer<typeof SupportRulesSchema>;
export type AiRules = z.infer<typeof AiRulesSchema>;
export type BalanceRules = z.infer<typeof BalanceRulesSchema>;
export type Trait = z.infer<typeof TraitSchema>;
export type TraitRules = z.infer<typeof TraitRulesSchema>;
export type PilotTrait = z.infer<typeof PilotTraitSchema>;
export type PilotTraitRules = z.infer<typeof PilotTraitRulesSchema>;
export type DifficultyRules = z.infer<typeof DifficultyRulesSchema>;
export type DifficultyTier = z.infer<typeof DifficultyTierSchema>;
export type TerrainType = z.infer<typeof TerrainTypeSchema>;

export interface Rules {
  readonly simulation: SimulationRules;
  readonly movement: MovementRules;
  readonly combat: CombatRules;
  readonly heat: HeatRules;
  readonly damage: DamageRules;
  readonly terrain: TerrainRules;
  readonly sensors: SensorRules;
  readonly construction: ConstructionRules;
  readonly salvage: SalvageRules;
  readonly economy: EconomyRules;
  readonly support: SupportRules;
  readonly ai: AiRules;
  readonly balance: BalanceRules;
  readonly traits: TraitRules;
  readonly pilotTraits: PilotTraitRules;
  readonly difficulty: DifficultyRules;
}

export const RULE_SCHEMAS = {
  simulation: SimulationRulesSchema,
  movement: MovementRulesSchema,
  combat: CombatRulesSchema,
  heat: HeatRulesSchema,
  damage: DamageRulesSchema,
  terrain: TerrainRulesSchema,
  sensors: SensorRulesSchema,
  construction: ConstructionRulesSchema,
  salvage: SalvageRulesSchema,
  economy: EconomyRulesSchema,
  support: SupportRulesSchema,
  ai: AiRulesSchema,
  balance: BalanceRulesSchema,
  traits: TraitRulesSchema,
  pilotTraits: PilotTraitRulesSchema,
  difficulty: DifficultyRulesSchema,
} as const;

export type RuleId = keyof typeof RULE_SCHEMAS;
export const RULE_IDS = Object.keys(RULE_SCHEMAS) as RuleId[];
