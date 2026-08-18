import type { NegotiationOption } from '../../campaign/campaign';
import { SALVAGE_OFFERED, SALVAGE_PICKS } from '../../campaign/salvage';

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

export function salvageRightsExplanation(share: number): string {
  const percent = Math.round(share * 100);
  if (percent === 0) return 'No claim. Enemy hulls and parts cannot be recovered.';
  return (
    `${percent}% claim scales each eligible recovery chance. ` +
    `A rich field offers up to ${SALVAGE_OFFERED} crate types; the hold takes ${SALVAGE_PICKS}.`
  );
}

export function SalvageTerms({
  option,
  step,
  steps,
}: {
  option: NegotiationOption | undefined;
  step: number;
  steps: number;
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
    </div>
  );
}
