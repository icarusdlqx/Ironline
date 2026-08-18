import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { missionTickBudget } from './missionClock';

describe('mission clock', () => {
  it.each([
    ['skirmish_ridge', 300, 6_000],
    ['causeway_crossing', 420, 8_400],
    ['base_capture_ridge', 480, 9_600],
    ['training_ground', 600, 12_000],
  ])('gives %s its authored %i-second budget', (missionId, seconds, ticks) => {
    expect(catalog.missions.get(missionId)?.maxDurationSeconds).toBe(seconds);
    expect(missionTickBudget(catalog, missionId)).toBe(ticks);
  });

  it('rejects a mission the catalog does not contain', () => {
    expect(() => missionTickBudget(catalog, 'missing')).toThrow(/unknown mission/);
  });
});
