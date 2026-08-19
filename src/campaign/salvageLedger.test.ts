import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { LOCATIONS } from '../schema/common';
import { createRng, type Rng } from '../sim/rng';
import type { BattleResult, UnitResult } from '../sim/world';
import { startCampaign } from './campaign';
import { deserialiseCampaign, serialiseCampaign } from './save';
import { resolveSalvage, selectSalvageOffers } from './salvage';
import type { MissionOutcome, StoreItem } from './types';

function enemy(designId = 'sentinel_brawler', id = 17): UnitResult {
  const design = catalog.designs.get(designId);
  return {
    id,
    team: 1,
    name: design?.name ?? designId,
    designId,
    pilotId: 'test-pilot',
    alive: false,
    killMethod: 'head',
    pilotDead: true,
    pilotWounds: 0,
    pilotEjected: false,
    withdrew: false,
    legged: false,
    damageDealt: 0,
    damageTaken: 1,
    shotsFired: 0,
    shotsHit: 0,
    ammoSpent: 0,
    heatPeak: 0,
    kills: 0,
    condition: Object.fromEntries(
      LOCATIONS.map((location) => [
        location,
        { armour: 1, rearArmour: 0, internal: 1, destroyed: location === 'head' },
      ]),
    ) as UnitResult['condition'],
  };
}

function battle(...units: UnitResult[]): BattleResult {
  return {
    seed: 'salvage-ledger',
    missionId: 'training_ground',
    missionStatus: 'success',
    missionReason: 'objectives-complete',
    objectives: [],
    ticks: 1,
    durationSeconds: 0.05,
    winner: 0,
    decided: true,
    units,
    weapons: [],
  };
}

const alwaysRecover: Rng = {
  nextUint32: () => 0,
  next: () => 0,
  int: (min) => min,
  range: (min) => min,
  chance: () => true,
  pick: <T>(items: readonly T[]) => items[0] as T,
  shuffle: <T>(items: readonly T[]) => [...items],
  weighted: <T>(items: ReadonlyArray<{ value: T }>) => items[0]?.value as T,
  fork: () => alwaysRecover,
  save: () => ({ x: 1, y: 1, z: 1, w: 1 }),
  restore: () => undefined,
};

