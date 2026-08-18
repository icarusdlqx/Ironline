import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { negotiationOptions, termsName } from './contractTerms';

describe('contract terms', () => {
  const node = catalog.campaigns.get('border_dispute')?.nodes[0];

  it('turns the authored limits into three legible packages', () => {
    if (node === undefined) throw new Error('missing opening contract');
    const options = negotiationOptions(catalog, node);
    const rules = catalog.rules.economy.negotiation;

    expect(options).toHaveLength(3);
    expect(options.map((option) => option.name)).toEqual([
      'Fee first',
      'Standard split',
      'Salvage first',
    ]);
    expect(options[0]?.payout).toBe(Math.round(node.basePayout * rules.payoutCeilingFactor));
    expect(options[1]?.payout).toBe(node.basePayout);
    expect(options[2]?.payout).toBe(Math.round(node.basePayout * rules.payoutFloorFactor));
    expect(options[0]?.salvageShare).toBe(0);
    expect(options[1]?.salvageShare).toBeCloseTo(node.maxSalvageShare / 2, 4);
    expect(options[2]?.salvageShare).toBe(node.maxSalvageShare);
  });

  it('names persisted terms without needing the original offer', () => {
    expect(termsName('salvage_first')).toBe('Salvage first');
  });
});
