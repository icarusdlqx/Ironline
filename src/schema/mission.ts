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

export const MissionSchema = z
  .strictObject({
    id: IdSchema,
    name: NameSchema,
    type: z.enum(['skirmish', 'assault', 'defend', 'recon']),
    mapId: IdSchema,
    maxDurationSeconds: z.number().positive().max(3600),
    lances: z.array(LanceSchema).min(2),
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
  });

export type Mission = z.infer<typeof MissionSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;