function outcome(): MissionOutcome {
  return {
    nodeId: 'militia_raid',
    missionId: 'training_ground',
    employerId: 'kestrel_combine',
    employerName: 'Kestrel Combine',
    termsId: 'standard',
    won: true,
    day: 4,
    payout: 100,
    salvagedChassis: ['sentinel_brawler'],
    salvagedItems: [{ kind: 'weapon', itemId: 'medium_laser', count: 3 }],
    salvageOffered: [{ kind: 'weapon', itemId: 'medium_laser', count: 3 }],
    salvageFinalized: false,
    salvageCandidates: [
      {
        designId: 'sentinel_brawler',
        name: "Sentinel SNL-2 'Brawler'",
        outcome: 'head',
        chassisChance: 0.225,
        recovered: true,
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
}

describe('salvage field ledger', () => {
  it('records the signed hull odds, roll result, and each recovered part source', () => {
    const report = resolveSalvage(catalog, alwaysRecover, battle(enemy()), 0, 0.5);

    expect(report.candidates).toEqual([
      {
        designId: 'sentinel_brawler',
        name: "Sentinel SNL-2 'Brawler'",
        outcome: 'head',
        chassisChance: 0.225,
        recovered: true,
      },
    ]);
    expect(report.chassisRecovered).toEqual(['sentinel_brawler']);
    expect(report.hulls).toHaveLength(1);
    expect(report.hulls[0]?.condition.head.destroyed).toBe(true);
    expect(report.hulls[0]?.condition.left_arm).toEqual({
      armour: 1,
      rearArmour: 0,
      internal: 1,
      destroyed: false,
    });
    expect(
      report.provenance.filter((source) => source.itemId === 'medium_laser'),
    ).toEqual([
      expect.objectContaining({ sourceDesignId: 'sentinel_brawler', location: 'left_arm' }),
      expect.objectContaining({ sourceDesignId: 'sentinel_brawler', location: 'left_arm' }),
      expect.objectContaining({ sourceDesignId: 'sentinel_brawler', location: 'centre_torso' }),
    ]);
  });

  it('tows every recovered hull and gives both crate classes loading berths', () => {
    const report = resolveSalvage(
      catalog,
      alwaysRecover,
      battle(
        enemy('sentinel_brawler', 17),
        enemy('bulwark_assault', 18),
        enemy('wisp_scout', 19),
      ),
      0,
      1,
    );

    expect(report.chassisRecovered).toEqual([
      'sentinel_brawler',
      'bulwark_assault',
      'wisp_scout',
    ]);
    expect(report.offered).toHaveLength(5);
    expect(new Set(report.offered.map((item) => item.kind))).toEqual(
      new Set(['weapon', 'equipment']),
    );
    expect(new Set(report.items.map((item) => item.kind))).toEqual(
      new Set(['weapon', 'equipment']),
    );
    expect(
      Math.abs(
        report.offered.filter((item) => item.kind === 'weapon').length -
          report.offered.filter((item) => item.kind === 'equipment').length,
      ),
    ).toBeLessThanOrEqual(1);
  });

  it('rotates a stable offer independently of recovery source order', () => {
    const richField: StoreItem[] = [
      { kind: 'weapon', itemId: 'ac5', count: 1 },
      { kind: 'weapon', itemId: 'medium_laser', count: 3 },
      { kind: 'weapon', itemId: 'srm6', count: 1 },
      { kind: 'weapon', itemId: 'large_laser', count: 2 },
      { kind: 'weapon', itemId: 'lrm10', count: 2 },
      { kind: 'weapon', itemId: 'lrm15', count: 2 },
      { kind: 'equipment', itemId: 'case', count: 2 },
      { kind: 'equipment', itemId: 'active_probe', count: 1 },
      { kind: 'equipment', itemId: 'jump_jet', count: 2 },
    ];
    const offer = selectSalvageOffers(richField, 'fair-field');

    expect(offer).toEqual(selectSalvageOffers([...richField].reverse(), 'fair-field'));
    expect(offer).toHaveLength(5);
    expect(new Set(offer.map((item) => item.kind))).toEqual(new Set(['weapon', 'equipment']));

    const rotated = Array.from({ length: 64 }, (_, index) =>
      selectSalvageOffers(richField, `fair-field-${index}`),
    );
    const rotations = new Set(
      rotated.map((items) => items.map((item) => `${item.kind}:${item.itemId}`).join(',')),
    );
    const seen = new Set(
      rotated.flatMap((items) => items.map((item) => `${item.kind}:${item.itemId}`)),
    );
    expect(rotations.size).toBeGreaterThan(1);
    expect(seen).toEqual(
      new Set(richField.map((item) => `${item.kind}:${item.itemId}`)),
    );
  });

  it('does not spend another draw from the campaign recovery stream', () => {
    const field = enemy();
    const rng = createRng('salvage-draw-order');
    const control = createRng('salvage-draw-order');
    const design = catalog.designs.get(field.designId);
    if (design === undefined) throw new Error('missing salvage design');

    resolveSalvage(catalog, rng, battle(field), 0, 0.5);
    control.chance(0.5);
    for (const _mount of design.mounts) {
      control.range(0.1, 0.2);
      control.chance(0.5);
    }
    for (const _fit of design.equipment) control.chance(0.5);

    expect(rng.save()).toEqual(control.save());
  });

  it('round-trips new ledgers and gives old debriefs an empty one', () => {
    const state = startCampaign(catalog, 'border_dispute', 'salvage-ledger-save');
    state.history.push(outcome());

    const restored = deserialiseCampaign(serialiseCampaign(state)).state;
    expect(restored?.history[0]?.salvageOffered).toEqual(outcome().salvageOffered);
    expect(restored?.history[0]?.salvageCandidates).toEqual(outcome().salvageCandidates);
    expect(restored?.history[0]?.salvageProvenance).toEqual(outcome().salvageProvenance);

    const oldSave = JSON.parse(serialiseCampaign(state)) as {
      state: { history: Array<Partial<MissionOutcome>> };
    };
    delete oldSave.state.history[0]?.salvageCandidates;
    delete oldSave.state.history[0]?.salvageProvenance;
    delete oldSave.state.history[0]?.salvageFinalized;

    const oldRestored = deserialiseCampaign(JSON.stringify(oldSave)).state;
    expect(oldRestored?.history[0]?.salvageCandidates).toEqual([]);
    expect(oldRestored?.history[0]?.salvageProvenance).toEqual([]);
    expect(oldRestored?.history[0]?.salvageFinalized).toBe(true);
  });
});
