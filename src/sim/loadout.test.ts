import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { LOCATIONS } from '../schema/common';
import type { Design } from '../schema/design';
import { computeHeatProfile, computeLoadout, engineWeightFor } from './loadout';

function designOf(id: string): Design {
  const design = catalog.designs.get(id);
  if (design === undefined) throw new Error(`missing design ${id}`);
  return design;
}

function clone(id: string): Design {
  return JSON.parse(JSON.stringify(designOf(id))) as Design;
}

describe('shipped content', () => {
  it('every design is a legal build', () => {
    for (const design of catalog.designs.values()) {
      const loadout = computeLoadout(catalog, design);
      expect(
        loadout.valid,
        `${design.name}: ${loadout.issues.map((issue) => issue.message).join('; ')}`,
      ).toBe(true);
    }
  });

  it('every design spends nearly all of its tonnage', () => {
    for (const design of catalog.designs.values()) {
      const loadout = computeLoadout(catalog, design);
      expect(loadout.freeTonnage).toBeGreaterThanOrEqual(0);
      expect(loadout.freeTonnage).toBeLessThan(loadout.tonnage * 0.1);
    }
  });

  it('lists an engine weight for every chassis rating', () => {
    for (const chassis of catalog.chassis.values()) {
      expect(engineWeightFor(catalog, chassis.engineRating)).not.toBeNull();
    }
  });
});

describe('tonnage accounting', () => {
  const loadout = computeLoadout(catalog, designOf('sentinel_brawler'));

  it('adds up to the chassis tonnage', () => {
    const sum =
      loadout.engineWeight +
      loadout.structureWeight +
      loadout.armourWeight +
      loadout.heatSinkWeight +
      loadout.payloadWeight;
    expect(sum).toBeCloseTo(loadout.usedWeight, 6);
    expect(loadout.freeTonnage).toBeCloseTo(loadout.tonnage - loadout.usedWeight, 6);
  });

  it('derives structure weight from the chassis tonnage', () => {
    expect(loadout.structureWeight).toBeCloseTo(
      loadout.tonnage * catalog.rules.construction.structureWeightFraction,
      6,
    );
  });

  it('derives armour weight from allocated points', () => {
    expect(loadout.armourWeight).toBeCloseTo(
      loadout.armourPoints / catalog.rules.construction.armourPointsPerTon,
      1,
    );
  });

  it('charges nothing for heat sinks the chassis already carries', () => {
    const chassis = catalog.chassis.get('sentinel_snl2');
    const design = clone('sentinel_brawler');
    design.heatSinks = chassis?.internalHeatSinks ?? 10;
    expect(computeLoadout(catalog, design).heatSinkWeight).toBe(0);
  });

  it('charges for heat sinks beyond the internal count', () => {
    const design = clone('sentinel_brawler');
    const before = computeLoadout(catalog, design);
    design.heatSinks += 4;
    const after = computeLoadout(catalog, design);
    expect(after.heatSinkWeight).toBeGreaterThan(before.heatSinkWeight);
    expect(after.extraHeatSinks).toBe(before.extraHeatSinks + 4);
  });
});

describe('validation', () => {
  it('rejects a build that is over tonnage', () => {
    const design = clone('sentinel_brawler');
    design.mounts.push({ weaponId: 'gauss_rifle', location: 'right_arm' });
    design.ammo.push({ weaponId: 'gauss_rifle', location: 'right_torso', tons: 2 });

    const loadout = computeLoadout(catalog, design);
    expect(loadout.valid).toBe(false);
    expect(loadout.issues.some((issue) => issue.code === 'overweight')).toBe(true);
    expect(loadout.freeTonnage).toBeLessThan(0);
  });

  it('rejects a weapon with no matching hardpoint', () => {
    const design = clone('sentinel_brawler');
    design.mounts.push({ weaponId: 'medium_laser', location: 'right_arm' });

    const loadout = computeLoadout(catalog, design);
    expect(loadout.valid).toBe(false);
    expect(
      loadout.issues.some((issue) => issue.code === 'hardpoint' && issue.location === 'right_arm'),
    ).toBe(true);
  });

  it('rejects a location with more slots used than available', () => {
    const design = clone('rampart_breaker');
    design.ammo.push({ weaponId: 'ac20', location: 'centre_torso', tons: 9 });

    const loadout = computeLoadout(catalog, design);
    expect(loadout.valid).toBe(false);
    expect(
      loadout.issues.some((issue) => issue.code === 'slots' && issue.location === 'centre_torso'),
    ).toBe(true);
  });

  it('rejects armour above the chassis maximum', () => {
    const design = clone('sentinel_brawler');
    design.armour.head += 100;

    const loadout = computeLoadout(catalog, design);
    expect(loadout.valid).toBe(false);
    expect(loadout.issues.some((issue) => issue.code === 'armour')).toBe(true);
  });

  it('rejects fewer heat sinks than the chassis carries internally', () => {
    const design = clone('sentinel_brawler');
    design.heatSinks = 1;

    const loadout = computeLoadout(catalog, design);
    expect(loadout.valid).toBe(false);
    expect(loadout.issues.some((issue) => issue.code === 'heat_sinks')).toBe(true);
  });

  it('rejects ammo for a weapon that uses none', () => {
    const design = clone('sentinel_brawler');
    design.ammo.push({ weaponId: 'medium_laser', location: 'right_torso', tons: 1 });
    expect(computeLoadout(catalog, design).issues.some((issue) => issue.code === 'ammo')).toBe(true);
  });

  it('reports an unknown chassis without throwing', () => {
    const design = clone('sentinel_brawler');
    design.chassisId = 'no_such_chassis';

    const loadout = computeLoadout(catalog, design);
    expect(loadout.valid).toBe(false);
    expect(loadout.issues[0]?.code).toBe('unknown_chassis');
  });

  it('reports unknown weapons and equipment', () => {
    const design = clone('sentinel_brawler');
    design.mounts.push({ weaponId: 'no_such_gun', location: 'left_arm' });
    design.equipment.push({ equipmentId: 'no_such_kit', location: 'left_arm' });

    const codes = computeLoadout(catalog, design).issues.map((issue) => issue.code);
    expect(codes).toContain('unknown_weapon');
    expect(codes).toContain('unknown_equipment');
  });

  it('counts hardpoints and slots per location', () => {
    const loadout = computeLoadout(catalog, designOf('bulwark_assault'));
    expect(loadout.perLocation.left_arm.hardpointsUsed.energy).toBe(2);
    expect(loadout.perLocation.left_torso.hardpointsUsed.missile).toBe(2);

    for (const location of LOCATIONS) {
      const usage = loadout.perLocation[location];
      expect(usage.slotsUsed).toBeLessThanOrEqual(usage.slotsAvailable);
    }
  });

  it('checks unplaced heat sinks against the whole chassis', () => {
    const design = clone('wisp_harasser');
    design.heatSinks = 40;
    const loadout = computeLoadout(catalog, design);
    expect(loadout.issues.some((issue) => issue.code === 'slots' && issue.location === null)).toBe(
      true,
    );
  });
});

