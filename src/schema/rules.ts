import { z } from 'zod';
import { IdSchema, MechLocationSchema, perLocation } from './common';

const Factor = z.number().positive().max(4);
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
  moveAlignmentDegrees: z.number().positive().max(180),
  torsoTwistDegrees: z.number().positive().max(180),
  torsoTurnRateDegreesPerSecond: z.number().positive(),
  waypointRadius: z.number().positive(),
  arrivalRadius: z.number().positive(),
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
  hitLocationWeights: perLocation(z.number().nonnegative()),
  calledShot: z.strictObject({
    accuracyFactor: Factor,
    locationChance: Probability,
  }),
  tagFactor: Factor,
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
  difficulty: DifficultyRulesSchema,
} as const;

export type RuleId = keyof typeof RULE_SCHEMAS;
export const RULE_IDS = Object.keys(RULE_SCHEMAS) as RuleId[];
