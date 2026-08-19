export type SolvencyState = 'fieldable' | 'temporary' | 'fundable' | 'terminal' | 'finished';

export type RecoveryAction =
  | 'none'
  | 'wait'
  | 'wait_booking'
  | 'wait_yard'
  | 'withdraw'
  | 'call_up'
  | 'reassign'
  | 'finance'
  | 'retire';

export type RecoveryBlock = 'none' | 'no_pilot' | 'no_mech' | 'insufficient_funds';

export interface RecoveryPlan {
  pilotName: string | null;
  pilotCost: number;
  mechName: string;
  mechId: string | null;
  mechCost: number;
  mechSource: 'owned' | 'yard';
  mechNeedsRebuild: boolean;
  mechNeedsWeapon: boolean;
  weaponId: string | null;
  weaponName: string | null;
  mechReadyOnDay: number;
  saleBeforePurchase: number;
  saleAfterPurchase: number;
  saleProceeds: number;
  availableCredits: number;
  requiredCredits: number;
  needsSale: boolean;
}

export interface SolvencyReport {
  state: SolvencyState;
  action: RecoveryAction;
  block: RecoveryBlock;
  recoverOnDay: number | null;
  plan: RecoveryPlan | null;
}
