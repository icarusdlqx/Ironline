import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const CampaignNodeSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  missionId: IdSchema,
  employerId: IdSchema,
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

export const CampaignEmployerSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
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
    employers: z.array(CampaignEmployerSchema).min(1).max(40),
    /**
     * The pool the hiring hall draws side work from: missions that can be
     * offered as filler, and the outfits that post them. Empty means this
     * campaign offers no side work at all.
     */
    sideWork: z
      .strictObject({
        missionIds: z.array(IdSchema).max(20),
        employerIds: z.array(IdSchema).max(20),
      })
      .prefault({ missionIds: [], employerIds: [] }),
    nodes: z.array(CampaignNodeSchema).min(1).max(40),
  })
  .superRefine((campaign, ctx) => {
    const ids = new Set(campaign.nodes.map((node) => node.id));
    const employerIds = new Set(campaign.employers.map((employer) => employer.id));
    const employerNames = new Set(
      campaign.employers.map((employer) =>
        employer.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB'),
      ),
    );

    if (ids.size !== campaign.nodes.length) {
      ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'node ids must be unique' });
    }

    if (employerIds.size !== campaign.employers.length) {
      ctx.addIssue({ code: 'custom', path: ['employers'], message: 'employer ids must be unique' });
    }
    if (employerNames.size !== campaign.employers.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['employers'],
        message: 'employer names must be unique',
      });
    }

    if (!ids.has(campaign.victoryNodeId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['victoryNodeId'],
        message: `"${campaign.victoryNodeId}" is not a node in this campaign`,
      });
    }

    campaign.nodes.forEach((node, index) => {
      if (!employerIds.has(node.employerId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'employerId'],
          message: `"${node.employerId}" is not an employer in this campaign`,
        });
      }
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

    campaign.sideWork.employerIds.forEach((employerId, index) => {
      if (employerIds.has(employerId)) return;
      ctx.addIssue({
        code: 'custom',
        path: ['sideWork', 'employerIds', index],
        message: `"${employerId}" is not an employer in this campaign`,
      });
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
export type CampaignEmployer = z.infer<typeof CampaignEmployerSchema>;
