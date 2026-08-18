import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { LOCATIONS } from '../schema/common';
import type { Rng } from '../sim/rng';
import type { BattleResult, UnitResult } from '../sim/world';
import { startCampaign } from './campaign';
import { deserialiseCampaign, serialiseCampaign } from './save';
import { resolveSalvage } from './salvage';
import type { MissionOutcome } from './types';

function enemy(): UnitResult {
  return {
    id: 17,
    team: 1,
    name: "Sentinel SNL-2 'Brawler'",
    designId: 'sentinel_brawler',
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

function battle(unit: UnitResult): BattleResult {
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
    units: [unit],
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
    termsId: 'standard',
    won: true,
    day: 4,
    payout: 100,
    salvagedChassis: ['sentinel_brawler'],
    salvagedItems: [{ kind: 'weapon', itemId: 'medium_laser', count: 3 }],
    salvageOffered: [{ kind: 'weapon', itemId: 'medium_laser', count: 3 }],
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
    expect(
      report.provenance.filter((source) => source.itemId === 'medium_laser'),
    ).toEqual([
      expect.objectContaining({ sourceDesignId: 'sentinel_brawler', location: 'left_arm' }),
      expect.objectContaining({ sourceDesignId: 'sentinel_brawler', location: 'left_arm' }),
      expect.objectContaining({ sourceDesignId: 'sentinel_brawler', location: 'centre_torso' }),
    ]);
  });

  it('round-trips new ledgers and gives old debriefs an empty one', () => {
    const state = startCampaign(catalog, 'border_dispute', 'salvage-ledger-save');
    state.history.push(outcome());

    const restored = deserialiseCampaign(serialiseCampaign(state)).state;
    expect(restored?.history[0]?.salvageCandidates).toEqual(outcome().salvageCandidates);
    expect(restored?.history[0]?.salvageProvenance).toEqual(outcome().salvageProvenance);

    const oldSave = JSON.parse(serialiseCampaign(state)) as {
      state: { history: Array<Partial<MissionOutcome>> };
    };
    delete oldSave.state.history[0]?.salvageCandidates;
    delete oldSave.state.history[0]?.salvageProvenance;

    const oldRestored = deserialiseCampaign(JSON.stringify(oldSave)).state;
    expect(oldRestored?.history[0]?.salvageCandidates).toEqual([]);
    expect(oldRestored?.history[0]?.salvageProvenance).toEqual([]);
  });
});
