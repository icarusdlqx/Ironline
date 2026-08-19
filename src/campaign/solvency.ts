import type { Catalog } from '../schema/load';
import { deployableLance } from './deployment';
import { dailyPayroll } from './ledger';
import { marketListings, marketPeriod, saleValueOf, valueOf } from './market';
import { availableHires, hireCost } from './roster';
import {
  isPilotAvailable,
  type CampaignState,
} from './types';

export type SolvencyState = 'fieldable' | 'temporary' | 'fundable' | 'terminal' | 'finished';
export type RecoveryAction =
  | 'none'
  | 'wait'
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

interface MechPlan {
  name: string;
  id: string | null;
  cost: number;
  source: 'owned' | 'yard';
  needsRebuild: boolean;
  saleBeforePurchase: number;
  saleAfterPurchase: number;
}

function ownedMechPlans(catalog: Catalog, state: CampaignState): MechPlan[] {
  const totalSale = state.mechs.reduce((sum, mech) => sum + saleValueOf(catalog, mech), 0);
  return state.mechs.map((mech) => ({
    name: mech.design.name,
    id: mech.id,
    cost: mech.status === 'hulk' ? mech.rebuildCost : 0,
    source: 'owned',
    needsRebuild: mech.status === 'hulk',
    saleBeforePurchase: totalSale - saleValueOf(catalog, mech),
    saleAfterPurchase: 0,
  }));
}

function yardMechPlans(catalog: Catalog, state: CampaignState): MechPlan[] {
  const saleValues = state.mechs.map((mech) => saleValueOf(catalog, mech));
  const retained = saleValues.length === 0 ? 0 : Math.min(...saleValues);
  const saleBeforePurchase = saleValues.reduce((sum, value) => sum + value, 0) - retained;
  return marketListings(catalog, state).map((listing) => ({
    name: listing.design.name,
    id: null,
    cost: listing.price,
    source: 'yard',
    needsRebuild: false,
    saleBeforePurchase,
    saleAfterPurchase: retained,
  }));
}

function fundedPlan(catalog: Catalog, state: CampaignState): {
  plan: RecoveryPlan | null;
  block: RecoveryBlock;
} {
  const living = state.pilots.some((pilot) => !pilot.dead);
  const hire = living ? null : availableHires(catalog, state)[0] ?? null;
  if (!living && hire === null) return { plan: null, block: 'no_pilot' };

  const mechPlans = [...ownedMechPlans(catalog, state), ...yardMechPlans(catalog, state)];
  if (mechPlans.length === 0) return { plan: null, block: 'no_mech' };

  const pilotCost = hire === null ? 0 : hireCost(catalog, hire);
  const plans = mechPlans.map((mech): RecoveryPlan => {
    const requiredCredits = pilotCost + mech.cost;
    // The last-hull guard lifts after a yard purchase. Its sale counts only
    // when the company can reach that purchase without spending the proceeds.
    const canBuyBeforeFinalSale =
      mech.source === 'owned' || state.cbills + mech.saleBeforePurchase >= mech.cost;
    const saleAfterPurchase =
      canBuyBeforeFinalSale && state.cbills + mech.saleBeforePurchase < requiredCredits
        ? mech.saleAfterPurchase
        : 0;
    const saleProceeds = mech.saleBeforePurchase + saleAfterPurchase;
    const availableCredits = state.cbills + saleProceeds;
    return {
      pilotName: hire?.name ?? null,
      pilotCost,
      mechName: mech.name,
      mechId: mech.id,
      mechCost: mech.cost,
      mechSource: mech.source,
      mechNeedsRebuild: mech.needsRebuild,
      saleBeforePurchase: mech.saleBeforePurchase,
      saleAfterPurchase,
      saleProceeds,
      availableCredits,
      requiredCredits,
      needsSale: state.cbills < requiredCredits,
    };
  });
  plans.sort((left, right) => {
    const leftShortfall = Math.max(0, left.requiredCredits - left.availableCredits);
    const rightShortfall = Math.max(0, right.requiredCredits - right.availableCredits);
    return leftShortfall - rightShortfall || left.requiredCredits - right.requiredCredits;
  });
  const plan = plans[0] ?? null;
  return {
    plan,
    block:
      plan !== null && plan.availableCredits >= plan.requiredCredits
        ? 'none'
        : 'insufficient_funds',
  };
}

function nextMarketDay(catalog: Catalog, day: number): number {
  return (marketPeriod(catalog, day) + 1) * catalog.rules.economy.market.refreshDays;
}

/** Cheapest price the rotating yard can ever post under its authored rules. */
function minimumYardPrice(catalog: Catalog): number | null {
  const rules = catalog.rules.economy.market;
  const prices = [...catalog.designs.values()]
    .filter((design) => catalog.chassis.get(design.chassisId)?.frame === 'mech')
    .map((design) => {
      const raw = valueOf(catalog, design) * rules.priceVariance[0] * rules.wornDiscount;
      return Math.max(
        rules.priceRounding,
        Math.round(raw / rules.priceRounding) * rules.priceRounding,
      );
    });
  return prices.length === 0 ? null : Math.min(...prices);
}

