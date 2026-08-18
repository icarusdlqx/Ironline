import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { checkIntegrity } from './integrity';
import type { Catalog, ContentIssue } from './load';

describe('campaign content integrity', () => {
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
});
