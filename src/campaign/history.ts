import type { Catalog } from '../schema/load';
import { offerPeriod } from './sidework';
import type {
  CampaignState,
  EmployerOutcomeSummary,
  MissionOutcome,
} from './types';

function archivedCount(summary: EmployerOutcomeSummary): number {
  return summary.completed + summary.failed;
}

function archiveOutcome(state: CampaignState, outcome: MissionOutcome): void {
  const current = state.historyArchive.employers[outcome.employerId];
  state.historyArchive.employers[outcome.employerId] = {
    employerName: outcome.employerName,
    completed: (current?.completed ?? 0) + (outcome.won ? 1 : 0),
    failed: (current?.failed ?? 0) + (outcome.won ? 0 : 1),
    paid: (current?.paid ?? 0) + outcome.payout,
  };
}

function repairArchiveCount(state: CampaignState): void {
  state.historyArchive.outcomes = Object.values(state.historyArchive.employers).reduce(
    (total, summary) => total + archivedCount(summary),
    0,
  );
}

/** Old field reports last for one board period; the newest waits until another replaces it. */
export function pruneCampaignHistory(catalog: Catalog, state: CampaignState): void {
  repairArchiveCount(state);
  if (state.history.length < 2) return;

  const period = offerPeriod(catalog, state.day);
  const latest = state.history.at(-1);
  const retained: MissionOutcome[] = [];

  for (const outcome of state.history) {
    if (outcome === latest || offerPeriod(catalog, outcome.day) === period) {
      retained.push(outcome);
    } else {
      archiveOutcome(state, outcome);
    }
  }

  state.history = retained;
  repairArchiveCount(state);
}

/** The acknowledgement counter stays absolute even when old reports become totals. */
export function campaignOutcomeCount(state: CampaignState): number {
  return state.historyArchive.outcomes + state.history.length;
}

export function emptyHistoryArchive(): CampaignState['historyArchive'] {
  return { outcomes: 0, employers: {} };
}