/** Whether a later yard rotation can still produce an executable recovery. */
function futureYardRecovery(catalog: Catalog, state: CampaignState): number | null {
  const price = minimumYardPrice(catalog);
  if (price === null) return null;
  const day = nextMarketDay(catalog, state.day);
  const projectedCash = state.cbills - dailyPayroll(catalog, state) * (day - state.day);
  const living = state.pilots.some((pilot) => !pilot.dead);
  const hire = living ? null : availableHires(catalog, state)[0] ?? null;
  if (!living && hire === null) return null;
  const pilotCost = hire === null ? 0 : hireCost(catalog, hire);

  const sales = state.mechs.map((mech) => saleValueOf(catalog, mech));
  const retained = sales.length === 0 ? 0 : Math.min(...sales);
  const saleBeforePurchase = sales.reduce((sum, value) => sum + value, 0) - retained;
  if (projectedCash + saleBeforePurchase < price) return null;
  const available = projectedCash + saleBeforePurchase + retained;
  return available >= price + pilotCost ? day : null;
}

/**
 * Whether the company can reach another drop using actions already on its books.
 * Debt alone is not defeat: a fieldable lance can still work its way out of it.
 */
export function assessSolvency(catalog: Catalog, state: CampaignState): SolvencyReport {
  if (state.finished) {
    return { state: 'finished', action: 'none', block: 'none', recoverOnDay: null, plan: null };
  }
  if (deployableLance(state).length > 0) {
    return { state: 'fieldable', action: 'none', block: 'none', recoverOnDay: null, plan: null };
  }

  const living = state.pilots.filter((pilot) => !pilot.dead);
  const returning = state.mechs.filter((mech) => mech.status !== 'hulk');
  if (living.length > 0 && returning.length > 0) {
    const pilotDay = Math.min(...living.map((pilot) => Math.max(state.day, pilot.injuredUntilDay)));
    const mechDay = Math.min(...returning.map((mech) => (
      mech.status === 'repairing' ? Math.max(state.day, mech.readyOnDay) : state.day
    )));
    const recoverOnDay = Math.max(pilotDay, mechDay);
    if (recoverOnDay > state.day) {
      if (state.contract !== null && recoverOnDay > state.contract.deadlineDay) {
        return {
          state: 'temporary', action: 'withdraw', block: 'none', recoverOnDay, plan: null,
        };
      }
      return {
        state: 'temporary', action: 'wait', block: 'none', recoverOnDay, plan: null,
      };
    }

    const fit = living.filter((pilot) => isPilotAvailable(state, pilot));
    const allHeld = fit.length > 0 && fit.every((pilot) => state.benched.includes(pilot.id));
    return {
      state: 'temporary',
      action: allHeld ? 'call_up' : 'reassign',
      block: 'none',
      recoverOnDay: state.day,
      plan: null,
    };
  }

  const recovery = fundedPlan(catalog, state);
  if (
    recovery.plan !== null &&
    recovery.plan.availableCredits >= recovery.plan.requiredCredits
  ) {
    if (state.contract !== null && recovery.plan.needsSale) {
      return {
        state: 'temporary', action: 'withdraw', block: 'none', recoverOnDay: null,
        plan: recovery.plan,
      };
    }
    return {
      state: 'fundable', action: 'finance', block: 'none', recoverOnDay: null,
      plan: recovery.plan,
    };
  }
  const yardDay = futureYardRecovery(catalog, state);
  if (yardDay !== null) {
    return state.contract === null || yardDay <= state.contract.deadlineDay
      ? {
          state: 'temporary', action: 'wait_yard', block: 'none', recoverOnDay: yardDay,
          plan: null,
        }
      : {
          state: 'temporary', action: 'withdraw', block: 'none', recoverOnDay: yardDay,
          plan: null,
        };
  }
  return {
    state: 'terminal', action: state.contract === null ? 'retire' : 'withdraw',
    block: recovery.block, recoverOnDay: null,
    plan: recovery.plan,
  };
}

export interface RetirementResult {
  ok: boolean;
  reason: string | null;
}

export function retireCompany(catalog: Catalog, state: CampaignState): RetirementResult {
  if (state.finished) return { ok: false, reason: 'the campaign is already over' };
  if (state.contract !== null) {
    return { ok: false, reason: 'withdraw from the active contract before retiring' };
  }
  if (assessSolvency(catalog, state).state !== 'terminal') {
    return { ok: false, reason: 'the company still has a recovery path' };
  }

  state.finished = true;
  state.won = false;
  state.log.unshift({ day: state.day, text: 'The company retired. No fieldable recovery remained.' });
  if (state.log.length > 200) state.log.length = 200;
  return { ok: true, reason: null };
}
