import {
  fitFromStore,
  rebuildHulk,
  stripToStore,
} from '../../campaign/refit';
import { buyMech, marketListings, saleValueOf, sellMech } from '../../campaign/market';
import { dailyPayroll, payrollThrough } from '../../campaign/ledger';
import {
  estimateRepair,
  projectedRepairWindow,
  repairQueue,
  startRepair,
} from '../../campaign/repair';
import { isMechAvailable, type CampaignState } from '../../campaign/types';
import { getCatalog } from '../../schema/load';
import { computeLoadout } from '../../sim/loadout';

const catalog = getCatalog();

export { BarracksPanel } from './BarracksPanel';

export function cbills(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

export interface PanelProps {
  state: CampaignState;
  /**
   * Applies a change to a copy of the campaign. What the change returns is what
   * the screen says about it, so a refusal reports itself rather than being
   * overwritten by the caption of the button that hoped it would work.
   */
  mutate: (change: (draft: CampaignState) => string | null | void, message?: string) => void;
}

export function MechBayPanel({ state, mutate }: PanelProps) {
  const payroll = dailyPayroll(catalog, state);
  const bayCapacity = catalog.rules.economy.repair.bayCapacity;
  const bayDescription = `${bayCapacity === 1 ? 'One lift works' : `${bayCapacity} lifts work`} through the queue in order.`;
  const queue = repairQueue(catalog, state);
  const queueByMech = new Map(queue.map((entry) => [entry.mechId, entry]));
  return (
      <section className="camp-bay progression-bay" data-testid="camp-bay">
        <h3>Mech bay</h3>
        <p className="ledger-note">
          {bayDescription} Workshop bills are paid up front; the {cbills(payroll)} daily
          payroll continues while work is booked.
        </p>
        <ul>
          {state.mechs.map((mech) => {
            const estimate = estimateRepair(catalog, mech);
            const ready = isMechAvailable(state, mech) && mech.status !== 'hulk';
            const projected = projectedRepairWindow(catalog, state, estimate.days);
            const booking = queueByMech.get(mech.id);
            const calendarDays = projected.readyOnDay - state.day;
            const projectedTiming =
              projected.status === 'active'
                ? `ready day ${projected.readyOnDay}`
                : `starts day ${projected.startsOnDay} · ready day ${projected.readyOnDay}`;
            return (
              <li key={mech.id} data-testid={`camp-mech-${mech.id}`}>
                <span className="bay-mech-name">{mech.design.name}</span>
                <span className="bay-mech-state">
                  {mech.status === 'hulk'
                    ? `wreck — ${cbills(estimate.cost)} now · ${projectedTiming} · ${cbills(payrollThrough(catalog, state, calendarDays))} wages`
                    : ready
                      ? mech.design.mounts.length === 0
                        ? 'rebuilt — fit a weapon before deployment'
                        : estimate.days === 0
                          ? 'ready'
                          : `damaged — ${cbills(estimate.cost)} now · ${projectedTiming} · ${cbills(payrollThrough(catalog, state, calendarDays))} wages`
                      : booking?.status === 'active'
                        ? `on a lift · ready day ${mech.readyOnDay} · ${cbills(payrollThrough(catalog, state, mech.readyOnDay - state.day))} wages left`
                        : booking?.status === 'inherited'
                          ? `inherited concurrent booking · ready day ${mech.readyOnDay}`
                          : `queued ${booking?.queuePosition ?? 1} · starts day ${booking?.startsOnDay ?? state.day} · ready day ${mech.readyOnDay}`}
                </span>
                {mech.status === 'hulk' ? (
                  <button
                    type="button"
                    onClick={() =>
                      mutate((draft) => {
                        const target = draft.mechs.find((entry) => entry.id === mech.id);
                        if (target === undefined) return null;
                        const result = rebuildHulk(catalog, draft, target);
                        return result.ok
                          ? `${target.design.name} booked; ready day ${target.readyOnDay}.`
                          : result.reason;
                      })
                    }
                  >
                    {projected.status === 'active' ? 'Rebuild' : 'Queue rebuild'}
                  </button>
                ) : estimate.days > 0 && mech.status === 'ready' ? (
                  <button
                    type="button"
                    onClick={() =>
                      mutate((draft) => {
                        const target = draft.mechs.find((entry) => entry.id === mech.id);
                        if (target === undefined) return null;
                        const result = startRepair(catalog, draft, target);
                        return result.ok
                          ? `${target.design.name} booked; ready day ${target.readyOnDay}.`
                          : result.reason;
                      })
                    }
                    data-testid={`camp-repair-${mech.id}`}
                  >
                    {projected.status === 'active' ? 'Repair' : 'Queue repair'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
  );
}

export function StoresPanel({ state, mutate }: PanelProps) {
  return (
      <section className="camp-store" data-testid="camp-store">
        <h3>Stores</h3>
        {state.store.length === 0 ? (
          <p className="empty">Nothing salvaged yet.</p>
        ) : (
          <ul>
            {state.store.map((item) => (
              <li key={`${item.kind}:${item.itemId}`} data-testid={`camp-store-${item.itemId}`}>
                <span>
                  {catalog.weapons.get(item.itemId)?.name ??
                    catalog.equipment.get(item.itemId)?.name ??
                    item.itemId}{' '}
                  × {item.count}
                </span>
                {item.kind === 'weapon' ? (
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value === '') return;
                      const mechId = event.target.value;
                      mutate((draft) => {
                        const target = draft.mechs.find((entry) => entry.id === mechId);
                        if (target === undefined) return null;
                        const result = fitFromStore(catalog, draft, target, item.itemId);
                        return result.ok
                          ? `Fitted to ${target.design.name} ${result.location}.`
                          : result.reason;
                      });
                    }}
                    data-testid={`camp-fit-${item.itemId}`}
                  >
                    <option value="">Fit to…</option>
                    {state.mechs
                      .filter((mech) => mech.status === 'ready')
                      .map((mech) => (
                        <option key={mech.id} value={mech.id}>
                          {mech.design.name}
                        </option>
                      ))}
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <h3>Strip</h3>
        <ul className="camp-strip">
          {state.mechs
            .filter((mech) => mech.status === 'ready')
            .map((mech) => (
              <li key={mech.id}>
                <span>{mech.design.name}</span>
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value === '') return;
                    const index = Number(event.target.value);
                    mutate((draft) => {
                      const target = draft.mechs.find((entry) => entry.id === mech.id);
                      if (target === undefined) return null;
                      const result = stripToStore(catalog, draft, target, index);
                      return result.ok ? `Stripped from ${target.design.name}.` : result.reason;
                    });
                  }}
                >
                  <option value="">Strip…</option>
                  {mech.design.mounts.map((mount, index) => (
                    <option key={`${mount.weaponId}-${index}`} value={index}>
                      {catalog.weapons.get(mount.weaponId)?.name ?? mount.weaponId} ({mount.location})
                    </option>
                  ))}
                </select>
                <span className="strip-legal">
                  {computeLoadout(catalog, mech.design).valid ? '' : 'illegal build'}
                </span>
              </li>
            ))}
        </ul>
      </section>
  );
}


/**
 * The yard. Machines used to enter the company only as salvage and never leave
 * it, which made a mech the one asset with no price on it — a bay full of hulls
 * you could not use and could not turn into anything else.
 */
export function MarketPanel({ state, mutate }: PanelProps) {
  const listings = marketListings(catalog, state);
  const signed = state.contract !== null;

  return (
    <section className="camp-market" data-testid="camp-market">
      <h3>Yard</h3>

      <h4>On the lot</h4>
      <ul className="market-stock">
        {listings.length === 0 ? (
          <li className="empty">Nothing on the lot this week.</li>
        ) : (
          listings.map((listing) => (
            <li key={listing.id} data-testid={`market-${listing.id}`}>
              <span className="market-name">
                {listing.design.name}
                <small>
                  {catalog.chassis.get(listing.design.chassisId)?.tonnage ?? 0}t
                  {listing.worn ? ' · sold as seen' : ''}
                </small>
              </span>
              <span className="market-price">{cbills(listing.price)}</span>
              <button
                type="button"
                disabled={state.cbills < listing.price}
                title={
                  state.cbills < listing.price
                    ? `${cbills(listing.price - state.cbills)} short`
                    : `Buy the ${listing.design.name}`
                }
                onClick={() =>
                  mutate((draft) => {
                    const result = buyMech(catalog, draft, listing.id);
                    return result.ok ? `Bought a ${listing.design.name}.` : result.reason;
                  })
                }
                data-testid={`market-buy-${listing.id}`}
              >
                Buy
              </button>
            </li>
          ))
        )}
      </ul>

      <h4>{signed ? 'Sell — not while a contract is signed' : 'Sell'}</h4>
      <ul className="market-sell">
        {state.mechs.map((mech) => {
          const booked = mech.status === 'repairing';
          return (
            <li key={mech.id} data-testid={`market-sell-row-${mech.id}`}>
              <span className="market-name">
                {mech.design.name}
                <small>
                  {mech.status === 'hulk'
                    ? 'wreck'
                    : booked
                      ? `paid workshop booking · ready day ${mech.readyOnDay}`
                      : mech.design.mounts.length === 0
                        ? 'needs a weapon'
                        : mech.status}
                </small>
              </span>
              <span className="market-price">{cbills(saleValueOf(catalog, mech))}</span>
              <button
                type="button"
                // A signed contract protects the drop; a paid booking protects
                // the queue. Both rules refuse the operation at the model too.
                disabled={signed || state.mechs.length <= 1 || booked}
                title={booked ? 'This paid workshop booking must finish before sale' : undefined}
                onClick={() =>
                  mutate((draft) => {
                    const result = sellMech(catalog, draft, mech.id);
                    return result.ok
                      ? `Sold the ${mech.design.name} for ${cbills(saleValueOf(catalog, mech))}.`
                      : result.reason;
                  })
                }
                data-testid={`market-sell-${mech.id}`}
              >
                Sell
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
