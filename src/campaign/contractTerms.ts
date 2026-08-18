import type { CampaignNode } from '../schema/campaign';
import type { Catalog } from '../schema/load';
import type { ContractTermsId } from './types';

export interface NegotiationOption {
  id: ContractTermsId;
  name: string;
  payout: number;
  salvageShare: number;
}

const PACKAGES: ReadonlyArray<Pick<NegotiationOption, 'id' | 'name'>> = [
  { id: 'fee_first', name: 'Fee first' },
  { id: 'standard', name: 'Standard split' },
  { id: 'salvage_first', name: 'Salvage first' },
];

export function negotiationOptions(catalog: Catalog, node: CampaignNode): NegotiationOption[] {
  const rules = catalog.rules.economy.negotiation;

  return PACKAGES.map((terms, index) => {
    const t = index / (rules.steps - 1);
    const factor =
      rules.payoutCeilingFactor + (rules.payoutFloorFactor - rules.payoutCeilingFactor) * t;

    return {
      ...terms,
      payout: Math.round(node.basePayout * factor),
      salvageShare: Number((node.maxSalvageShare * t).toFixed(4)),
    };
  });
}

export function termsName(termsId: ContractTermsId): string {
  return PACKAGES.find((terms) => terms.id === termsId)?.name ?? 'Standard split';
}
