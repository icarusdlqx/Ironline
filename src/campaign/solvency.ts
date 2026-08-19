import type { Catalog } from '../schema/load';
import { deployableLance } from './deployment';
import { dailyPayroll } from './ledger';
import { marketListings, marketPeriod, saleValueOf, valueOf } from './market';
import { planFit } from './refit';
import { completeRepair, estimateRepair, projectedRepairWindow } from './repair';
import { availableHires, hireCost } from './roster';
import type {
  RecoveryBlock,
  RecoveryPlan,
  SolvencyReport,
} from './solvencyTypes';
import {
  isPilotAvailable,
  type CampaignState,
  type MechRecord,
} from './types';

export type {
  RecoveryAction,
  RecoveryBlock,
  RecoveryPlan,
  SolvencyReport,
  SolvencyState,
} from './solvencyTypes';

interface MechPlan {
  name: string;
  id: string | null;
  cost: number;
  source: 'owned' | 'yard';
  needsRebuild: boolean;
  weaponId: string | null;
  weaponName: string | null;
  readyOnDay: number;
  saleBeforePurchase: number;
  saleAfterPurchase: number;
}

function saleValueNow(catalog: Catalog, mech: MechRecord): number {
  // A paid booking retains its eventual yard value, but `sellMech` refuses it
  // until the lift releases it. Solvency must only spend executable proceeds.
  return mech.status === 'repairing' ? 0 : saleValueOf(catalog, mech);
}

function compatibleStoredWeapon(
  catalog: Catalog,
  state: CampaignState,
  mech: MechRecord,
): { id: string; name: string } | null {
  if (mech.design.mounts.length > 0) return null;
  const stored = state.store
    .filter((item) => item.kind === 'weapon' && item.count > 0)
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
  for (const item of stored) {
    const weapon = catalog.weapons.get(item.itemId);
    if (weapon !== undefined && planFit(catalog, mech.design, item.itemId) !== null) {
      return { id: item.itemId, name: weapon.name };
    }
  }
  return null;
}

function ownedMechPlans(catalog: Catalog, state: CampaignState): MechPlan[] {
  const totalSale = state.mechs.reduce((sum, mech) => sum + saleValueNow(catalog, mech), 0);
  return state.mechs.flatMap((mech): MechPlan[] => {
    const weapon = compatibleStoredWeapon(catalog, state, mech);
    if (mech.design.mounts.length === 0 && weapon === null) return [];

    const rebuild = mech.status === 'hulk' ? estimateRepair(catalog, mech) : null;
    if (rebuild !== null && rebuild.days === 0) return [];
    const readyOnDay = rebuild !== null
      ? projectedRepairWindow(catalog, state, rebuild.days).readyOnDay
      : mech.status === 'repairing'
        ? Math.max(state.day, mech.readyOnDay)
        : state.day;
    return [{
      name: mech.design.name,
      id: mech.id,
      cost: rebuild?.cost ?? 0,
      source: 'owned',
      needsRebuild: rebuild !== null,
      weaponId: weapon?.id ?? null,
      weaponName: weapon?.name ?? null,
      readyOnDay,
      saleBeforePurchase: totalSale - saleValueNow(catalog, mech),
      saleAfterPurchase: 0,
    }];
  });
}

