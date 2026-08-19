import type { NegotiationOption } from '../../campaign/contractTerms';
import { SALVAGE_OFFERED, SALVAGE_PICKS } from '../../campaign/salvage';
import type { SalvageOutcome } from '../../campaign/types';
import type { SalvageRules } from '../../schema/rules';
import './salvage.css';

function cbills(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

export function salvageStance(step: number, steps: number): string {
  const position = steps <= 1 ? 0 : step / (steps - 1);
  if (position === 0) return 'Cash first';
  if (position <= 0.33) return 'Cash leaning';
  if (position <= 0.66) return 'Balanced';
  if (position < 1) return 'Salvage leaning';
  return 'Salvage first';
}

type ListedOutcome = Exclude<SalvageOutcome, 'ejected'>;

const HULL_OUTCOMES: ReadonlyArray<{ outcome: ListedOutcome; label: string }> = [
  { outcome: 'legged', label: 'Both legs destroyed; side defeated' },
  { outcome: 'head', label: 'Head destroyed' },
  { outcome: 'centre_torso', label: 'Centre torso destroyed' },
  { outcome: 'ammo_explosion', label: 'Ammo explosion' },
];

function chance(value: number): string {
  const percent = Number((value * 100).toFixed(1));
  return `${percent}%`;
}

export function hullRecoveryOdds(
  rules: SalvageRules,
  share: number,
): Array<{ outcome: ListedOutcome; label: string; base: string; package: string }> {
  return HULL_OUTCOMES.map(({ outcome, label }) => ({
    outcome,
    label,
    base: chance(rules.chassisRecoveryByOutcome[outcome]),
    package: chance(rules.chassisRecoveryByOutcome[outcome] * share),
  }));
}

export function partRecoveryOdds(rules: SalvageRules, share: number): string {
  return (
    `Weapon in an intact location ${chance(rules.weaponRecoveryMin)}–${chance(rules.weaponRecoveryMax)} base ` +
    `→ ${chance(rules.weaponRecoveryMin * share)}–${chance(rules.weaponRecoveryMax * share)} package; ` +
    `equipment in an intact location ${chance(rules.equipmentRecovery)} → ` +
    `${chance(rules.equipmentRecovery * share)}; ` +
    `part in a destroyed location ${chance(rules.destroyedLocationRecovery)} → ` +
    `${chance(rules.destroyedLocationRecovery * share)}.`
  );
}

export function salvageRightsExplanation(share: number): string {
  const percent = Math.round(share * 100);
  const legging =
    'A legged capture needs both legs destroyed, the mech still operational, and its side defeated.';
  if (percent === 0) return `No claim. Enemy hulls and parts cannot be recovered. ${legging}`;
  return `${percent}% claim multiplies the field odds. ${legging}`;
}

export function SalvageTerms({
  option,
  step,
  steps,
  rules,
}: {
  option: NegotiationOption | undefined;
  step: number;
  steps: number;
  rules: SalvageRules;
}) {
  const payout = option?.payout ?? 0;
  const share = option?.salvageShare ?? 0;
  return (
    <div className="camp-salvage-terms">
      <p data-testid="camp-offer">
        <strong>{cbills(payout)}</strong> · {Math.round(share * 100)}% salvage claim
        <span className="salvage-stance">{salvageStance(step, steps)}</span>
      </p>
      <p className="salvage-rights" data-testid="camp-salvage-rights">
        {salvageRightsExplanation(share)}
      </p>
      <table className="salvage-odds" data-testid="camp-salvage-odds">
        <caption>Enemy walking-hull recovery</caption>
        <thead>
          <tr>
            <th scope="col">Field result</th>
            <th scope="col">Base</th>
            <th scope="col">Package</th>
          </tr>
        </thead>
        <tbody>
          {hullRecoveryOdds(rules, share).map((row) => (
            <tr key={row.outcome} data-testid={`camp-salvage-odds-${row.outcome}`}>
              <th scope="row">{row.label}</th>
              <td>{row.base}</td>
              <td>{row.package}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="salvage-part-odds" data-testid="camp-salvage-part-odds">
        {partRecoveryOdds(rules, share)}
      </p>
      <p className="salvage-capacity">
        Recovered hulls are towed separately. A rich field lists up to {SALVAGE_OFFERED} crate
        types; weapons and equipment alternate, and each list rotates from one field to the next.
        The hold takes {SALVAGE_PICKS}.
      </p>
    </div>
  );
}
