import {
  fitFromStore,
  rebuildHulk,
  stripToStore,
} from '../../campaign/refit';
import { estimateRepair, startRepair } from '../../campaign/repair';
import {
  assign,
  availableHires,
  availableXp,
  hireCost,
  hirePilot,
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
  mutate: (change: (draft: CampaignState) => void, message?: string) => void;
  setStatus: (text: string | null) => void;
}

export function MechBayPanel({ state, mutate, setStatus }: PanelProps) {
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
                        if (target === undefined) return;
                        const result = rebuildHulk(catalog, draft, target);
                        if (!result.ok) setStatus(result.reason);
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
                        if (target === undefined) return;
                        const result = startRepair(catalog, draft, target);
                        if (!result.ok) setStatus(result.reason);
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

export function BarracksPanel({ state, mutate, setStatus }: PanelProps) {
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
                        if (target === undefined) return;
                        const result = raiseSkill(catalog, target, skill);
                        if (!result.ok) setStatus(result.reason);
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
                      if (!result.ok) setStatus(result.reason);
                    }, `${hire.name} signed.`)
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

export function StoresPanel({ state, mutate, setStatus }: PanelProps) {
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
                        if (target === undefined) return;
                        const result = fitFromStore(catalog, draft, target, item.itemId);
                        if (!result.ok) setStatus(result.reason);
                        else setStatus(`Fitted to ${target.design.name} ${result.location}.`);
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
                      if (target === undefined) return;
                      const result = stripToStore(catalog, draft, target, index);
                      if (!result.ok) setStatus(result.reason);
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

