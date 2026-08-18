import type { Campaign } from '../schema/campaign';
import type { Catalog } from '../schema/load';
import type {
  CampaignState,
  Contract,
  EmployerFailure,
  MissionOutcome,
} from './types';

export const UNKNOWN_EMPLOYER_ID = 'unknown_employer';
export const UNKNOWN_EMPLOYER_NAME = 'Independent employer';
export const EMPLOYER_FAILURE_LIMIT = 200;

export interface EmployerIdentity {
  id: string;
  name: string;
}

export interface EmployerHistory extends EmployerIdentity {
  completed: number;
  failed: number;
  withdrawn: number;
  expired: number;
  paid: number;
}

function normalizedName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');
}

function legacyId(name: string): string {
  const normalized = normalizedName(name);
  const stem = normalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'employer';
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `legacy_${stem}_${(hash >>> 0).toString(36)}`;
}

export function legacyEmployer(name: string): EmployerIdentity {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    return { id: UNKNOWN_EMPLOYER_ID, name: UNKNOWN_EMPLOYER_NAME };
  }
  return { id: legacyId(trimmed), name: trimmed };
}

export function employerById(campaign: Campaign, employerId: string): EmployerIdentity {
  const employer = campaign.employers.find((entry) => entry.id === employerId);
  return employer ?? { id: employerId || UNKNOWN_EMPLOYER_ID, name: UNKNOWN_EMPLOYER_NAME };
}

export function canonicalEmployer(campaign: Campaign, legacyName: string): EmployerIdentity {
  const normalized = normalizedName(legacyName);
  const employer = campaign.employers.find(
    (entry) => normalizedName(entry.name) === normalized,
  );
  if (employer !== undefined) return employer;

  return legacyEmployer(legacyName);
}

export function employerDisplayName(
  campaign: Campaign,
  employerId: string,
  savedName?: string,
): string {
  const known = campaign.employers.find((entry) => entry.id === employerId);
  if (known !== undefined) return known.name;
  if (savedName === undefined || savedName === UNKNOWN_EMPLOYER_NAME) return UNKNOWN_EMPLOYER_NAME;
  return `${UNKNOWN_EMPLOYER_NAME} — ${savedName}`;
}

export function employerNameFor(
  catalog: Catalog,
  campaignId: string,
  employerId: string,
  savedName?: string,
): string {
  const campaign = catalog.campaigns.get(campaignId);
  if (campaign === undefined) return savedName ?? UNKNOWN_EMPLOYER_NAME;
  return employerDisplayName(campaign, employerId, savedName);
}

export function recordEmployerFailure(
  catalog: Catalog,
  state: CampaignState,
  contract: Contract,
  reason: EmployerFailure['reason'],
): string {
  const existingIndex = state.employerFailures.findIndex(
    (failure) => failure.employerId === contract.employerId && failure.reason === reason,
  );
  const existing =
    existingIndex < 0 ? null : (state.employerFailures.splice(existingIndex, 1)[0] ?? null);
  state.employerFailures.push(
    existing === null
      ? {
          employerId: contract.employerId,
          employerName: contract.employerName,
          day: state.day,
          reason,
          count: 1,
        }
      : {
          ...existing,
          employerName: contract.employerName,
          day: state.day,
          count: existing.count + 1,
        },
  );
  // Coalescing keeps ordinary campaigns below the ceiling. Imported identities
  // can outlive a registry, so the oldest summary yields if they fill the save.
  if (state.employerFailures.length > EMPLOYER_FAILURE_LIMIT) {
    state.employerFailures.splice(0, state.employerFailures.length - EMPLOYER_FAILURE_LIMIT);
  }
  return employerNameFor(
    catalog,
    state.campaignId,
    contract.employerId,
    contract.employerName,
  );
}

export function employerHistories(
  campaign: Campaign,
  history: readonly MissionOutcome[],
  failures: readonly EmployerFailure[] = [],
): EmployerHistory[] {
  const records = new Map<string, EmployerHistory>(
    campaign.employers.map((employer) => [
      employer.id,
      { ...employer, completed: 0, failed: 0, withdrawn: 0, expired: 0, paid: 0 },
    ]),
  );

  for (const outcome of history) {
    const current = records.get(outcome.employerId) ?? {
      id: outcome.employerId,
      name: employerDisplayName(campaign, outcome.employerId, outcome.employerName),
      completed: 0,
      failed: 0,
      withdrawn: 0,
      expired: 0,
      paid: 0,
    };
    if (outcome.won) current.completed += 1;
    else current.failed += 1;
    current.paid += outcome.payout;
    records.set(current.id, current);
  }

  for (const failure of failures) {
    const current = records.get(failure.employerId) ?? {
      id: failure.employerId,
      name: employerDisplayName(campaign, failure.employerId, failure.employerName),
      completed: 0,
      failed: 0,
      withdrawn: 0,
      expired: 0,
      paid: 0,
    };
    current.failed += failure.count;
    current[failure.reason] += failure.count;
    records.set(current.id, current);
  }

  return [...records.values()];
}

export function employerHistoryFor(
  campaign: Campaign,
  history: readonly MissionOutcome[],
  employerId: string,
  savedName?: string,
  failures: readonly EmployerFailure[] = [],
): EmployerHistory {
  return employerHistories(campaign, history, failures).find(
    (record) => record.id === employerId,
  ) ?? {
    id: employerId,
    name: employerDisplayName(campaign, employerId, savedName),
    completed: 0,
    failed: 0,
    withdrawn: 0,
    expired: 0,
    paid: 0,
  };
}
