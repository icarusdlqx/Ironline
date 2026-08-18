import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { checkIntegrity } from './integrity';
import type { Catalog, ContentIssue } from './load';
import { CampaignSchema } from './campaign';

describe('campaign content integrity', () => {
  it('rejects employer references that are not in the campaign ledger', () => {
    const campaign = catalog.campaigns.get('border_dispute');
    expect(campaign).toBeDefined();
    if (campaign === undefined) return;

    const brokenNode = structuredClone(campaign);
    if (brokenNode.nodes[0] !== undefined) brokenNode.nodes[0].employerId = 'missing_employer';
    expect(CampaignSchema.safeParse(brokenNode).error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['nodes', 0, 'employerId'] }),
      ]),
    );

    const brokenSideWork = structuredClone(campaign);
    brokenSideWork.sideWork.employerIds.push('missing_employer');
    expect(CampaignSchema.safeParse(brokenSideWork).error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['sideWork', 'employerIds', 6] }),
      ]),
    );

    const duplicateName = structuredClone(campaign);
    const second = duplicateName.employers[1];
    if (second !== undefined) second.name = '  KESTREL   COMBINE ';
    expect(CampaignSchema.safeParse(duplicateName).error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['employers'], message: 'employer names must be unique' }),
      ]),
    );
  });

  it('rejects a missing mission in the side-work pool', () => {
    const campaign = catalog.campaigns.get('border_dispute');
    expect(campaign).toBeDefined();
    if (campaign === undefined) return;

    const campaigns = new Map(catalog.campaigns);
    campaigns.set(campaign.id, {
      ...campaign,
      sideWork: {
        ...campaign.sideWork,
        missionIds: [...campaign.sideWork.missionIds, 'missing_posting'],
      },
    });
    const issues: ContentIssue[] = [];

    checkIntegrity({ ...catalog, campaigns } satisfies Catalog, issues);

    expect(issues).toContainEqual({
      file: 'campaigns/border_dispute.json',
      path: 'sideWork.missionIds',
      message: 'unknown mission "missing_posting"',
    });
  });

  it('checks delayed deployments and map-authored points before they fire', () => {
    const mission = catalog.missions.get('switchyard_watch');
    expect(mission).toBeDefined();
    if (mission === undefined) return;

    const broken = structuredClone(mission);
    const spawn = broken.triggers
      .flatMap((trigger) => trigger.effects)
      .find((effect) => effect.type === 'spawn');
    expect(spawn?.type).toBe('spawn');
    if (spawn?.type !== 'spawn' || spawn.units[0] === undefined) return;
    spawn.units[0] = {
      ...spawn.units[0],
      designId: 'missing_design',
      pilotId: 'missing_pilot',
      spawn: { x: 2000, y: 2000 },
    };
    const zone = broken.zones[0];
    if (zone !== undefined) broken.zones[0] = { ...zone, x: 2000 };
    broken.triggers.push({
      id: 'bad_reveal',
      when: { type: 'elapsed', seconds: 1 },
      once: true,
      effects: [{ type: 'reveal', x: 2000, y: 2000, radius: 80, seconds: 5 }],
    });

    const missions = new Map(catalog.missions);
    missions.set(broken.id, broken);
    const issues: ContentIssue[] = [];
    checkIntegrity({ ...catalog, missions } satisfies Catalog, issues);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'missions/switchyard_watch.json',
        message: 'unknown design "missing_design"',
      }),
      expect.objectContaining({
        file: 'missions/switchyard_watch.json',
        message: 'unknown pilot "missing_pilot"',
      }),
      expect.objectContaining({
        file: 'missions/switchyard_watch.json',
        message: 'spawn (2000, 2000) is outside the 960×960m map',
      }),
      expect.objectContaining({
        file: 'missions/switchyard_watch.json',
        message: 'zone (2000, 492) is outside the 960×960m map',
      }),
      expect.objectContaining({
        file: 'missions/switchyard_watch.json',
        message: 'reveal (2000, 2000) is outside the 960×960m map',
      }),
    ]));
  });

  it('catalogues the reward-free field exercise outside the campaign', () => {
    const mission = catalog.missions.get('salvage_tactics');
    expect(mission).toBeDefined();
    if (mission === undefined) return;

    const campaignMissionIds = [...catalog.campaigns.values()].flatMap((campaign) => [
      ...campaign.nodes.map((node) => node.missionId),
      ...campaign.sideWork.missionIds,
    ]);
    expect(campaignMissionIds).not.toContain(mission.id);
    expect(mission.startingResourcePoints).toBe(0);
    expect(mission.maxDurationSeconds).toBe(60);
    expect(mission.objectives.map((objective) => objective.type)).toEqual([
      'protect_zones',
      'survive',
    ]);
    expect(mission.objectives.every((objective) => objective.resourcePoints === 0)).toBe(true);
    expect(
      mission.triggers.flatMap((trigger) => trigger.effects)
        .some((effect) => effect.type === 'award_resource_points'),
    ).toBe(false);
    const hostileUnits = mission.lances
      .filter((lance) => lance.team !== 0)
      .flatMap((lance) => lance.units);
    expect(hostileUnits).toHaveLength(1);
    const targetDesign = catalog.designs.get(hostileUnits[0]?.designId ?? '');
    expect(catalog.chassis.get(targetDesign?.chassisId ?? '')?.frame).toBe('mech');

    const issues: ContentIssue[] = [];
    checkIntegrity(catalog, issues);
    expect(issues.filter((issue) => issue.file === `missions/${mission.id}.json`)).toEqual([]);
  });
});
