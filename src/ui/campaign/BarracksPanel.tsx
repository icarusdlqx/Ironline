import { dailyPayroll } from '../../campaign/ledger';
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
  skillTotal,
  SKILLS,
  type Skill,
} from '../../campaign/roster';
import { isPilotAvailable, type CampaignState, type PilotRecord } from '../../campaign/types';
import { getCatalog } from '../../schema/load';
import type { Pilot } from '../../schema/pilot';
import {
  nextSpecialityThreshold,
  skillTraining,
  traitEffects,
} from '../pilotProgression';
import './progression.css';

const catalog = getCatalog();

interface Props {
  state: CampaignState;
  mutate: (change: (draft: CampaignState) => string | null | void, message?: string) => void;
}

function credits(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

function TraitReadout({ traitId }: { traitId: string }) {
  const trait = catalog.rules.pilotTraits.entries[traitId];
  if (trait === undefined) return <small>{traitId}</small>;
  return (
    <small className="pilot-trait" title={trait.note}>
      <strong>{trait.label}</strong>
      <span>{traitEffects(trait).join(' · ')}</span>
    </small>
  );
}

function SpecialityProgress({ pilot, mutate }: { pilot: PilotRecord; mutate: Props['mutate'] }) {
  if (pilot.dead) return <p className="pilot-milestone">Record closed.</p>;
  const pending = pendingTraitPicks(catalog, pilot);
  if (pending > 0) {
    return (
      <div className="pilot-picks" data-testid={`camp-pick-${pilot.id}`}>
        <p>Speciality earned. Choose one:</p>
        {offeredTraits(catalog, pilot).map((traitId) => {
          const trait = catalog.rules.pilotTraits.entries[traitId];
          if (trait === undefined) return null;
          return (
            <button
              type="button"
              key={traitId}
              title={trait.note}
              onClick={() =>
                mutate((draft) => {
                  const target = draft.pilots.find((entry) => entry.id === pilot.id);
                  if (target === undefined) return null;
                  const result = chooseTrait(catalog, target, traitId);
                  return result.ok
                    ? `${target.name} trained ${trait.label}: ${traitEffects(trait).join(', ')}.`
                    : result.reason;
                })
              }
              data-testid={`camp-pick-${pilot.id}-${traitId}`}
            >
              <strong>{trait.label}</strong>
              <small>{traitEffects(trait).join(' · ')}</small>
            </button>
          );
        })}
      </div>
    );
  }

  const threshold = nextSpecialityThreshold(catalog, pilot);
  if (threshold === null) return <p className="pilot-milestone">Speciality track complete.</p>;
  const levels = threshold - skillTotal(pilot);
  return (
    <p className="pilot-milestone">
      Next speciality at {threshold} total skill — {levels} level{levels === 1 ? '' : 's'} to go.
    </p>
  );
}

function TrainingButton({ pilot, skill, mutate }: { pilot: PilotRecord; skill: Skill; mutate: Props['mutate'] }) {
  const training = skillTraining(catalog, pilot, skill);
  const bank = availableXp(pilot);
  const disabled = pilot.dead || training.cost === null || bank < training.cost;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        mutate((draft) => {
          const target = draft.pilots.find((entry) => entry.id === pilot.id);
          if (target === undefined) return null;
          const result = raiseSkill(catalog, target, skill);
          return result.ok
            ? `${target.name}: ${skill} ${target[skill]}. ${training.nextEffect ?? ''} ${availableXp(target)} XP remains.`
            : result.reason;
        })
      }
      data-testid={`camp-skill-${pilot.id}-${skill}`}
    >
      <span>
        {skill} {training.currentLevel}
        {training.nextLevel === null ? ' — maximum' : ` → ${training.nextLevel}`}
      </span>
      <small>
        {training.nextEffect === null
          ? training.currentEffect
          : `${training.currentEffect} → ${training.nextEffect}`}
      </small>
      <b>{training.cost === null ? '—' : `${training.cost} XP`}</b>
    </button>
  );
}

function PilotCard({ pilot, state, mutate }: { pilot: PilotRecord; state: CampaignState; mutate: Props['mutate'] }) {
  return (
    <li className="pilot-card" data-testid={`camp-pilot-${pilot.id}`}>
      <header title={pilot.bio}>
        <span className="pilot-name">{pilot.name}</span>
        <span className="pilot-state">
          {pilot.dead
            ? 'KIA'
            : `${availableXp(pilot)} XP banked${isPilotAvailable(state, pilot) ? '' : ` · injured to day ${pilot.injuredUntilDay}`}`}
        </span>
      </header>

      {pilot.traits.length === 0 ? null : (
        <div className="pilot-traits">
          {pilot.traits.map((traitId) => <TraitReadout key={traitId} traitId={traitId} />)}
        </div>
      )}

      <label className="pilot-seat">
        Assigned mech
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
              {mech.design.name}{mech.status === 'ready' ? '' : ` (${mech.status})`}
            </option>
          ))}
        </select>
      </label>

      {pilot.dead ? null : (
        <div className="pilot-training">
          {SKILLS.map((skill) => (
            <TrainingButton key={skill} pilot={pilot} skill={skill} mutate={mutate} />
          ))}
        </div>
      )}
      <SpecialityProgress pilot={pilot} mutate={mutate} />
    </li>
  );
}

function HireRow({ hire, state, mutate }: { hire: Pilot; state: CampaignState; mutate: Props['mutate'] }) {
  const cost = hireCost(catalog, hire);
  const salary = catalog.rules.economy.pilot.salaryPerDay;
  return (
    <li key={hire.id} title={hire.bio} data-testid={`camp-hire-${hire.id}`}>
      <span className="pilot-name">
        {hire.name}
        {hire.traits.map((traitId) => <TraitReadout key={traitId} traitId={traitId} />)}
      </span>
      <span className="pilot-skills">{hire.gunnery}/{hire.piloting}/{hire.sensors}</span>
      <span className="pilot-state">{credits(cost)} · {credits(salary)}/day</span>
      <button
        type="button"
        disabled={state.cbills < cost}
        onClick={() =>
          mutate((draft) => {
            const result = hirePilot(catalog, draft, hire.id);
            return result.ok ? `${hire.name} signed. Payroll rises by ${credits(salary)} a day.` : result.reason;
          })
        }
        data-testid={`camp-sign-${hire.id}`}
      >
        Sign
      </button>
    </li>
  );
}

export function BarracksPanel({ state, mutate }: Props) {
  const payroll = dailyPayroll(catalog, state);
  const hires = availableHires(catalog, state);
  return (
    <section className="camp-roster progression-roster" data-testid="camp-roster">
      <header className="roster-ledger">
        <h3>Barracks</h3>
        <strong>{credits(payroll)}/day</strong>
      </header>
      <p className="ledger-note">Wages leave the account whenever the calendar moves. Injured crew remain on payroll.</p>
      <ul>{state.pilots.map((pilot) => <PilotCard key={pilot.id} pilot={pilot} state={state} mutate={mutate} />)}</ul>

      <h4>Hiring hall</h4>
      <ul className="camp-hires">
        {hires.slice(0, 6).map((hire) => <HireRow key={hire.id} hire={hire} state={state} mutate={mutate} />)}
        {hires.length === 0 ? <li className="camp-empty">Nobody left on the register.</li> : null}
      </ul>
    </section>
  );
}