describe('heat profile', () => {
  it('sums alpha strike heat across every mount', () => {
    const design = designOf('bulwark_burner');
    const expected = design.mounts.reduce(
      (sum, mount) => sum + (catalog.weapons.get(mount.weaponId)?.heat ?? 0),
      0,
    );
    expect(computeHeatProfile(catalog, design).alphaStrikeHeat).toBe(expected);
  });

  it('derives sustained heat from cooldowns', () => {
    const design = designOf('sentinel_sniper');
    const expected = design.mounts.reduce((sum, mount) => {
      const weapon = catalog.weapons.get(mount.weaponId);
      return sum + (weapon === undefined ? 0 : weapon.heat / weapon.cooldown);
    }, 0);
    expect(computeHeatProfile(catalog, design).heatPerSecond).toBeCloseTo(expected, 6);
  });

  it('scales dissipation with sink count and type', () => {
    const single = clone('sentinel_sniper');
    const double = clone('sentinel_sniper');
    double.heatSinkId = 'double_heat_sink';

    expect(computeHeatProfile(catalog, double).dissipationPerSecond).toBeGreaterThan(
      computeHeatProfile(catalog, single).dissipationPerSecond,
    );
  });

  it('flags a ballistic build as sustainable and an energy build as not', () => {
    expect(computeHeatProfile(catalog, designOf('rampart_breaker')).sustainable).toBe(true);
    expect(computeHeatProfile(catalog, designOf('sentinel_sniper')).sustainable).toBe(false);
  });

  it('reports no shutdown time for a sustainable build', () => {
    const profile = computeHeatProfile(catalog, designOf('rampart_breaker'));
    expect(profile.secondsToShutdownRisk).toBeNull();
    expect(profile.secondsToForcedShutdown).toBeNull();
    expect(profile.alphaSafe).toBe(true);
  });

  it('shortens time to shutdown as sinks are removed', () => {
    const cool = clone('bulwark_burner');
    const hot = clone('bulwark_burner');
    hot.heatSinks = 12;

    const coolProfile = computeHeatProfile(catalog, cool);
    const hotProfile = computeHeatProfile(catalog, hot);
    expect(hotProfile.secondsToShutdownRisk ?? Infinity).toBeLessThan(
      coolProfile.secondsToShutdownRisk ?? Infinity,
    );
  });

  it('measures the climb from the alpha strike, not from a cold reactor', () => {
    const design = designOf('sentinel_sniper');
    const profile = computeHeatProfile(catalog, design);
    expect(profile.secondsToShutdownRisk).not.toBeNull();

    const naive =
      (profile.shutdownRiskFraction * profile.heatCapacity) / profile.netHeatPerSecond;
    expect(profile.secondsToShutdownRisk ?? 0).toBeLessThan(naive);
  });

  it('marks a build whose alpha strike alone risks shutdown', () => {
    const design = clone('bulwark_burner');
    design.heatSinks = 12;
    const profile = computeHeatProfile(catalog, design);
    expect(profile.alphaStrikeHeat).toBeGreaterThan(0);
    expect(profile.alphaSafe).toBe(profile.alphaStrikeHeat < 0.85 * profile.heatCapacity);
  });
});
