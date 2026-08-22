import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCATIONS } from '../schema/common';
import { CommandPalette } from './CommandPalette';
import { LanceBar, WeaponGroups } from './Panels';
import type { LocationSnapshot, UnitSnapshot } from './store';

const LOCATION: LocationSnapshot = {
  armour: 10,
  armourMax: 10,
  rearArmour: 0,
  rearArmourMax: 0,
  internal: 8,
  internalMax: 8,
  destroyed: false,
};

const UNIT: UnitSnapshot = {
  id: 7,
  team: 0,
  name: 'Halberd',
  pilotName: 'Kessa Vale',
  pilotSkills: { gunnery: 3, piloting: 3, sensors: 3 },
  pilotTraits: [],
  tonnage: 55,
  alive: true,
  destroyed: false,
  killMethod: null,
  heat: 0,
  heatCapacity: 30,
  shutdownRemaining: 0,
  downRemaining: 0,
  staggered: false,
  motion: 'stationary',
  targetName: null,
  targetRange: null,
  rangeToLance: 0,
  lostLocations: [],
  locations: Object.fromEntries(
    LOCATIONS.map((location) => [location, { ...LOCATION }]),
  ) as UnitSnapshot['locations'],
  weapons: [
    {
      index: 0,
      name: 'Medium Laser',
      group: 1,
      cooldown: 0,
      cooldownMax: 2,
      destroyed: false,
      rounds: null,
      shortRange: 180,
      longRange: 360,
      location: 'right_arm',
    },
    {
      index: 1,
      name: 'Autocannon',
      group: 2,
      cooldown: 0,
      cooldownMax: 3,
      destroyed: false,
      rounds: 12,
      shortRange: 240,
      longRange: 540,
      location: 'left_arm',
    },
  ],
  groupEnabled: [true, false, true, true],
  holdingFire: false,
  heatSafety: false,
  ability: { label: 'Ability', note: 'Ready.', ready: true, activeRemaining: 0, cooldownRemaining: 0 },
  alpha: { label: 'Alpha Strike', note: 'Ready.', ready: true, activeRemaining: 0, cooldownRemaining: 0 },
  stability: { value: 0, staggerAt: 10, knockdownAt: 20, footingRemaining: 0 },
  reactor: {
    alphaHeat: 0,
    projectedFraction: 0,
    projectedBand: 'cold',
    projectedTone: 'ok',
    governorHoldAt: 0.8,
    governorResumeAt: 0.5,
    shedGroups: [],
  },
  hasMoveOrder: false,
  jumpRange: 0,
  jumpCooldown: 0,
  canJump: false,
  posture: 'hold_position',
  identified: true,
  sensorRange: 600,
};

function buttonTag(markup: string, testId: string): string {
  return markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? '';
}

describe('battle control state semantics', () => {
  it('exposes the active command state to assistive controls', () => {
    const markup = renderToStaticMarkup(
      createElement(CommandPalette, {
        orderMode: 'move',
        enabled: true,
        holdingFire: false,
        heatSafety: false,
        ability: UNIT.ability,
        alpha: UNIT.alpha,
        jump: null,
        posture: UNIT.posture,
        onCommand: () => undefined,
      }),
    );

    expect(buttonTag(markup, 'command-move')).toContain('aria-pressed="true"');
    expect(buttonTag(markup, 'command-run')).toContain('aria-pressed="false"');
    expect(buttonTag(markup, 'command-hold_position')).toContain('aria-pressed="true"');
  });

  it('omits commands the current training lesson has not introduced', () => {
    const markup = renderToStaticMarkup(
      createElement(CommandPalette, {
        orderMode: null,
        enabled: true,
        holdingFire: false,
        heatSafety: false,
        ability: UNIT.ability,
        alpha: UNIT.alpha,
        jump: null,
        posture: UNIT.posture,
        visibleCommandIds: new Set(['move']),
        onCommand: () => undefined,
      }),
    );

    expect(markup).toContain('data-testid="command-move"');
    expect(markup).not.toContain('data-testid="command-attack"');
    expect(markup).not.toContain('data-testid="command-hold_fire"');
  });

  it('exposes weapon toggles and lance selection as pressed states', () => {
    const weapons = renderToStaticMarkup(
      createElement(WeaponGroups, { unit: UNIT, onToggleGroup: () => undefined }),
    );
    const lance = renderToStaticMarkup(
      createElement(LanceBar, {
        units: [UNIT, { ...UNIT, id: 8, pilotName: 'Dorn Hess' }],
        selection: [UNIT.id],
        onSelect: () => undefined,
      }),
    );

    expect(buttonTag(weapons, 'group-1')).toContain('aria-pressed="true"');
    expect(buttonTag(weapons, 'group-2')).toContain('aria-pressed="false"');
    expect(buttonTag(lance, 'lance-card-7')).toContain('aria-pressed="true"');
    expect(buttonTag(lance, 'lance-card-8')).toContain('aria-pressed="false"');
  });
});
