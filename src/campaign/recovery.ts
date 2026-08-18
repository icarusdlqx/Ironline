import type { Catalog } from '../schema/load';
import type { CampaignState, Contract } from './types';

export interface ContractFailure {
  reopens: boolean;
  recoveryCost: number;
  recoveryDays: number;
}

export function applyContractFailure(
  catalog: Catalog,
  state: CampaignState,
  contract: Contract,
): ContractFailure {
  const campaign = catalog.campaigns.get(state.campaignId);
  const reopens = campaign?.nodes.some((node) => node.id === contract.nodeId) ?? false;

  if (!reopens) {
    if (!state.failedNodes.includes(contract.nodeId)) state.failedNodes.push(contract.nodeId);
    return { reopens: false, recoveryCost: 0, recoveryDays: 0 };
  }

  const rules = catalog.rules.economy.contractFailure;
  const recoveryCost = Math.round(contract.payout * rules.recoveryCostFactor);
  state.cbills -= recoveryCost;
  state.failedNodes = state.failedNodes.filter((nodeId) => nodeId !== contract.nodeId);

  return { reopens: true, recoveryCost, recoveryDays: rules.recoveryDays };
}

export function recoveryNotice(failure: ContractFailure): string {
  if (!failure.reopens) return '';
  const noun = failure.recoveryDays === 1 ? 'day' : 'days';
  return (
    ` Recovery costs ${failure.recoveryCost} credits and ${failure.recoveryDays} ${noun}.` +
    ' The contract returns to the board.'
  );
}
