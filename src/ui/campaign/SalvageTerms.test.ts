import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import {
  hullRecoveryOdds,
  partRecoveryOdds,
  salvageRightsExplanation,
  salvageStance,
  SalvageTerms,
} from './SalvageTerms';

describe('salvage terms copy', () => {
  it('names the current place in the cash-for-salvage trade', () => {
    expect(salvageStance(0, 8)).toBe('Cash first');
    expect(salvageStance(4, 8)).toBe('Balanced');
    expect(salvageStance(7, 8)).toBe('Salvage first');
  });

  it('makes zero rights and recovery odds explicit', () => {
    expect(salvageRightsExplanation(0)).toMatch(/cannot be recovered/);
    expect(salvageRightsExplanation(0.45)).toMatch(/45% claim multiplies the field odds/);
    expect(salvageRightsExplanation(0.45)).toContain(
      'both legs destroyed, the mech still operational, and its side defeated',
    );
  });

  it('shows authored field odds beside the selected package odds', () => {
    const rules = catalog.rules.salvage;
    const odds = hullRecoveryOdds(rules, 0.5);

    expect(odds).toEqual([
      { outcome: 'legged', label: 'Both legs destroyed; side defeated', base: '85%', package: '42.5%' },
      { outcome: 'head', label: 'Head destroyed', base: '45%', package: '22.5%' },
      { outcome: 'centre_torso', label: 'Centre torso destroyed', base: '20%', package: '10%' },
      { outcome: 'ammo_explosion', label: 'Ammo explosion', base: '5%', package: '2.5%' },
    ]);
    expect(partRecoveryOdds(rules, 0.5)).toContain(
      'Weapon in an intact location 60%–90% base → 30%–45% package',
    );
    expect(partRecoveryOdds(rules, 0.5)).toContain('equipment in an intact location 70% → 35%');
    expect(partRecoveryOdds(rules, 0.5)).toContain('destroyed location 15% → 7.5%');
  });

  it('does not advertise outcomes the battle cannot currently produce', () => {
    const html = renderToStaticMarkup(
      createElement(SalvageTerms, {
        option: { id: 'salvage_first', name: 'Salvage first', payout: 100, salvageShare: 0.5 },
        step: 2,
        steps: 3,
        rules: catalog.rules.salvage,
      }),
    );

    expect(html).toContain('A rich field offers up to 5 crate types; the hold takes 3.');
    expect(html).not.toMatch(/eject|heat/i);
  });
});
