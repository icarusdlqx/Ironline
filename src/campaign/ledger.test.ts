import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { advanceDays, startCampaign } from './campaign';
import { dailyPayroll, payrollThrough } from './ledger';

describe('campaign ledger', () => {
  it('charges every living pilot for every day waited', () => {
    const state = startCampaign(catalog, 'border_dispute', 'ledger');
    const salary = catalog.rules.economy.pilot.salaryPerDay;

    expect(dailyPayroll(catalog, state)).toBe(state.pilots.length * salary);
    expect(payrollThrough(catalog, state, 3)).toBe(state.pilots.length * salary * 3);

    const pilot = state.pilots[0];
    if (pilot === undefined) throw new Error('campaign has no pilots');
    pilot.dead = true;
    expect(dailyPayroll(catalog, state)).toBe((state.pilots.length - 1) * salary);
  });

  it('does not turn an already-finished wait into income', () => {
    const state = startCampaign(catalog, 'border_dispute', 'ledger');
    expect(payrollThrough(catalog, state, -2)).toBe(0);
  });

  it('books the projected payroll when the calendar moves', () => {
    const state = startCampaign(catalog, 'border_dispute', 'ledger');
    const perDay = dailyPayroll(catalog, state);
    const before = state.cbills;

    advanceDays(catalog, state, 2);

    expect(state.cbills).toBe(before - perDay * 2);
    expect(state.log[0]?.text).toBe(`Payroll: ${perDay * 2} credits.`);
  });
});
