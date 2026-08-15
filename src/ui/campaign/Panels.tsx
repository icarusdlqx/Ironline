import {
  fitFromStore,
  rebuildHulk,
  stripToStore,
} from '../../campaign/refit';
import { buyMech, marketListings, saleValueOf, sellMech } from '../../campaign/market';
import { estimateRepair, startRepair } from '../../campaign/repair';
import {
  assign,
  availableHires,
  availableXp,
  chooseTrait,
  hireCost,
  hirePilot,
  offeredTraits,
  pendingTraitPicks,
  raiseSkill,
  skillCost,
  SKILLS,
} from '../../campaign/roster';
import { isMechAvailable, isPilotAvailable, type CampaignState } from '../../campaign/types';
import { getCatalog } from '../../schema/load';
import { computeLoadout } from '../../sim/loadout';

const catalog = getCatalog();

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
  return (
      <section className="camp-bay" data-testid="camp-bay">
        <h3>Mech bay</h3>
        <ul>
          {state.mechs.map((mech) => {
            const estimate = estimateRepair(catalog, mech);
            const ready = isMechAvailable(state, mech) && mech.status !== 'hulk';
            return (
              <li key={mech.id} data-testid={`camp-mech-${mech.id}`}>
                <span className="bay-mech-name">{mech.design.name}</span>
                <span className="bay-mech-state">
                  {mech.status === 'hulk'
                    ? `wreck — rebuild ${cbills(mech.rebuildCost)}`
                    : ready
                      ? estimate.days === 0
                        ? 'ready'
                        : `damaged — ${cbills(estimate.cost)}, ${estimate.days}d`
                      : `in bay until day ${mech.readyOnDay}`}
                </span>
                {mech.status === 'hulk' ? (
                  <button
                    type="button"
                    onClick={() =>
                      mutate((draft) => {
                        const target = draft.mechs.find((entry) => entry.id === mech.id);
                        if (target === undefined) return null;
                        const result = rebuildHulk(catalog, draft, target);
                        return result.ok ? `${target.design.name} rebuilt.` : result.reason;
                      })
                    }
                  >
                    Rebuild
                  </button>
                ) : estimate.days > 0 && mech.status === 'ready' ? (
                  <button
                    type="button"
                    onClick={() =>
                      mutate((draft) => {
                        const target = draft.mechs.find((entry) => entry.id === mech.id);
                        if (target === undefined) return null;
                        const result = startRepair(catalog, draft, target);
                        return result.ok ? `${target.design.name} in the shop.` : result.reason;
                      })
                    }
                    data-testid={`camp-repair-${mech.id}`}
                  >
                    Repair
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
  );
}

export function BarracksPanel({ state, mutate }: PanelProps) {
  return (
      <section className="camp-roster" data-testid="camp-roster">
        <h3>Barracks</h3>
        <ul>
          {state.pilots.map((pilot) => (
            <li key={pilot.id} data-testid={`camp-pilot-${pilot.id}`} title={pilot.bio}>
              <span className="pilot-name">
                {pilot.name}
                {pilot.traits.length === 0 ? null : (
                  <small className="pilot-traits">
                    {pilot.traits
                      .map((traitId) => catalog.rules.pilotTraits.entries[traitId]?.label ?? traitId)
                      .join(' · ')}
                  </small>
                )}
              </span>
              <span className="pilot-skills">
                {pilot.gunnery}/{pilot.piloting}/{pilot.sensors}
              </span>
              <span className="pilot-state">
                {pilot.dead
                  ? 'KIA'
                  : isPilotAvailable(state, pilot)
                    ? `${availableXp(pilot)} XP`
                    : `injured to day ${pilot.injuredUntilDay}`}
              </span>
              {/* A speciality the pilot has earned. The commander picks it:
                  what somebody becomes good at is the most characterful
                  decision the roster has, and it was being made by a table. */}
              {pendingTraitPicks(catalog, pilot) <= 0 ? null : (
                <select
                  className="pilot-pick"
                  value=""
                  onChange={(event) => {
                    const traitId = event.target.value;
                    if (traitId === '') return;
                    mutate((draft) => {
                      const target = draft.pilots.find((entry) => entry.id === pilot.id);
                      if (target === undefined) return null;
                      const result = chooseTrait(catalog, target, traitId);
                      return result.ok
                        ? `${target.name} trained ${catalog.rules.pilotTraits.entries[traitId]?.label ?? traitId}.`
                        : result.reason;
                    });
                  }}
                  data-testid={`camp-pick-${pilot.id}`}
                  aria-label={`Speciality for ${pilot.name}`}
                >
                  <option value="">Train a speciality…</option>
                  {offeredTraits(catalog, pilot).map((traitId) => {
                    const trait = catalog.rules.pilotTraits.entries[traitId];
                    return (
                      <option key={traitId} value={traitId} title={trait?.note}>
                        {trait?.label ?? traitId}
                      </option>
                    );
                  })}
                </select>
              )}
              {/* Seats are filled automatically after every battle, but a
                  commander who wants their best gunner in the assault mech
                  had no way to say so. Assigning an occupied mech evicts
                  whoever is in it, so a swap is one pick, not two. */}
              <select
                className="pilot-mech"
                disabled={pilot.dead}
                value={pilot.mechId ?? ''}
                onChange={(event) =>
                  mutate((draft) => {
                    assign(draft, pilot.id, event.target.value === '' ? null : event.target.value);
                  }, `${pilot.name} reassigned.`)
                }
                data-testid={`camp-seat-${pilot.id}`}
              >
                <option value="">— no mech —</option>
                {state.mechs.map((mech) => (
                  <option key={mech.id} value={mech.id}>
                    {mech.design.name}
                    {mech.status === 'ready' ? '' : ` (${mech.status})`}
                  </option>
                ))}
              </select>
              <span className="pilot-buttons">
                {SKILLS.map((skill) => (
                  <button
                    key={skill}
                    type="button"
                    disabled={pilot.dead || availableXp(pilot) < skillCost(catalog, pilot[skill])}
                    title={`Raise ${skill} for ${skillCost(catalog, pilot[skill])} XP`}
                    onClick={() =>
                      mutate((draft) => {
                        const target = draft.pilots.find((entry) => entry.id === pilot.id);
                        if (target === undefined) return null;
                        const result = raiseSkill(catalog, target, skill);
                        return result.ok
                          ? `${target.name} up to ${skill} ${target[skill]}.`
                          : result.reason;
                      })
                    }
                    data-testid={`camp-skill-${pilot.id}-${skill}`}
                  >
                    {skill.slice(0, 3).toUpperCase()}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>

        {/* Who else is on the register. A company that loses a pilot and cannot
            replace them is a company one bad drop from being over, and a
            commander who wants a marksman should be able to go and buy one. */}
        <h4>Hiring hall</h4>
        <ul className="camp-hires">
          {availableHires(catalog, state).slice(0, 6).map((hire) => {
            const cost = hireCost(catalog, hire);
            return (
              <li key={hire.id} title={hire.bio} data-testid={`camp-hire-${hire.id}`}>
                <span className="pilot-name">
                  {hire.name}
                  {hire.traits.length === 0 ? null : (
                    <small className="pilot-traits">
                      {hire.traits
                        .map((traitId) => catalog.rules.pilotTraits.entries[traitId]?.label ?? traitId)
                        .join(' · ')}
                    </small>
                  )}
                </span>
                <span className="pilot-skills">
                  {hire.gunnery}/{hire.piloting}/{hire.sensors}
                </span>
                <span className="pilot-state">{cbills(cost)}</span>
                <button
                  type="button"
                  disabled={state.cbills < cost}
                  onClick={() =>
                    mutate((draft) => {
                      const result = hirePilot(catalog, draft, hire.id);
                      return result.ok ? `${hire.name} signed.` : result.reason;
                    })
                  }
                  data-testid={`camp-sign-${hire.id}`}
                >
                  Sign
                </button>
              </li>
            );
          })}
          {availableHires(catalog, state).length === 0 ? (
            <li className="camp-empty">Nobody left on the register.</li>
          ) : null}
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
        {state.mechs.map((mech) => (
          <li key={mech.id} data-testid={`market-sell-row-${mech.id}`}>
            <span className="market-name">
              {mech.design.name}
              <small>{mech.status === 'hulk' ? 'wreck' : mech.status}</small>
            </span>
            <span className="market-price">{cbills(saleValueOf(catalog, mech))}</span>
            <button
              type="button"
              // Selling under contract is how a company arrives at a drop with
              // nothing to drop; the rule refuses it, and so does the button.
              disabled={signed || state.mechs.length <= 1}
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
        ))}
      </ul>
    </section>
  );
}
