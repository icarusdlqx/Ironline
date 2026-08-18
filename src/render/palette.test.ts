import { describe, expect, it } from 'vitest';
import { TEAM_COLOURS, teamColour } from './palette';

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(colour: number): number {
  return (
    linearChannel((colour >> 16) & 0xff) * 0.2126
    + linearChannel((colour >> 8) & 0xff) * 0.7152
    + linearChannel(colour & 0xff) * 0.0722
  );
}

describe('team palette', () => {
  it('separates every team by value as well as hue', () => {
    const values = TEAM_COLOURS.map(luminance);

    for (let left = 0; left < values.length; left += 1) {
      for (let right = left + 1; right < values.length; right += 1) {
        expect(Math.abs((values[left] ?? 0) - (values[right] ?? 0))).toBeGreaterThan(0.1);
      }
    }
  });

  it('cycles team ids through the accessible ramp', () => {
    expect(teamColour(TEAM_COLOURS.length)).toBe(TEAM_COLOURS[0]);
  });
});