function yardMechPlans(catalog: Catalog, state: CampaignState): MechPlan[] {
  const saleValues = state.mechs.map((mech) => saleValueNow(catalog, mech));
  // An unsaleable booking can be the last hull while every released machine is
  // sold. Otherwise one released hull must remain until the purchase lands.
  const retained = state.mechs.some((mech) => mech.status === 'repairing')
    ? 0
    : saleValues.length === 0 ? 0 : Math.min(...saleValues);
  const saleBeforePurchase = saleValues.reduce((sum, value) => sum + value, 0) - retained;
  return marketListings(catalog, state).map((listing) => ({
    name: listing.design.name,
    id: null,
    cost: listing.price,
    source: 'yard',
    needsRebuild: false,
    weaponId: null,
    weaponName: null,
    readyOnDay: state.day,
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
      mechNeedsWeapon: mech.weaponId !== null,
      weaponId: mech.weaponId,
      weaponName: mech.weaponName,
      mechReadyOnDay: mech.readyOnDay,
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
    return leftShortfall - rightShortfall ||
      left.requiredCredits - right.requiredCredits ||
      left.mechReadyOnDay - right.mechReadyOnDay;
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

function projectedStateOnDay(
  catalog: Catalog,
  state: CampaignState,
  day: number,
): CampaignState {
  const mechs = state.mechs.map((mech) => {
    const copy = { ...mech };
    if (copy.status === 'repairing' && copy.readyOnDay <= day) completeRepair(catalog, copy);
    return copy;
  });
  return {
    ...state,
    day,
    cbills: state.cbills - dailyPayroll(catalog, state) * (day - state.day),
    mechs,
  };
}

/** Whether a later yard rotation can still produce an executable recovery. */
function futureYardRecovery(catalog: Catalog, state: CampaignState): number | null {
  const price = minimumYardPrice(catalog);
  if (price === null) return null;
  const day = nextMarketDay(catalog, state.day);
  const projected = projectedStateOnDay(catalog, state, day);
  const living = projected.pilots.some((pilot) => !pilot.dead);
  const hire = living ? null : availableHires(catalog, projected)[0] ?? null;
  if (!living && hire === null) return null;
  const pilotCost = hire === null ? 0 : hireCost(catalog, hire);

  const sales = projected.mechs.map((mech) => saleValueNow(catalog, mech));
  const retained = projected.mechs.some((mech) => mech.status === 'repairing')
    ? 0
    : sales.length === 0 ? 0 : Math.min(...sales);
  const saleBeforePurchase = sales.reduce((sum, value) => sum + value, 0) - retained;
  if (projected.cbills + saleBeforePurchase < price) return null;
  const available = projected.cbills + saleBeforePurchase + retained;
  return available >= price + pilotCost ? day : null;
}

function futureBookedRecovery(
  catalog: Catalog,
  state: CampaignState,
): { day: number; projected: CampaignState; plan: RecoveryPlan } | null {
  const dates = [...new Set(state.mechs
    .filter((mech) => mech.status === 'repairing' && mech.readyOnDay > state.day)
    .map((mech) => mech.readyOnDay))].sort((left, right) => left - right);
  for (const day of dates) {
    const projected = projectedStateOnDay(catalog, state, day);
    const recovery = fundedPlan(catalog, projected);
    if (recovery.plan !== null && recovery.plan.availableCredits >= recovery.plan.requiredCredits) {
      return { day, projected, plan: recovery.plan };
    }
  }
  return null;
}

function recoveryDay(state: CampaignState, plan: RecoveryPlan): number {
  const pilotDay = plan.pilotName === null
    ? Math.min(...state.pilots.filter((pilot) => !pilot.dead)
      .map((pilot) => Math.max(state.day, pilot.injuredUntilDay)))
    : state.day;
  return Math.max(plan.mechReadyOnDay, pilotDay);
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
  const returning = state.mechs.filter(
    (mech) => mech.status !== 'hulk' && mech.design.mounts.length > 0,
  );
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
    const readyOnDay = recoveryDay(state, recovery.plan);
    if (
      state.contract !== null &&
      (recovery.plan.needsSale || readyOnDay > state.contract.deadlineDay)
    ) {
      return {
        state: 'temporary', action: 'withdraw', block: 'none',
        recoverOnDay: readyOnDay > state.day ? readyOnDay : null,
        plan: recovery.plan,
      };
    }
    const waitsOnly = readyOnDay > state.day &&
      recovery.plan.pilotName === null &&
      recovery.plan.mechSource === 'owned' &&
      !recovery.plan.mechNeedsRebuild &&
      !recovery.plan.needsSale;
    if (waitsOnly) {
      return {
        state: 'temporary', action: 'wait', block: 'none', recoverOnDay: readyOnDay,
        plan: recovery.plan,
      };
    }
    return {
      state: 'fundable', action: 'finance', block: 'none',
      recoverOnDay: readyOnDay > state.day ? readyOnDay : null,
      plan: recovery.plan,
    };
  }
  const booking = futureBookedRecovery(catalog, state);
  if (booking !== null) {
    const readyOnDay = recoveryDay(booking.projected, booking.plan);
    if (
      state.contract !== null &&
      (booking.day > state.contract.deadlineDay ||
        readyOnDay > state.contract.deadlineDay ||
        booking.plan.needsSale)
    ) {
      return {
        state: 'temporary', action: 'withdraw', block: 'none',
        recoverOnDay: booking.day, plan: booking.plan,
      };
    }
    return {
      state: 'temporary', action: 'wait_booking', block: 'none',
      recoverOnDay: booking.day, plan: booking.plan,
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
