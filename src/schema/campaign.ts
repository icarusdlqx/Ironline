import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const CampaignNodeSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  missionId: IdSchema,
  employer: NameSchema,
  brief: z.string().min(1).max(400),
  requires: z.array(IdSchema).max(4).default([]),
  basePayout: z.number().int().positive(),
  maxSalvageShare: z.number().min(0).max(1),
  deadlineDays: z.number().int().positive().max(180),
  position: z.strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
});

export const CampaignSchema = z
  .strictObject({
    id: IdSchema,
    name: NameSchema,
    startingCbills: z.number().int().positive(),
    startingDay: z.number().int().nonnegative(),
    startingDesignIds: z.array(IdSchema).min(1).max(12),
    startingPilotIds: z.array(IdSchema).min(1).max(12),
    hiringPoolPilotIds: z.array(IdSchema).max(12).default([]),
    victoryNodeId: IdSchema,
    nodes: z.array(CampaignNodeSchema).min(1).max(40),
  })
  .superRefine((campaign, ctx) => {
    const ids = new Set(campaign.nodes.map((node) => node.id));

    if (ids.size !== campaign.nodes.length) {
      ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'node ids must be unique' });
    }

    if (!ids.has(campaign.victoryNodeId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['victoryNodeId'],
        message: `"${campaign.victoryNodeId}" is not a node in this campaign`,
      });
    }

    campaign.nodes.forEach((node, index) => {
      for (const required of node.requires) {
        if (!ids.has(required)) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', index, 'requires'],
            message: `"${required}" is not a node in this campaign`,
          });
        }
        if (required === node.id) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', index, 'requires'],
            message: 'a node cannot require itself',
          });
        }
      }
    });

    if (campaign.startingDesignIds.length !== campaign.startingPilotIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['startingPilotIds'],
        message: 'every starting mech needs a starting pilot',
      });
    }
  });

export type Campaign = z.infer<typeof CampaignSchema>;
export type CampaignNode = z.infer<typeof CampaignNodeSchema>;
