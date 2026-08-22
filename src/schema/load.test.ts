import { describe, expect, it } from 'vitest';
import { ChassisSchema } from './chassis';
import { LOCATIONS } from './common';
import { EquipmentSchema } from './equipment';
import { FactionSchema } from './faction';
import { loadCatalog } from './load';
import { RangeBandsSchema, WeaponSchema } from './weapon';

const catalog = loadCatalog();

describe('content catalog', () => {
  it('loads every /data file without a validation issue', () => {
    expect(() => loadCatalog()).not.toThrow();
  });

  it('meets the Phase 0 content floor', () => {
    expect(catalog.chassis.size).toBeGreaterThanOrEqual(3);
    expect(catalog.weapons.size).toBeGreaterThanOrEqual(8);
    expect(catalog.equipment.size).toBeGreaterThanOrEqual(1);
  });

  it('keys every entry by its own id', () => {
    for (const [id, chassis] of catalog.chassis) expect(chassis.id).toBe(id);
    for (const [id, weapon] of catalog.weapons) expect(weapon.id).toBe(id);
    for (const [id, equipment] of catalog.equipment) expect(equipment.id).toBe(id);
  });

  it('gives every chassis a complete set of damage locations', () => {
    for (const chassis of catalog.chassis.values()) {
      for (const location of LOCATIONS) {
        expect(chassis.hardpoints[location]).toBeDefined();
        expect(chassis.armourMax[location]).toBeGreaterThan(0);
        expect(chassis.internals[location]).toBeGreaterThan(0);
      }
    }
  });

  it('covers all three weapon families', () => {
    const families = new Set([...catalog.weapons.values()].map((weapon) => weapon.type));
    expect([...families].sort()).toEqual(['ballistic', 'energy', 'missile']);
  });

  it('assigns weapon source by construction', () => {
    for (const weapon of catalog.weapons.values()) {
      const expected = weapon.type === 'energy' && weapon.id !== 'flamer' ? 'aurelian' : 'linewrought';
      expect(weapon.faction, weapon.id).toBe(expected);
    }
  });
});

const VALID_CHASSIS = {
  id: 'probe_pb1',
  name: 'Probe PB-1',
  faction: 'linewrought' as const,
  class: 'medium',
  tonnage: 45,
  baseCost: 3400000,
  engineRating: 270,
  internalHeatSinks: 10,
  jumpCapable: false,
  hardpoints: Object.fromEntries(
    LOCATIONS.map((location) => [location, { energy: 1, ballistic: 0, missile: 0, slots: 2 }]),
  ),
  armourMax: Object.fromEntries(LOCATIONS.map((location) => [location, 20])),
  internals: Object.fromEntries(LOCATIONS.map((location) => [location, 10])),
  traits: [],
};

describe('chassis schema', () => {
  it('accepts a well-formed chassis', () => {
    expect(ChassisSchema.safeParse(VALID_CHASSIS).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(ChassisSchema.safeParse({ ...VALID_CHASSIS, armorMax: 10 }).success).toBe(false);
  });

  it('rejects a missing damage location', () => {
    const { head: _head, ...partial } = VALID_CHASSIS.armourMax;
    expect(ChassisSchema.safeParse({ ...VALID_CHASSIS, armourMax: partial }).success).toBe(false);
  });

  it('rejects more weapon mounts than slots', () => {
    const hardpoints = {
      ...VALID_CHASSIS.hardpoints,
      left_arm: { energy: 2, ballistic: 2, missile: 0, slots: 3 },
    };
    expect(ChassisSchema.safeParse({ ...VALID_CHASSIS, hardpoints }).success).toBe(false);
  });

  it('rejects non-positive internal structure', () => {
    const internals = { ...VALID_CHASSIS.internals, head: 0 };
    expect(ChassisSchema.safeParse({ ...VALID_CHASSIS, internals }).success).toBe(false);
  });
});

const VALID_WEAPON = {
  id: 'probe_gun',
  name: 'Probe Gun',
  faction: 'linewrought' as const,
  type: 'ballistic',
  tonnage: 8,
  slots: 4,
  damage: 5,
  projectiles: 1,
  heat: 1,
  cooldown: 2,
  velocity: 700,
  range: { min: 0, short: 120, medium: 240, long: 360 },
  ammoPerTon: 20,
  cost: 125000,
  recoil: 0.12,
};

const VALID_EQUIPMENT = {
  id: 'probe_sink',
  name: 'Probe Sink',
  faction: 'linewrought' as const,
  category: 'heat_sink' as const,
  tonnage: 1,
  slots: 1,
  cost: 2000,
};

describe('faction schema', () => {
  it('accepts the two machine cultures', () => {
    expect(FactionSchema.options).toEqual(['linewrought', 'aurelian']);
  });

  it('is required on chassis, weapons and equipment', () => {
    const { faction: _chassisFaction, ...chassis } = VALID_CHASSIS;
    const { faction: _weaponFaction, ...weapon } = VALID_WEAPON;
    const { faction: _equipmentFaction, ...equipment } = VALID_EQUIPMENT;

    expect(ChassisSchema.safeParse(chassis).success).toBe(false);
    expect(WeaponSchema.safeParse(weapon).success).toBe(false);
    expect(EquipmentSchema.safeParse(equipment).success).toBe(false);
  });

  it('rejects an unsupported source', () => {
    expect(ChassisSchema.safeParse({ ...VALID_CHASSIS, faction: 'compact' }).success).toBe(false);
    expect(WeaponSchema.safeParse({ ...VALID_WEAPON, faction: 'compact' }).success).toBe(false);
    expect(EquipmentSchema.safeParse({ ...VALID_EQUIPMENT, faction: 'compact' }).success).toBe(
      false,
    );
  });
});

describe('weapon schema', () => {
  it('defaults accuracy and tags', () => {
    const parsed = WeaponSchema.parse(VALID_WEAPON);
    expect(parsed.accuracy).toBe(1);
    expect(parsed.tags).toEqual([]);
  });

  it('requires ammo and velocity on ballistic and missile weapons', () => {
    expect(WeaponSchema.safeParse({ ...VALID_WEAPON, ammoPerTon: null }).success).toBe(false);
    expect(WeaponSchema.safeParse({ ...VALID_WEAPON, velocity: null }).success).toBe(false);
  });

  it('forbids ammo and travel time on energy weapons', () => {
    const energy = { ...VALID_WEAPON, type: 'energy' as const };
    expect(WeaponSchema.safeParse(energy).success).toBe(false);
    expect(
      WeaponSchema.safeParse({ ...energy, ammoPerTon: null, velocity: null }).success,
    ).toBe(true);
  });

  it('requires strictly increasing range bands', () => {
    expect(RangeBandsSchema.safeParse({ min: 0, short: 200, medium: 100, long: 300 }).success).toBe(
      false,
    );
    expect(RangeBandsSchema.safeParse({ min: 120, short: 120, medium: 240, long: 360 }).success).toBe(
      false,
    );
  });
});

describe('equipment schema', () => {
  it('accepts a well-formed item and defaults its stat block', () => {
    const parsed = EquipmentSchema.parse(VALID_EQUIPMENT);
    expect(parsed.stats).toEqual({});
    expect(parsed.tags).toEqual([]);
  });

  it('rejects an unknown category', () => {
    expect(
      EquipmentSchema.safeParse({
        ...VALID_EQUIPMENT,
        category: 'reactor',
      }).success,
    ).toBe(false);
  });
});
