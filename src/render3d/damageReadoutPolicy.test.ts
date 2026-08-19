import { describe, expect, it } from 'vitest';
import {
  READOUT_PRIORITY,
  compactReadouts,
  readoutBudget,
  readoutLabel,
  readoutLife,
  readoutPriority,
  type ReadoutFacts,
} from './damageReadoutPolicy';

function facts(overrides: Partial<ReadoutFacts> = {}): ReadoutFacts {
  return {
    armour: 0,
    structure: 0,
    misses: 0,
    criticalCount: 0,
    criticals: new Set<string>(),
    lostLocations: new Set(),
    ammo: 0,
    priority: READOUT_PRIORITY.miss,
    ...overrides,
  };
}

describe('damage readout policy', () => {
  it('ranks terminal and lasting consequences above projectile traffic', () => {
    expect(readoutPriority({ location: null, misses: 1 })).toBe(READOUT_PRIORITY.miss);
    expect(readoutPriority({ location: 'left_arm', armour: 5 })).toBe(READOUT_PRIORITY.armour);
    expect(readoutPriority({ location: 'left_arm', structure: 2 })).toBe(
      READOUT_PRIORITY.structure,
    );
    expect(readoutPriority({ location: 'left_arm', critical: 'weapon' })).toBe(
      READOUT_PRIORITY.critical,
    );
    expect(readoutPriority({ location: 'left_arm', locationLost: true })).toBe(
      READOUT_PRIORITY.major,
    );
    expect(readoutPriority({ location: 'centre_torso', destroyed: true })).toBe(
      READOUT_PRIORITY.terminal,
    );
  });

  it('shows only the strongest useful statement in a burst', () => {
    expect(readoutLabel(facts({ armour: 9, misses: 4, priority: 1 }), false)).toBe('-9 ARMOUR');
    expect(readoutLabel(facts({ armour: 9, structure: 3, priority: 2 }), false)).toBe(
      '-3 STRUCTURE',
    );
    expect(
      readoutLabel(
        facts({
          structure: 3,
          criticalCount: 1,
          criticals: new Set(['actuator']),
          priority: 3,
        }),
        false,
      ),
    ).toBe('-3 STRUCTURE · CRITICAL: ACTUATOR');
    expect(
      readoutLabel(
        facts({ lostLocations: new Set(['left_arm', 'right_arm']), priority: 4 }),
        false,
      ),
    ).toBe('LEFT ARM / RIGHT ARM LOST');
    expect(readoutLabel(facts({ ammo: 25, priority: 5 }), false)).toBe('DESTROYED');
  });

  it('suppresses phone chips and keeps a small visible budget', () => {
    expect(readoutLabel(facts({ armour: 3.9, priority: 1 }), true)).toBe('');
    expect(readoutLabel(facts({ armour: 4, priority: 1 }), true)).toBe('-4 ARMOUR');
    expect(readoutBudget(390)).toBe(4);
    expect(readoutBudget(844, 390)).toBe(4);
    expect(readoutBudget(1280)).toBe(8);
    expect(compactReadouts(844, 390)).toBe(true);
    expect(readoutLife(READOUT_PRIORITY.miss)).toBeLessThan(
      readoutLife(READOUT_PRIORITY.terminal),
    );
  });
});
