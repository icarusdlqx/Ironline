import { LOCATIONS } from '../../schema/common';
import type { Catalog } from '../../schema/load';
import { dropTeam, dropTonnageFor, missionSlots } from '../../campaign/campaign';
import { assign } from '../../campaign/roster';
import { isPilotAvailable, type CampaignState, type PilotRecord } from '../../campaign/types';
import { sensorRangeFor } from '../../sim/sensors';

interface Props {
  catalog: Catalog;
  state: CampaignState;
  mutate: (change: (draft: CampaignState) => void, message?: string) => void;
  onLaunch: () => void;
  onCancel: () => void;
  /** Opens the bay on one of the company's machines, for a pre-drop refit. */
  onRefit: (mechId: string) => void;
}

/** What a skill actually buys, in the units the player sees on the field. */
function effects(catalog: Catalog, pilot: PilotRecord): { label: string; value: string }[] {
  const combat = catalog.rules.combat;
  const base = combat.gunneryBase[pilot.gunnery - 1] ?? combat.gunneryBase[0] ?? 0.5;
  const shutdown = Math.max(0, 1 - pilot.piloting * catalog.rules.heat.pilotingOverrideFactor);

  return [
    { label: 'Gunnery', value: `${pilot.gunnery} — ${Math.round(base * 100)}% base hit chance` },
    {
      label: 'Piloting',
      value: `${pilot.piloting} — ${Math.round(shutdown * 100)}% of the usual shutdown risk`,
    },
    {
      label: 'Sensors',
      value: `${pilot.sensors} — ${Math.round(sensorRangeFor(catalog.rules.sensors, pilot.sensors))}m detection`,
    },
  ];
}

/** How much of a mech is still there, as a fraction of what it should have. */
function integrity(state: CampaignState, mechId: string): number {
  const mech = state.mechs.find((entry) => entry.id === mechId);
  if (mech === undefined) return 0;
  let have = 0;
  let want = 0;
  for (const location of LOCATIONS) {
    const condition = mech.condition[location];
    // The design's number is the front and back together, so `want` already
    // accounts for the split without needing to know about it.
    have += condition.armour + condition.rearArmour + condition.internal;
    want += mech.design.armour[location] + condition.internal;
  }
  return want === 0 ? 1 : Math.max(0, Math.min(1, have / want));
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
            {mission?.name ?? contract.missionId} — {contract.employer}.
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
            const health = seated === null ? 0 : integrity(state, seated.id);

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

                <dl className="manifest-skills">
                  {effects(catalog, pilot).map((entry) => (
                    <div key={entry.label}>
                      <dt>{entry.label}</dt>
                      <dd>{entry.value}</dd>
                    </div>
                  ))}
                </dl>

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
                    <div className="manifest-health" title={`${Math.round(health * 100)}% intact`}>
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
            Back to base
          </button>
        </footer>
      </section>
    </div>
  );
}
