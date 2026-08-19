import type { Campaign, CampaignNode } from '../../schema/campaign';
import type { Contract } from '../../campaign/types';
import { employerDisplayName, type EmployerHistory } from '../../campaign/employers';

export function resolveCurrentEmployer(
  campaign: Campaign,
  contract: Contract | null,
  node: CampaignNode | null,
  employers: readonly EmployerHistory[],
): EmployerHistory | null {
  const employerId = contract?.employerId ?? node?.employerId;
  if (employerId === undefined) return null;
  return (
    employers.find((record) => record.id === employerId) ?? {
      id: employerId,
      name: employerDisplayName(campaign, employerId, contract?.employerName),
      completed: 0,
      failed: 0,
      withdrawn: 0,
      expired: 0,
      paid: 0,
    }
  );
}
