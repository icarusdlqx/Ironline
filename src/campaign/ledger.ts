import type { Catalog } from '../schema/load';
import type { CampaignState } from './types';

/** Wages paid each time the campaign calendar advances by one day. */
export function dailyPayroll(catalog: Catalog, state: CampaignState): number {
  const living = state.pilots.filter((pilot) => !pilot.dead).length;
  return living * catalog.rules.economy.pilot.salaryPerDay;
}

/** Wages that will leave the account while a fixed wait runs its course. */
export function payrollThrough(catalog: Catalog, state: CampaignState, days: number): number {
  return dailyPayroll(catalog, state) * Math.max(0, days);
}
