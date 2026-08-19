import type { Catalog } from '../../schema/load';
import { dropTeam, dropTonnageFor, missionSlots } from '../../campaign/campaign';
import { employerNameFor } from '../../campaign/employers';
import { mechIntegrity } from '../../campaign/integrity';
import { assign } from '../../campaign/roster';
import { isPilotAvailable, type CampaignState, type PilotRecord } from '../../campaign/types';
import { PilotStats } from '../PilotStats';

interface Props {
  catalog: Catalog;
  state: CampaignState;
  mutate: (change: (draft: CampaignState) => void, message?: string) => void;
  onLaunch: () => void;
  onCancel: () => void;
  /** Opens the bay on one of the company's machines, for a pre-drop refit. */
  onRefit: (mechId: string) => void;
}

/**
 * The dropship manifest: who is flying what, and what that buys.
 *
 * The roster existed long before this screen did, and it might as well not
 * have: pilots were seated automatically, in roster order, behind a panel the
 * player had no reason to open. A mission fields four machines out of however
 * many the company owns, so which four, and who is in them, is the decision
 * the campaign is actually about.
 */
export function LanceManifest({ catalog, state, mutate, onLaunch, onCancel, onRefit }: Props) {
  const contract = state.contract;
  if (contract === null) return null;

  const slots = missionSlots(catalog, contract.missionId);
  const allowance = dropTonnageFor(catalog, contract.missionId);
  const dropping = dropTeam(catalog, state, contract.missionId);
  const mission = catalog.missions.get(contract.missionId);
  const employer = employerNameFor(
    catalog,
    state.campaignId,
    contract.employerId,
    contract.employerName,
  );
  const tonnage = dropping.reduce(
    (total, pair) => total + (catalog.chassis.get(pair.mech.design.chassisId)?.tonnage ?? 0),
    0,
  );

  // Everyone fit to fly, whether or not they are dropping — the bench is part
  // of the manifest, not a separate screen.
  const roster = state.pilots.filter((pilot) => !pilot.dead);
  const benched = (pilot: PilotRecord): boolean => state.benched.includes(pilot.id);
  const dropIndex = (pilot: PilotRecord): number =>
    dropping.findIndex((pair) => pair.pilot.id === pilot.id);

  const toggleBench = (pilot: PilotRecord): void => {
    mutate((draft) => {
      const held = draft.benched.includes(pilot.id);
      if (held) draft.benched = draft.benched.filter((id) => id !== pilot.id);
      else draft.benched.push(pilot.id);
    });
  };

  const seat = (pilot: PilotRecord, mechId: string): void => {
    mutate((draft) => {
      assign(draft, pilot.id, mechId === '' ? null : mechId);
    });
  };

  return (
    <div className="manifest-backdrop" data-testid="lance-manifest">
      <section className="manifest">
        <header>
          <h3>Dropship manifest</h3>
          <p>
            {mission?.name ?? contract.missionId} — {employer}.
          </p>
          {/* The profile the loadout has to answer to: how many berths, how
              much weight, and what the contract is actually asking for. */}
          <dl className="manifest-profile" data-testid="manifest-profile">
            <div>
              <dt>Berths</dt>
              <dd>
                {dropping.length}/{slots}
              </dd>
            </div>
            <div className={tonnage > allowance ? 'over' : undefined}>
              <dt>Tonnage</dt>
              <dd data-testid="manifest-tonnage">
                {tonnage}/{allowance}t
              </dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{mission?.type.replace('_', ' ') ?? 'contract'}</dd>
            </div>
          </dl>
          {mission === undefined ? null : <p className="manifest-brief">{mission.briefing}</p>}
        </header>

        <ul className="manifest-list">
          {roster.map((pilot) => {
            const order = dropIndex(pilot);
            const drops = order >= 0 && order < slots;
            const available = isPilotAvailable(state, pilot);
            const seated = state.mechs.find((mech) => mech.id === pilot.mechId) ?? null;
            const integrity = seated === null ? null : mechIntegrity(catalog, seated);
            const health = integrity?.fraction ?? 0;

            const weight =
              seated === null ? 0 : (catalog.chassis.get(seated.design.chassisId)?.tonnage ?? 0);

            const status = !available
              ? `Infirmary until day ${pilot.injuredUntilDay}`
              : benched(pilot)
                ? 'Held back'
                : seated === null
                  ? 'No mech'
                  : seated.status !== 'ready'
                    ? `Mech ${seated.status}`
                    : drops
                      ? `Dropping · ${weight}t`
                      : dropping.length >= slots
                        ? 'Reserve — no berth'
                        : 'Reserve — over the weight allowance';

            return (
              <li
                key={pilot.id}
                className={`manifest-row${drops ? ' drops' : ''}${available ? '' : ' unfit'}`}
                data-testid={`manifest-${pilot.id}`}
              >
                <div className="manifest-pilot">
                  <span className="pilot-name">{pilot.name}</span>
                  {pilot.traits.length === 0 ? null : (
                    <small className="pilot-traits">
                      {pilot.traits
                        .map((id) => catalog.rules.pilotTraits.entries[id]?.label ?? id)
                        .join(' · ')}
                    </small>
                  )}
                  <small className="manifest-status">{status}</small>
                </div>

                <PilotStats catalog={catalog} pilot={pilot} />

                <div className="manifest-mech">
                  <select
                    value={pilot.mechId ?? ''}
                    onChange={(event) => seat(pilot, event.target.value)}
                    data-testid={`manifest-seat-${pilot.id}`}
                    aria-label={`Mech for ${pilot.name}`}
                  >
                    <option value="">— no mech —</option>
                    {state.mechs.map((mech) => (
                      <option key={mech.id} value={mech.id}>
                        {mech.design.name}
                        {mech.status === 'ready' ? '' : ` (${mech.status})`}
                      </option>
                    ))}
                  </select>
                  {seated === null ? null : (
                    <div
                      className="manifest-health"
                      title={`${Math.round(health * 100)}% intact · ${integrity?.current ?? 0}/${integrity?.maximum ?? 0} armour and structure`}
                      role="progressbar"
                      aria-label={`${seated.design.name} integrity`}
                      aria-valuemin={0}
                      aria-valuemax={integrity?.maximum ?? 0}
                      aria-valuenow={integrity?.current ?? 0}
                    >
                      <span style={{ width: `${Math.round(health * 100)}%` }} />
                    </div>
                  )}
                  <div className="manifest-buttons">
                    <button
                      type="button"
                      disabled={!available}
                      onClick={() => toggleBench(pilot)}
                      data-testid={`manifest-bench-${pilot.id}`}
                    >
                      {benched(pilot) ? 'Call up' : 'Hold back'}
                    </button>
                    <button
                      type="button"
                      disabled={seated === null || seated.status !== 'ready'}
                      onClick={() => {
                        if (seated !== null) onRefit(seated.id);
                      }}
                      title="Change what this machine is carrying before the drop"
                      data-testid={`manifest-refit-${pilot.id}`}
                    >
                      Refit
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="manifest-actions">
          <button
            type="button"
            onClick={onLaunch}
            disabled={dropping.length === 0}
            data-testid="manifest-launch"
          >
            Launch ({Math.min(dropping.length, slots)})
          </button>
          <button type="button" onClick={onCancel} data-testid="manifest-cancel">
            Back to the mechbay
          </button>
        </footer>
      </section>
    </div>
  );
}
