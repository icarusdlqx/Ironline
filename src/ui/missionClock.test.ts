import { describe, expect, it } from 'vitest';
import {
  crossedMissionClockWarnings,
  formatMissionClock,
  missionClockUrgency,
} from './missionClock';

describe('battle clock readout', () => {
  it('rounds up so the opening second does not disappear on the first tick', () => {
    expect(formatMissionClock(300)).toBe('05:00');
    expect(formatMissionClock(299.95)).toBe('05:00');
    expect(formatMissionClock(0)).toBe('00:00');
  });

  it('uses restrained one-minute and final-fifteen-second states', () => {
    expect(missionClockUrgency(61)).toBe('steady');
    expect(missionClockUrgency(60)).toBe('minute');
    expect(missionClockUrgency(15)).toBe('final');
  });

  it('announces a threshold only when the clock crosses it', () => {
    expect(crossedMissionClockWarnings(60.05, 60)).toEqual([
      'Mission clock — one minute remains.',
    ]);
    expect(crossedMissionClockWarnings(60, 59.95)).toEqual([]);
    expect(crossedMissionClockWarnings(15.05, 15)).toEqual([
      'Mission clock — fifteen seconds remain.',
    ]);
  });
});
