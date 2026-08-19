import type { Catalog } from '../schema/load';
import { dailyPayroll, payrollThrough } from './ledger';
import type { CampaignState } from './types';

export interface ContractCommitment {
  currentDay: number;
  deadlineDay: number;
  daysRemaining: number;
  dailyPayroll: number;
  wagesThroughDeadline: number;
}

export function contractCommitment(
  catalog: Catalog,
  state: CampaignState,
  deadlineDay: number,
): ContractCommitment {
  const daysRemaining = Math.max(0, deadlineDay - state.day);
  return {
    currentDay: state.day,
    deadlineDay,
    daysRemaining,
    dailyPayroll: dailyPayroll(catalog, state),
    wagesThroughDeadline: payrollThrough(catalog, state, daysRemaining),
  };
}

export function formatMissionClock(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds - minutes * 60;
  const precision = Number.isInteger(seconds) ? 0 : 1;
  return `${minutes}:${seconds.toFixed(precision).padStart(precision === 0 ? 2 : 4, '0')}`;
}
