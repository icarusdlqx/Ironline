import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { createRng, type Rng } from '../sim/rng';
import type { BattleResult, UnitResult } from '../sim/world';
import {
  acceptContract,
  deployableLance,
  resolveMission,
  startCampaign,
  type DeployablePair,
} from './campaign';
import { awardXp, resolveCasualty, traitFactor } from './roster';
import type { CampaignState, PilotRecord } from './types';

function withdrawn(pair: DeployablePair, pilotWounds = 0): UnitResult {
  return {
    id: 1,
    team: 0,
    name: pair.mech.design.name,
    designId: pair.mech.design.id,
    pilotId: pair.pilot.id,
    alive: false,
    killMethod: null,
    pilotDead: false,
    pilotWounds,
    pilotEjected: false,
    withdrew: true,
    legged: false,
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    shotsHit: 0,
    ammoSpent: 0,
    heatPeak: 0,
    kills: 0,
    condition: pair.mech.condition,
  };
}

function result(missionId: string, units: UnitResult[]): BattleResult {
  return {
    seed: 'withdrawal-result',
    missionId,
    missionStatus: 'failure',
    missionReason: 'objectives-failed',
    objectives: [],
    ticks: 1,
    durationSeconds: 0.05,
    winner: 1,
    decided: true,
    units,
    weapons: [],
  };
}

function campaign(): CampaignState {
  const state = startCampaign(catalog, 'border_dispute', 'withdrawal');
  const accepted = acceptContract(catalog, state, 'militia_raid', 'standard');
  if (!accepted.ok) throw new Error(accepted.reason ?? 'contract refused');
  return state;
}

function pilot(): PilotRecord {
  const record = campaign().pilots[0];
  if (record === undefined) throw new Error('campaign has no pilot');
  return record;
}

function drop(overrides: Partial<UnitResult>): UnitResult {
  return {
    alive: false,
    withdrew: true,
    pilotDead: false,
    pilotWounds: 0,
    damageDealt: 0,
    shotsHit: 0,
    kills: 0,
    ...overrides,
  } as UnitResult;
}

const alwaysFatal = { chance: () => true } as unknown as Rng;

describe('withdrawal progression', () => {
  it('awards the same survival experience as remaining on the field', () => {
    const returned = pilot();
    const standing = { ...returned, xp: 0 };

    const withdrawalXp = awardXp(catalog, { pilot: returned, unit: drop({}) }, false);
    const standingXp = awardXp(
      catalog,
      { pilot: standing, unit: drop({ alive: true, withdrew: false }) },
      false,
    );

    expect(withdrawalXp).toBe(standingXp);
    expect(withdrawalXp).toBeGreaterThan(0);
  });

  it('uses cockpit wounds without applying mech-loss harm', () => {
    const unhurt = pilot();
    expect(resolveCasualty(catalog, alwaysFatal, unhurt, drop({}), 8)).toEqual({
      died: false,
      injuredDays: 0,
    });

    const wounded = pilot();
    const wounds = 2;
    const expectedDays = catalog.rules.economy.pilot.injuryDaysPerWound * wounds;
    expect(
      resolveCasualty(catalog, alwaysFatal, wounded, drop({ pilotWounds: wounds }), 8),
    ).toEqual({ died: false, injuredDays: expectedDays });
    expect(wounded.injuredUntilDay).toBe(8 + expectedDays);
    expect(wounded.dead).toBe(false);
  });

  it('retains mech-loss casualty behavior for a destroyed unit', () => {
    const lost = pilot();

    expect(
      resolveCasualty(
        catalog,
        alwaysFatal,
        lost,
        drop({ withdrew: false, pilotWounds: 0 }),
        8,
      ),
    ).toEqual({ died: true, injuredDays: 0 });
    expect(lost.dead).toBe(true);
  });

  it('keeps downstream campaign randomness stable', () => {
    const template = pilot();
    for (let index = 0; index < 64; index += 1) {
      const withdrawalRng = createRng(`withdrawal-sequence-${index}`);
      const lossRng = createRng(`withdrawal-sequence-${index}`);
      const returned = { ...template };
      const lost = { ...template };

      resolveCasualty(catalog, withdrawalRng, returned, drop({}), 8);
      resolveCasualty(catalog, lossRng, lost, drop({ withdrew: false }), 8);

      expect(withdrawalRng.save()).toEqual(lossRng.save());
      expect(returned.dead).toBe(false);
    }
  });
});

describe('campaign withdrawal resolution', () => {
  it('returns hulls and pilots with survival credit and field wounds intact', () => {
    const state = campaign();
    const lance = deployableLance(state).slice(0, 2);
    const safe = lance[0];
    const wounded = lance[1];
    if (safe === undefined || wounded === undefined) throw new Error('campaign has no lance');

    const startingDay = state.day;
    const woundCount = 2;
    const woundDays = catalog.rules.economy.pilot.injuryDaysPerWound * woundCount;
    const run = resolveMission(
      catalog,
      state,
      result(state.contract?.missionId ?? '', [withdrawn(safe), withdrawn(wounded, woundCount)]),
      lance,
    );

    expect(safe.mech.status).toBe('ready');
    expect(wounded.mech.status).toBe('ready');
    expect(run.outcome.mechsLost).toEqual([]);
    expect(safe.pilot.dead).toBe(false);
    expect(wounded.pilot.dead).toBe(false);
    expect(wounded.pilot.injuredUntilDay).toBe(startingDay + woundDays);
    expect(run.outcome.pilotCasualties).toEqual([`${wounded.pilot.name} (out ${woundDays} days)`]);

    const reports = run.outcome.pilotReports;
    expect(reports.map((report) => report.fate)).toEqual(['returned', 'injured']);
    for (const [index, pair] of lance.entries()) {
      const expectedXp = Math.round(
        catalog.rules.economy.xp.missionSurvival * traitFactor(catalog, pair.pilot, 'xpFactor'),
      );
      expect(reports[index]?.xp).toBe(expectedXp);
      expect(pair.pilot.xp).toBe(expectedXp);
    }
  });
});
