import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { startCampaign } from './campaign';
import { deserialiseCampaign, serialiseCampaign } from './save';

describe('progression reports in old saves', () => {
  it('loads a debrief that predates the banked-XP snapshot without inventing one', () => {
    const state = startCampaign(catalog, 'border_dispute', 'old-debrief');
    const pilot = state.pilots[0];
    if (pilot === undefined) throw new Error('campaign has no pilots');
    state.history.push({
      nodeId: 'militia_raid',
      missionId: 'raid_ridge',
      termsId: 'standard',
      won: true,
      day: state.day,
      payout: 0,
      salvagedChassis: [],
      salvagedItems: [],
      salvageOffered: [],
      pilotCasualties: [],
      mechsLost: [],
      pilotReports: [{
        pilotId: pilot.id,
        name: pilot.name,
        mech: 'Sentinel',
        kills: 0,
        damage: 0,
        xp: 80,
        xpBanked: 80,
        promotions: [],
        fate: 'returned',
      }],
    });

    const old = JSON.parse(serialiseCampaign(state)) as {
      state: { history: Array<{ pilotReports: Array<{ xpBanked?: number }> }> };
    };
    delete old.state.history[0]?.pilotReports[0]?.xpBanked;

    const restored = deserialiseCampaign(JSON.stringify(old));
    expect(restored.error).toBeNull();
    expect(restored.state?.history[0]?.pilotReports[0]?.xpBanked).toBeNull();
  });
});
