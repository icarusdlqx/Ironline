import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import { startCampaign } from '../../campaign/campaign';
import type { MissionOutcome } from '../../campaign/types';
import { Debrief } from './Debrief';

describe('campaign debrief recovery ledger', () => {
  it('shows final hull rolls and the field source of each offered part', () => {
    const state = startCampaign(catalog, 'border_dispute', 'debrief-ledger');
    const outcome: MissionOutcome = {
      nodeId: 'militia_raid',
      missionId: 'training_ground',
      employerId: 'kestrel_combine',
      employerName: 'Kestrel Combine',
      termsId: 'salvage_first',
      won: true,
      day: 4,
      payout: 100,
      salvagedChassis: ['sentinel_brawler'],
      salvagedItems: [{ kind: 'weapon', itemId: 'medium_laser', count: 2 }],
      salvageOffered: [{ kind: 'weapon', itemId: 'medium_laser', count: 2 }],
      salvageFinalized: false,
      salvageCandidates: [
        {
          designId: 'sentinel_brawler',
          name: "Sentinel SNL-2 'Brawler'",
          outcome: 'head',
          chassisChance: 0.225,
          recovered: true,
        },
        {
          designId: 'sentinel_brawler',
          name: "Sentinel SNL-2 'Second'",
          outcome: 'centre_torso',
          chassisChance: 0.1,
          recovered: false,
        },
        {
          designId: 'carrier_apc',
          name: 'Field Carrier',
          outcome: 'centre_torso',
          chassisChance: 0,
          recovered: false,
        },
      ],
      salvageProvenance: [
        {
          kind: 'weapon',
          itemId: 'medium_laser',
          sourceDesignId: 'sentinel_brawler',
          sourceMechName: "Sentinel SNL-2 'Brawler'",
          location: 'left_arm',
        },
        {
          kind: 'weapon',
          itemId: 'medium_laser',
          sourceDesignId: 'sentinel_brawler',
          sourceMechName: "Sentinel SNL-2 'Brawler'",
          location: 'centre_torso',
        },
      ],
      pilotCasualties: [],
      mechsLost: [],
      pilotReports: [],
    };
    state.history.push(outcome);

    const html = renderToStaticMarkup(
      createElement(Debrief, {
        catalog,
        state,
        outcome,
        onClose: () => undefined,
      }),
    );

    expect(html).toContain('Field recovery ledger');
    expect(html).toContain('Head destroyed');
    expect(html).toContain('22.5%');
    expect(html).toContain('hull recovered');
    expect(html).toContain('not recovered');
    expect(html).toContain('not eligible');
    expect(html).toContain("Field source: Sentinel SNL-2 &#x27;Brawler&#x27;, left arm");
    expect(html).toContain("Sentinel SNL-2 &#x27;Brawler&#x27;, centre torso");
    expect(html).toContain('Recovered hulls are already in the yard');
    expect(html).toContain('carrying their field damage and no mounted');
    expect(html).toContain('weapons or equipment');
    expect(html).toContain('weapons and equipment alternate');
    expect(html).toContain('each list rotates from one field to the next');
    expect(html).toContain('Kestrel Combine');
    expect(html).toContain('1 completed · 0 failed · 100 C paid');

    outcome.salvageFinalized = true;
    const restored = renderToStaticMarkup(
      createElement(Debrief, {
        catalog,
        state,
        outcome,
        onChooseSalvage: (picks) => picks,
        onClose: () => undefined,
      }),
    );
    expect(restored).toContain('Salvage manifest finalized');
    expect(restored).toContain('This restored report is read-only');
    expect(restored).toContain('marks record what came home');
    expect(restored).not.toContain('Choose what comes home');
    expect(restored).toMatch(/disabled=""[^>]*data-testid="salvage-pick-medium_laser"/);
  });
});
