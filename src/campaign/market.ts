import type { Design } from '../schema/design';
import type { Catalog } from '../schema/load';
import { createRng } from '../sim/rng';
import { pristineCondition } from './repair';
import type { CampaignState, MechRecord } from './types';

/** Which week of stock the yard is showing. */
export function marketPeriod(catalog: Catalog, day: number): number {
  return Math.floor(day / catalog.rules.economy.market.refreshDays);
}

/**
 * What a machine is worth new: the hull, plus everything bolted to it.
 *
 * Deriving it rather than authoring a price per design means a build the player
 * put together in the bay is valued on the same terms as a stock one, which is
 * what stops the market being a way to launder tonnage into cash.
 */
export function valueOf(catalog: Catalog, design: Design): number {
  let value = catalog.chassis.get(design.chassisId)?.baseCost ?? 0;

  for (const mount of design.mounts) value += catalog.weapons.get(mount.weaponId)?.cost ?? 0;
  for (const fit of design.equipment) value += catalog.equipment.get(fit.equipmentId)?.cost ?? 0;

  return Math.round(value);
}

/**
 * What the yard will give for a machine. Well under what it is worth: a company
 * selling a mech is selling it to someone who has to make a living reselling
 * it, and a market that paid full price would make salvage a money printer.
 *
 * A hulk is worth its scrap, less what it would take to make it walk.
 */
export function saleValueOf(catalog: Catalog, mech: MechRecord): number {
  const full = valueOf(catalog, mech.design) * catalog.rules.economy.market.sellFraction;
  return Math.max(0, Math.round(full - mech.rebuildCost));
}

export interface Listing {
  id: string;
  design: Design;
  price: number;
  /** Sold as-is at a discount, or refurbished at the asking price. */
  worn: boolean;
}

const CLASSES = ['light', 'medium', 'heavy', 'assault'] as const;

/**
 * What the yard has on the lot this week.
 *
 * Derived from the seed and the week the same way the hiring hall is, and for
 * the same reason: the campaign screen recomputes this on every render, and
 * drawing from `state.rng` would make the campaign's random stream depend on
 * how often the player looked at the shop.
 *
 * Stock is drawn a class at a time rather than uniformly. A uniform draw can
 * put four assault mechs on the lot in front of a company that cannot afford
 * one of them, which is a row of dead buttons rather than a decision.
 */
export function marketListings(catalog: Catalog, state: CampaignState): Listing[] {
  const rules = catalog.rules.economy.market;
  const period = marketPeriod(catalog, state.day);
  const rng = createRng(`${state.seed}:market:${period}`);

  // Sorted first so the lot does not depend on the order the content happened
  // to load in.
  const designs = [...catalog.designs.values()].sort((a, b) => a.id.localeCompare(b.id));
  const pools = CLASSES.map((weight) =>
    rng.shuffle(designs.filter((design) => catalog.chassis.get(design.chassisId)?.class === weight)),
  );

  const stock: Design[] = [];
  for (let round = 0; stock.length < rules.listings && round < designs.length; round += 1) {
    for (const pool of pools) {
      const next = pool[round];
      if (next !== undefined && stock.length < rules.listings) stock.push(next);
    }
  }

  const sold = new Set(state.marketBought);
  const listings: Listing[] = [];

  stock.forEach((design, slot) => {
    const id = `market_${period}_${slot}`;

    // Every slot draws whether or not it survives the filter, so buying one
    // machine cannot move the price of the one beside it.
    const variance = rng.range(rules.priceVariance[0], rules.priceVariance[1]);
    const worn = rng.chance(rules.wornChance);
    if (sold.has(id)) return;

    const raw = valueOf(catalog, design) * variance * (worn ? rules.wornDiscount : 1);
    listings.push({
      id,
      design,
      price: Math.max(rules.priceRounding, Math.round(raw / rules.priceRounding) * rules.priceRounding),
      worn,
    });
  });

  return listings;
}

export interface MarketResult {
  ok: boolean;
  reason: string | null;
}

/**
 * Buys a machine off the lot. A worn one arrives needing work rather than
 * arriving broken: it is cheaper for a reason, and the reason is the bill the
 * workshop hands you afterwards.
 */
export function buyMech(catalog: Catalog, state: CampaignState, listingId: string): MarketResult {
  const listing = marketListings(catalog, state).find((entry) => entry.id === listingId);
  if (listing === undefined) return { ok: false, reason: 'that machine is no longer on the lot' };
  if (state.cbills < listing.price) return { ok: false, reason: 'not enough C-bills' };

  state.cbills -= listing.price;
  state.marketBought.push(listing.id);

  const condition = pristineCondition(catalog, listing.design);
  if (listing.worn) {
    // Stripped plate, not a wreck. It walks off the lot and into the queue.
    for (const location of Object.keys(condition) as (keyof typeof condition)[]) {
      condition[location].armour = Math.floor(condition[location].armour * 0.45);
      condition[location].rearArmour = Math.floor(condition[location].rearArmour * 0.45);
    }
  }

  state.mechs.push({
    id: `mech_${String(state.nextId)}`,
    design: JSON.parse(JSON.stringify(listing.design)) as Design,
    condition,
    status: 'ready',
    readyOnDay: state.day,
    rebuildCost: 0,
  });
  state.nextId += 1;

  return { ok: true, reason: null };
}

/**
 * Sells a machine out of the bay.
 *
 * Refuses the last one, and refuses to sell under contract — a company that can
 * sell its way to nothing to drop has a dead end in it rather than a decision.
 * Whoever was sitting in it simply gets out: every mech has a pilot in it by
 * default, so refusing on that basis would have made selling anything a
 * two-step chore with no judgement in the first step.
 */
export function sellMech(catalog: Catalog, state: CampaignState, mechId: string): MarketResult {
  const mech = state.mechs.find((entry) => entry.id === mechId);
  if (mech === undefined) return { ok: false, reason: 'no such machine' };
  if (state.mechs.length <= 1) return { ok: false, reason: 'that is the last machine in the bay' };
  if (state.contract !== null) return { ok: false, reason: 'not while a contract is signed' };

  for (const pilot of state.pilots) {
    if (pilot.mechId === mech.id) pilot.mechId = null;
  }

  state.cbills += saleValueOf(catalog, mech);
  state.mechs = state.mechs.filter((entry) => entry.id !== mech.id);
  return { ok: true, reason: null };
}

/** Forgets purchases from weeks that have rolled over, so the list stays bounded. */
export function pruneMarket(catalog: Catalog, state: CampaignState): void {
  const live = `market_${marketPeriod(catalog, state.day)}_`;
  state.marketBought = state.marketBought.filter((id) => id.startsWith(live));
}
