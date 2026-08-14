import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const DeploymentSchema = z.strictObject({
  designId: IdSchema,
  pilotId: IdSchema,
  spawn: z.strictObject({ x: z.number().nonnegative(), y: z.number().nonnegative() }),
  facingDegrees: z.number().min(-360).max(360),
});

export const LanceSchema = z.strictObject({
  team: z.number().int().min(0).max(7),
  name: NameSchema,
  units: z.array(DeploymentSchema).min(1).max(12),
});

export const ZoneSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  radius: z.number().positive().max(400),
  owner: z.number().int().min(0).max(7).nullable(),
  captureSeconds: z.number().positive().max(120),
  resourcePoints: z.number().int().nonnegative().default(0),
});

export const ObjectiveSchema = z
  .strictObject({
    id: IdSchema,
    label: z.string().min(1).max(120),
    type: z.enum(['destroy_all', 'capture_zones', 'hold_zones', 'survive', 'protect_zones']),
    team: z.number().int().min(0).max(7).default(0),
    required: z.boolean().default(true),
    zoneIds: z.array(IdSchema).max(8).default([]),
    holdSeconds: z.number().nonnegative().max(600).default(0),
    resourcePoints: z.number().int().nonnegative().default(0),
  })
  .superRefine((objective, ctx) => {
    const needsZones =
      objective.type === 'capture_zones' ||
      objective.type === 'hold_zones' ||
      objective.type === 'protect_zones';

    if (needsZones && objective.zoneIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['zoneIds'],
        message: `a ${objective.type} objective needs at least one zone`,
      });
    }
    if (objective.type === 'hold_zones' && objective.holdSeconds <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['holdSeconds'],
        message: 'a hold_zones objective needs a holdSeconds above zero',
      });
    }
  });

export const TriggerConditionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('elapsed'), seconds: z.number().nonnegative().max(3600) }),
  z.strictObject({
    type: z.literal('zone_captured'),
    zoneId: IdSchema,
    team: z.number().int().min(0).max(7),
  }),
  z.strictObject({ type: z.literal('objective_complete'), objectiveId: IdSchema }),
  z.strictObject({
    type: z.literal('team_losses'),
    team: z.number().int().min(0).max(7),
    count: z.number().int().positive().max(20),
  }),
]);

export const TriggerEffectSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('spawn'),
    team: z.number().int().min(0).max(7),
    units: z.array(DeploymentSchema).min(1).max(8),
  }),
  z.strictObject({
    type: z.literal('award_resource_points'),
    team: z.number().int().min(0).max(7),
    amount: z.number().int().max(5000),
  }),
  z.strictObject({ type: z.literal('message'), text: z.string().min(1).max(200) }),
  z.strictObject({
    type: z.literal('reveal'),
    /** Omitted hands the intel to whichever side the mission is written for. */
    team: z.number().int().min(0).max(7).optional(),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    radius: z.number().positive().max(600),
    seconds: z.number().positive().max(300),
  }),
]);

export const TriggerSchema = z.strictObject({
  id: IdSchema,
  when: TriggerConditionSchema,
  once: z.boolean().default(true),
  effects: z.array(TriggerEffectSchema).min(1).max(6),
});

export const MissionSchema = z
  .strictObject({
    id: IdSchema,
    name: NameSchema,
    type: z.enum([
      'skirmish',
      'assault',
      'defend',
      'recon',
      'base_capture',
      'escort',
      'extraction',
      'ambush',
      'headhunt',
    ]),
    mapId: IdSchema,
    /**
     * Overrides the map's own air and light. This is how a night raid reuses a
     * daylight map's ground rather than duplicating four kilobytes of tiles to
     * change the colour of the sky.
     */
    atmosphereId: IdSchema.optional(),
    briefing: z.string().min(1).max(600).default('Engage and destroy.'),
    maxDurationSeconds: z.number().positive().max(3600),
    startingResourcePoints: z.number().int().nonnegative().max(5000).default(0),
    /**
     * What the dropship will carry to this contract, in tonnes. A lance is
     * limited by weight as well as by berths, so fielding the hundred-tonne
     * hull means leaving something else in the bay — which is the decision a
     * mission profile is meant to force.
     *
     * Null means nobody stated a limit, and the allowance is read off the
     * lance the mission fields itself.
     */
    dropTonnage: z.number().int().positive().max(600).nullable().default(null),
    lances: z.array(LanceSchema).min(2),
    reserves: z.array(DeploymentSchema).max(6).default([]),
    zones: z.array(ZoneSchema).max(12).default([]),
    objectives: z.array(ObjectiveSchema).max(8).default([]),
    triggers: z.array(TriggerSchema).max(12).default([]),
  })
  .superRefine((mission, ctx) => {
    const teams = mission.lances.map((lance) => lance.team);
    if (new Set(teams).size !== teams.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['lances'],
        message: 'each lance must belong to a distinct team',
      });
    }

    const zoneIds = new Set(mission.zones.map((zone) => zone.id));
    if (zoneIds.size !== mission.zones.length) {
      ctx.addIssue({ code: 'custom', path: ['zones'], message: 'zone ids must be unique' });
    }

    const objectiveIds = new Set(mission.objectives.map((objective) => objective.id));
    if (objectiveIds.size !== mission.objectives.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['objectives'],
        message: 'objective ids must be unique',
      });
    }

    mission.objectives.forEach((objective, index) => {
      for (const zoneId of objective.zoneIds) {
        if (!zoneIds.has(zoneId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['objectives', index, 'zoneIds'],
            message: `unknown zone "${zoneId}"`,
          });
        }
      }
    });

    mission.triggers.forEach((trigger, index) => {
      if (trigger.when.type === 'zone_captured' && !zoneIds.has(trigger.when.zoneId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['triggers', index, 'when'],
          message: `unknown zone "${trigger.when.zoneId}"`,
        });
      }
      if (
        trigger.when.type === 'objective_complete' &&
        !objectiveIds.has(trigger.when.objectiveId)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['triggers', index, 'when'],
          message: `unknown objective "${trigger.when.objectiveId}"`,
        });
      }
    });

    if (mission.objectives.filter((objective) => objective.required).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['objectives'],
        message: 'a mission needs at least one required objective',
      });
    }
  });

export type Mission = z.infer<typeof MissionSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;
export type MissionZone = z.infer<typeof ZoneSchema>;
export type MissionObjective = z.infer<typeof ObjectiveSchema>;
export type MissionTrigger = z.infer<typeof TriggerSchema>;
export type TriggerEffect = z.infer<typeof TriggerEffectSchema>;
