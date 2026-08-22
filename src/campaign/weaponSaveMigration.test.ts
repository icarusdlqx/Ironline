import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { computeLoadout } from '../sim/loadout';
import { startCampaign } from './campaign';
import { deserialiseCampaign, serialiseCampaign } from './save';
import type { MissionOutcome } from './types';

function legacyOutcome(sourceDesignId: string): MissionOutcome {
  return {
    nodeId: 'legacy_contract',
    missionId: 'training_ground',
    employerId: 'halloran_freight',
    employerName: 'Halloran Freight',
    termsId: 'standard',
    won: true,
    day: 0,
    payout: 0,
    salvagedChassis: [],
    salvagedItems: [
      { kind: 'weapon', itemId: 'light_gauss', count: 1 },
      { kind: 'weapon', itemId: 'ac5', count: 2 },
    ],
    salvageOffered: [
      { kind: 'weapon', itemId: 'mrm30', count: 2 },
      { kind: 'weapon', itemId: 'mrm20', count: 3 },
    ],
    salvageFinalized: false,
    salvageCandidates: [],
    salvageProvenance: [
      {
        kind: 'weapon',
        itemId: 'light_gauss',
        sourceDesignId,
        sourceMechName: 'Legacy One',
        location: 'right_arm',
      },
      {
        kind: 'weapon',
        itemId: 'mrm30',
        sourceDesignId,
        sourceMechName: 'Legacy Two',
        location: 'left_torso',
      },
    ],
    pilotCasualties: [],
    mechsLost: [],
    pilotReports: [],
  };
}

describe('campaign weapon id migration', () => {
  it('repairs embedded designs and coalesces every persisted crate ledger', () => {
    const state = startCampaign(catalog, 'border_dispute', 'legacy-weapons');
    const mech = state.mechs.find((entry) => entry.design.id === 'sentinel_brawler');
    if (mech === undefined) throw new Error('missing migration fixture mech');

    const mount = mech.design.mounts.find((entry) => entry.weaponId === 'ac5');
    const ammo = mech.design.ammo.find((entry) => entry.weaponId === 'ac5');
    if (mount === undefined || ammo === undefined) throw new Error('missing migration fixture weapon');
    mount.weaponId = 'light_gauss';
    ammo.weaponId = 'light_gauss';

    state.store = [
      { kind: 'weapon', itemId: 'light_gauss', count: 2 },
      { kind: 'equipment', itemId: 'jump_jet', count: 1 },
      { kind: 'weapon', itemId: 'rotary_ac2', count: 3 },
      { kind: 'weapon', itemId: 'ac5', count: 4 },
    ];
    state.history.push(legacyOutcome(mech.design.id));

    const restored = deserialiseCampaign(serialiseCampaign(state), catalog);
    expect(restored.error).toBeNull();
    if (restored.state === null) throw new Error('legacy campaign did not load');

    const migratedMech = restored.state.mechs.find((entry) => entry.id === mech.id);
    if (migratedMech === undefined) throw new Error('migrated mech disappeared');
    expect(migratedMech.design.mounts.some((entry) => entry.weaponId === 'light_gauss')).toBe(false);
    expect(migratedMech.design.ammo.some((entry) => entry.weaponId === 'light_gauss')).toBe(false);
    expect(computeLoadout(catalog, migratedMech.design).valid).toBe(true);

    expect(restored.state.store).toEqual([
      { kind: 'weapon', itemId: 'ac5', count: 9 },
      { kind: 'equipment', itemId: 'jump_jet', count: 1 },
    ]);
    expect(restored.state.history[0]?.salvagedItems).toEqual([
      { kind: 'weapon', itemId: 'ac5', count: 3 },
    ]);
    expect(restored.state.history[0]?.salvageOffered).toEqual([
      { kind: 'weapon', itemId: 'mrm20', count: 5 },
    ]);
    expect(restored.state.history[0]?.salvageProvenance.map((entry) => entry.itemId)).toEqual([
      'ac5',
      'mrm20',
    ]);

    const once = serialiseCampaign(restored.state);
    const twice = deserialiseCampaign(once, catalog).state;
    expect(twice === null ? null : serialiseCampaign(twice)).toBe(once);
  });
});
