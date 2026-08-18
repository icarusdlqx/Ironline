import { describe, expect, it } from 'vitest';
import { salvageRightsExplanation, salvageStance } from './SalvageTerms';

describe('salvage terms copy', () => {
  it('names the current place in the cash-for-salvage trade', () => {
    expect(salvageStance(0, 8)).toBe('Cash first');
    expect(salvageStance(4, 8)).toBe('Balanced');
    expect(salvageStance(7, 8)).toBe('Salvage first');
  });

  it('makes zero rights and recovery odds explicit', () => {
    expect(salvageRightsExplanation(0)).toMatch(/cannot be recovered/);
    expect(salvageRightsExplanation(0.45)).toMatch(/45% claim scales each eligible recovery chance/);
    expect(salvageRightsExplanation(0.45)).toMatch(/hold takes 3/);
  });
});
