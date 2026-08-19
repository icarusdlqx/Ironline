import type { Catalog } from '../../schema/load';
import { rebuildHulk } from '../../campaign/refit';
import { estimateRepair, startRepair } from '../../campaign/repair';
import { mechIntegrity } from '../../campaign/integrity';
import { employerNameFor } from '../../campaign/employers';
import { isMechAvailable, type CampaignState } from '../../campaign/types';
import { cbills } from './Panels';

interface Props {
  catalog: Catalog;
  state: CampaignState;
  mutate: (change: (draft: CampaignState) => string | null | void, message?: string) => void;
  /** Opens the bay editor on one machine, for a pre-drop refit. */
  onRefit: (mechId: string) => void;
  onContinue: () => void;
  onCancel: () => void;
}

/**
 * The hangar walk-through: the first stop on the way to a drop.
 *
 * Mission prep is three decisions in a row — what shape the machines are in,
 * who flies which one, and then the launch. This stage is the first of them,
 * made explicit so the flow reads campaign map → mechbay → deployment →
 * battle, rather than the bay being a side door most players never find.
 */
export function Hangar({ catalog, state, mutate, onRefit, onContinue, onCancel }: Props) {
  const contract = state.contract;
  const mission = contract === null ? null : catalog.missions.get(contract.missionId);
  const employer =
    contract === null
      ? null
      : employerNameFor(catalog, state.campaignId, contract.employerId, contract.employerName);

  return (
    <div className="manifest-backdrop" data-testid="hangar-stage">
      <section className="manifest hangar">
        <header>
          <h3>Mechbay — prepare the machines</h3>
          <p>
            {mission?.name ?? 'Contract'}
            {employer === null ? '' : ` — ${employer}.`} Repair what is broken, refit
            what is mis-armed, then move on to the drop manifest.
          </p>
        </header>

        <ul className="manifest-list">
          {state.mechs.map((mech) => {
            const estimate = estimateRepair(catalog, mech);
            const ready = isMechAvailable(state, mech) && mech.status !== 'hulk';
            const integrity = mechIntegrity(catalog, mech);
            const health = integrity.fraction;
            const status =
              mech.status === 'hulk'
                ? `Wreck — rebuild for ${cbills(mech.rebuildCost)}`
                : !ready
                  ? `In the shop until day ${mech.readyOnDay}`
                  : estimate.days === 0
                    ? 'Ready'
                    : `Damaged — ${cbills(estimate.cost)}, ${estimate.days}d to fix`;

            return (
              <li key={mech.id} className="manifest-row" data-testid={`hangar-${mech.id}`}>
                <div className="manifest-pilot">
                  <span className="pilot-name">{mech.design.name}</span>
                  <small className="manifest-status">{status}</small>
                </div>

                <div className="manifest-mech">
                  <div
                    className="manifest-health"
                    title={`${Math.round(health * 100)}% intact · ${integrity.current}/${integrity.maximum} armour and structure`}
                    role="progressbar"
                    aria-label={`${mech.design.name} integrity`}
                    aria-valuemin={0}
                    aria-valuemax={integrity.maximum}
                    aria-valuenow={integrity.current}
                  >
                    <span style={{ width: `${Math.round(health * 100)}%` }} />
                  </div>
                  <div className="manifest-buttons">
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
                        data-testid={`hangar-rebuild-${mech.id}`}
                      >
                        Rebuild
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={!ready || estimate.days === 0}
                          onClick={() =>
                            mutate((draft) => {
                              const target = draft.mechs.find((entry) => entry.id === mech.id);
                              if (target === undefined) return null;
                              const result = startRepair(catalog, draft, target);
                              return result.ok ? `${target.design.name} in the shop.` : result.reason;
                            })
                          }
                          data-testid={`hangar-repair-${mech.id}`}
                        >
                          Repair
                        </button>
                        <button
                          type="button"
                          disabled={!ready}
                          onClick={() => onRefit(mech.id)}
                          title="Change what this machine is carrying before the drop"
                          data-testid={`hangar-refit-${mech.id}`}
                        >
                          Refit
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="manifest-actions">
          <button type="button" onClick={onContinue} data-testid="hangar-continue">
            Continue to deployment
          </button>
          <button type="button" onClick={onCancel} data-testid="hangar-cancel">
            Back to the map
          </button>
        </footer>
      </section>
    </div>
  );
}
