import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { buildSupportOptions, supportCallIds, supportRadius } from './supportOptions';

describe('contextual support calls', () => {
  it('keeps the standard palette to three distinct jobs', () => {
    expect(supportCallIds(0)).toEqual(['sensor_probe', 'air_strike', 'repair_truck']);
  });

  it('offers a mission reserve without growing the palette', () => {
    expect(supportCallIds(1)).toEqual(['air_strike', 'repair_truck', 'reinforcement']);
  });

  it('makes the reserve authored for Base Capture callable', () => {
    const mission = catalog.missions.get('base_capture_ridge');
    const ids = buildSupportOptions(catalog.rules.support, mission?.reserves.length ?? 0).map(
      (option) => option.id,
    );
    expect(ids).toContain('reinforcement');
    expect(ids).toHaveLength(3);

    const firstPost = mission?.zones[0];
    const afterFirstPost =
      (mission?.startingResourcePoints ?? 0) + (firstPost?.resourcePoints ?? 0);
    expect(afterFirstPost).toBeGreaterThanOrEqual(catalog.rules.support.reinforcement.cost);
  });
});

describe('support explanations', () => {
  it('takes cost and effect figures from the loaded rules', () => {
    const options = buildSupportOptions(catalog.rules.support, 1);
    const air = options.find((option) => option.id === 'air_strike');
    const reserve = options.find((option) => option.id === 'reinforcement');

    expect(air?.cost).toBe(catalog.rules.support.air_strike.cost);
    expect(air?.effect).toContain(`${catalog.rules.support.air_strike.length} ×`);
    expect(air?.effect).toContain(`${catalog.rules.support.air_strike.delaySeconds}s`);
    expect(reserve?.effect).toContain(`${catalog.rules.support.reinforcement.delaySeconds}s`);
  });

  it('returns placement radii only for calls that cover an area on the ground', () => {
    expect(supportRadius(catalog.rules.support, 'sensor_probe')).toBe(
      catalog.rules.support.sensor_probe.radius,
    );
    expect(supportRadius(catalog.rules.support, 'repair_truck')).toBe(
      catalog.rules.support.repair_truck.radius,
    );
    expect(supportRadius(catalog.rules.support, 'air_strike')).toBeNull();
  });
});
