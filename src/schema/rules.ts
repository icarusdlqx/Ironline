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
export type TerrainType = z.infer<typeof TerrainTypeSchema>;

export interface Rules {
  readonly simulation: SimulationRules;
  readonly movement: MovementRules;
  readonly combat: CombatRules;
  readonly heat: HeatRules;
  readonly damage: DamageRules;
  readonly terrain: TerrainRules;
}

export const RULE_SCHEMAS = {
  simulation: SimulationRulesSchema,
  movement: MovementRulesSchema,
  combat: CombatRulesSchema,
  heat: HeatRulesSchema,
  damage: DamageRulesSchema,
  terrain: TerrainRulesSchema,
} as const;

export type RuleId = keyof typeof RULE_SCHEMAS;
export const RULE_IDS = Object.keys(RULE_SCHEMAS) as RuleId[];
