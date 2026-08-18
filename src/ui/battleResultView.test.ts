import { describe, expect, it } from 'vitest';
import { LOCATIONS, type MechLocation } from '../schema/common';
import type { BattleResult, UnitResult } from '../sim/world';
import { formatBattleDuration, viewBattleResult } from './battleResultView';

function unit(overrides: Partial<UnitResult> = {}): UnitResult {
  return {
    id: 1,
    team: 0,
    name: 'Sentinel',
    designId: 'sentinel_brawler',
    pilotId: 'rook',
    alive: true,
    killMethod: null,
    pilotDead: false,
    pilotWounds: 0,
    pilotEjected: false,
    withdrew: false,
    legged: false,
    damageDealt: 120.4,
    damageTaken: 40.4,
    shotsFired: 10,
    shotsHit: 4,
    ammoSpent: 3,
    heatPeak: 22,
    kills: 1,
    condition: Object.fromEntries(
      LOCATIONS.map((location) => [
        location,
        { armour: 10, rearArmour: 0, internal: 5, destroyed: false },
      ]),
    ) as Record<MechLocation, UnitResult['condition'][MechLocation]>,
    ...overrides,
  };
}

function result(overrides: Partial<BattleResult> = {}): BattleResult {
  return {
    seed: 'report',
    missionId: 'skirmish_ridge',
    missionStatus: 'active',
    missionReason: null,
    objectives: [],
    ticks: 2_400,
    durationSeconds: 120,
    winner: 0,
    decided: true,
    units: [unit(), unit({ id: 2, team: 1, name: 'Raider', alive: false })],
    weapons: [],
    ...overrides,
  };
}

describe('battle result view', () => {
  it('reports a decided skirmish victory and preserves honest totals', () => {
    const view = viewBattleResult(
      result({
        units: [
          unit(),
          unit({
            id: 2,
            name: 'Courser',
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 19.4,
            damageTaken: 5.2,
            kills: 0,
          }),
          unit({ id: 3, team: 1, name: 'Raider', alive: false }),
        ],
      }),
      0,
    );

    expect(view).toMatchObject({
      tone: 'victory',
      headline: 'Victory',
      reason: 'The opposing force was put out of action.',
      duration: '02:00',
      operational: 2,
      lanceSize: 2,
      hostilesStopped: 1,
      hostileCount: 1,
      kills: 1,
      damageDealt: 140,
      damageTaken: 46,
      shotsFired: 10,
      shotsHit: 4,
      accuracy: 40,
    });
    expect(view.lance[1]?.accuracy).toBeNull();
  });

  it('calls an unresolved clock ending a timeout without inventing a cause', () => {
    const view = viewBattleResult(
      result({ decided: false, winner: null, durationSeconds: 600 }),
      0,
    );

    expect(view.tone).toBe('timeout');
    expect(view.headline).toBe('Time expired');
    expect(view.reason).toBe('Time expired with the surviving forces level.');
    expect(view.duration).toBe('10:00');
  });

  it('keeps the authored mission verdict above the generic winner', () => {
    const success = viewBattleResult(
      result({
        missionStatus: 'success',
        missionReason: 'the position was held to the clock',
        decided: false,
        winner: 0,
      }),
      0,
    );
    const failure = viewBattleResult(
      result({
        missionStatus: 'failure',
        missionReason: 'a required objective failed',
        decided: false,
        winner: 1,
      }),
      0,
    );

    expect(success.tone).toBe('victory');
    expect(success.reason).toBe('The position was held to the clock.');
    expect(failure.tone).toBe('defeat');
    expect(failure.reason).toBe('A required objective failed.');
  });

  it('names a failed clock objective as a timeout', () => {
    const view = viewBattleResult(
      result({
        missionStatus: 'failure',
        missionReason: 'the mission clock ran out',
        decided: false,
        winner: 1,
      }),
      0,
    );

    expect(view.tone).toBe('timeout');
    expect(view.reason).toBe('The mission clock ran out.');
  });

  it('distinguishes withdrawal, ejection, lost pilots, and destroyed sections', () => {
    const destroyedCondition = unit().condition;
    destroyedCondition.left_arm = { armour: 0, rearArmour: 0, internal: 0, destroyed: true };
    const view = viewBattleResult(
      result({
        units: [
          unit({ withdrew: true }),
          unit({ id: 2, pilotEjected: true }),
          unit({ id: 3, alive: false, pilotDead: true, condition: destroyedCondition }),
        ],
      }),
      0,
    );

    expect(view.lance.map((entry) => entry.status)).toEqual(['Withdrew', 'Ejected', 'Lost']);
    expect(view.operational).toBe(0);
    expect(view.lance[2]).toMatchObject({ pilotLost: true, locationsLost: 1 });
  });

  it('formats long battles without wrapping the minute count', () => {
    expect(formatBattleDuration(3_721.9)).toBe('62:01');
    expect(formatBattleDuration(-2)).toBe('00:00');
  });
});
