import { describe, expect, it } from 'vitest';
import { startCampaign } from '../../campaign/campaign';
import { addToStore } from '../../campaign/types';
import { catalog } from '../../../tests/support';
import { salvageItemFacts } from './salvageFacts';

describe('salvage item facts', () => {
  it('states a weapon mount, owned matches, and pre-haul count', () => {
    const state = startCampaign(catalog, 'border_dispute', 'salvage-facts');
    addToStore(state, 'weapon', 'medium_laser', 3);
    const item = { kind: 'weapon' as const, itemId: 'medium_laser', count: 2 };

    const facts = salvageItemFacts(catalog, state, item, 2);

    expect(facts.name).toBe('Medium Laser');
    expect(facts.kind).toBe('Weapon');
    expect(facts.specification).toBe('light energy hardpoint · 1t · 1 slot');
    expect(facts.fit).toContain('Bulwark BWK-3');
    expect(facts.ownedBefore).toBe(1);
    expect(facts.buildValue).toBe(80_000);
    expect(facts.saleBasis).toBe(36_000);
  });

  it('does not claim universal jump-gear compatibility', () => {
    const state = startCampaign(catalog, 'border_dispute', 'salvage-facts');
    const item = { kind: 'equipment' as const, itemId: 'jump_jet', count: 1 };

    const facts = salvageItemFacts(catalog, state, item, 0);

    expect(facts.kind).toBe('Equipment');
    expect(facts.specification).toBe('jump gear · 1t · 1 slot');
    expect(facts.fit).toMatch(/^Jump-capable owned chassis:/);
    expect(facts.fit).not.toContain('Sentinel SNL-2');
  });

  it('keeps a damaged-save item visible without inventing facts', () => {
    const state = startCampaign(catalog, 'border_dispute', 'salvage-facts');
    const item = { kind: 'equipment' as const, itemId: 'old_unknown_part', count: 1 };

    expect(salvageItemFacts(catalog, state, item, 0)).toMatchObject({
      name: 'old_unknown_part',
      kind: 'Unknown equipment',
      specification: 'No catalogue record',
      fit: 'Compatibility unavailable',
      buildValue: 0,
      saleBasis: 0,
    });
  });
});
