import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { LOCATIONS, type MechLocation } from '../schema/common';
import { issueAttack, setHoldFire } from '../sim/orders';
import { evaluateMission } from '../sim/objectives';
import { createWorld, stepWorld, toResult } from '../sim/world';
import type { BattleResult, UnitResult } from '../sim/world';
import { salvageDrillProgress, salvageDrillReport } from './salvageDrill';
import type { UnitSnapshot } from './store';

function observed(
  lostLocations: MechLocation[],
  overrides: Partial<Pick<UnitSnapshot, 'name' | 'identified' | 'alive'>> = {},
) {
  return {
    name: 'Range Warden',
    identified: true,
    alive: true,
    lostLocations,
    ...overrides,
  };
}

function target(overrides: Partial<UnitResult> = {}): UnitResult {
  const condition = Object.fromEntries(
    LOCATIONS.map((location) => [
      location,
      {
        armour: 10,
        rearArmour: 0,
        internal: 5,
        destroyed: location === 'left_leg' || location === 'right_leg',
      },
    ]),
  ) as UnitResult['condition'];
  return {
    id: 2,
    team: 1,
    name: 'Range Warden',
    designId: 'warden_lancer',
    pilotId: 'bo_ferrant',
    alive: true,
    killMethod: null,
    pilotDead: false,
    pilotWounds: 0,
    pilotEjected: false,
    withdrew: false,
    legged: true,
    damageDealt: 0,
    damageTaken: 164,
    shotsFired: 0,
    shotsHit: 0,
    ammoSpent: 0,
    heatPeak: 0,
    kills: 0,
    condition,
    ...overrides,
  };
}

function battle(enemy: UnitResult, winner: number | null = 0): BattleResult {
  return {
    seed: 'salvage-drill',
    missionId: 'salvage_tactics',
    missionStatus: winner === 0 ? 'success' : 'failure',
    missionReason: 'the position was held to the clock',
    objectives: [],
    ticks: 1_200,
    durationSeconds: 60,
    winner,
    decided: false,
    units: [enemy],
    weapons: [],
  };
}

describe('salvage field exercise', () => {
  it('settles through the authored clock without inventing a leg objective', () => {
    const world = createWorld(catalog, {
      seed: 'salvage-clock',
      missionId: 'salvage_tactics',
      playerTeam: 0,
    });

    expect(world.objectives.map((objective) => objective.type)).toEqual([
      'protect_zones',
      'survive',
    ]);
    expect(evaluateMission(world, 0, true)).toEqual({
      status: 'success',
      reason: 'the position was held to the clock',
    });
  });

  it('withholds damage state when the target is not visible', () => {
    expect(salvageDrillProgress([])).toMatchObject({
      visible: false,
      targetName: 'Target off sensors',
      leftLeg: 'unknown',
      rightLeg: 'unknown',
      legsLost: null,
      operational: null,
    });
  });

  it('reports observed leg progress without naming an unidentified contact', () => {
    const progress = salvageDrillProgress([
      observed(['left_leg'], { identified: false }),
    ]);

    expect(progress).toMatchObject({
      targetName: 'Range target',
      leftLeg: 'lost',
      rightLeg: 'intact',
      legsLost: 1,
      operational: true,
    });
    expect(progress.instruction).toContain('RL');
  });

  it('keeps a double-legged target operational in the coach', () => {
    const progress = salvageDrillProgress([
      observed(['left_leg', 'right_leg']),
    ]);

    expect(progress.status).toBe('Immobilised · still operational');
    expect(progress.instruction).toContain('Hold Fire now');
  });

  it('preserves the legged outcome when the drill order is held at two legs', () => {
    const maxTicks = 1_200;
    const world = createWorld(catalog, {
      seed: 'salvage-hold-fire',
      missionId: 'salvage_tactics',
      playerTeam: 0,
      playerController: 'orders',
      enemyController: 'baseline',
      difficulty: 'green',
    });
    const shooter = world.entities.find((unit) => unit.team === 0);
    const rangeTarget = world.entities.find((unit) => unit.team === 1);
    expect(shooter).toBeDefined();
    expect(rangeTarget).toBeDefined();
    if (shooter === undefined || rangeTarget === undefined) return;

    issueAttack(shooter, rangeTarget.id, 'left_leg');
    let heldAtTwoLegs = false;
    while (!world.finished && world.tick < maxTicks) {
      stepWorld(world, maxTicks);
      if (rangeTarget.locations.left_leg.destroyed && !rangeTarget.locations.right_leg.destroyed) {
        issueAttack(shooter, rangeTarget.id, 'right_leg');
      }
      if (
        rangeTarget.locations.left_leg.destroyed &&
        rangeTarget.locations.right_leg.destroyed &&
        !heldAtTwoLegs
      ) {
        setHoldFire(shooter, true);
        heldAtTwoLegs = true;
      }
    }

    const report = salvageDrillReport(
      toResult(world, 'salvage-hold-fire', maxTicks),
      0,
      catalog.rules.salvage,
    );
    expect(heldAtTwoLegs).toBe(true);
    expect(report).toMatchObject({ outcome: 'legged', standardMet: true });
  });

  it('uses the campaign field outcome and unscaled hull chance', () => {
    const report = salvageDrillReport(battle(target()), 0, catalog.rules.salvage);

    expect(report).toMatchObject({
      legsLost: 2,
      outcome: 'legged',
      outcomeLabel: 'Legged',
      baseHullChance: 0.85,
      standardMet: true,
    });
  });

  it('does not grade a legged machine on the side that held the field', () => {
    const report = salvageDrillReport(battle(target(), 1), 0, catalog.rules.salvage);

    expect(report.outcome).toBeNull();
    expect(report.baseHullChance).toBeNull();
    expect(report.standardMet).toBe(false);
  });

  it('reports the actual lower-chance destruction outcome', () => {
    const enemy = target({ alive: false, legged: false, killMethod: 'centre_torso' });
    enemy.condition.left_leg.destroyed = false;
    enemy.condition.right_leg.destroyed = false;
    const report = salvageDrillReport(battle(enemy), 0, catalog.rules.salvage);

    expect(report).toMatchObject({
      legsLost: 0,
      outcome: 'centre_torso',
      baseHullChance: 0.2,
      standardMet: false,
    });
  });

  it('does not invent a destruction outcome for a withdrawn target', () => {
    const report = salvageDrillReport(
      battle(target({ alive: false, legged: false, withdrew: true })),
      0,
      catalog.rules.salvage,
    );

    expect(report).toMatchObject({
      outcome: null,
      outcomeLabel: 'No salvage candidate',
      baseHullChance: null,
      standardMet: false,
    });
  });
});
