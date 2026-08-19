import { useEffect, useState } from 'react';
import type { SolvencyReport } from '../../campaign/solvency';

function credits(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

function financeText(report: SolvencyReport, contractActive: boolean): string {
  const plan = report.plan;
  if (plan === null) return '';
  if (contractActive && plan.needsSale) {
    return 'The active contract blocks the hull sales this recovery needs. Withdraw under its signed terms, then reassess the books.';
  }

  const steps: string[] = [];
  if (plan.saleBeforePurchase > 0 && plan.needsSale) {
    steps.push(`sell surplus hulls for up to ${credits(plan.saleBeforePurchase)}`);
  }
  if (plan.mechSource === 'yard' && plan.saleAfterPurchase > 0) {
    steps.push(`buy ${plan.mechName} for ${credits(plan.mechCost)}`);
    steps.push(`sell the retained hull for ${credits(plan.saleAfterPurchase)}`);
  }
  if (plan.pilotName !== null) {
    steps.push(`sign ${plan.pilotName} for ${credits(plan.pilotCost)}`);
  }
  if (plan.mechSource === 'yard' && plan.saleAfterPurchase === 0) {
    steps.push(`buy ${plan.mechName} for ${credits(plan.mechCost)}`);
  } else if (plan.mechNeedsRebuild) {
    steps.push(
      `rebuild ${plan.mechName} for ${credits(plan.mechCost)} ` +
      `(workshop ready day ${plan.mechReadyOnDay})`,
    );
  }
  if (plan.mechNeedsWeapon && plan.weaponName !== null) {
    steps.push(
      plan.mechNeedsRebuild
        ? `when it leaves the bay, fit ${plan.weaponName} to ${plan.mechName}`
        : `fit ${plan.weaponName} to ${plan.mechName}`,
    );
  }

  return `Recovery remains on the books: ${steps.join(', then ')}.`;
}

function terminalText(report: SolvencyReport, contractActive: boolean): string {
  if (contractActive) return 'No fieldable recovery remains. Withdraw from the active contract before closing the company.';
  if (report.block === 'no_pilot') {
    return 'No living pilot remains, and nobody eligible remains on the register.';
  }
  if (report.block === 'no_mech') {
    return 'No company mech remains, and the yard has nothing it can sell today.';
  }
  const plan = report.plan;
  if (plan === null) return 'No fieldable recovery remains.';
  const shortfall = plan.requiredCredits - plan.availableCredits;
  return `Recovery is ${credits(shortfall)} short after every surplus hull is sold.`;
}

export interface CompanyStatusProps {
  report: SolvencyReport;
  contractActive: boolean;
  onAdvance: (day: number) => void;
  onRetire: () => void;
}

export function CompanyStatus({
  report,
  contractActive,
  onAdvance,
  onRetire,
}: CompanyStatusProps) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [report]);
  if (report.state === 'fieldable' || report.state === 'finished') return null;

  let text: string;
  if (report.action === 'wait') {
    const fit = report.plan?.mechNeedsWeapon === true && report.plan.weaponName !== null
      ? `${report.plan.mechName} leaves the workshop on day ${report.recoverOnDay ?? '?'}. ` +
        `Fit ${report.plan.weaponName} before returning it to the field.`
      : `Paid workshop work or injured crew can return the company to the field on day ${report.recoverOnDay ?? '?'}.`;
    text = fit;
  } else if (report.action === 'wait_booking') {
    text = `A paid workshop booking makes the recovery executable on day ${report.recoverOnDay ?? '?'}. ` +
      `Advance to that date, then reassess. ${financeText(report, false)}`;
  } else if (report.action === 'wait_yard') {
    text = `The current yard cannot finish a recovery. New stock arrives on day ${report.recoverOnDay ?? '?'}.`;
  } else if (report.action === 'withdraw') {
    text = report.plan?.needsSale === true && report.state === 'temporary'
      ? financeText(report, contractActive)
      : report.recoverOnDay === null
        ? terminalText(report, contractActive)
        : `The recovery date falls after the signed deadline. Withdraw under the contract terms, then reassess the calendar.`;
  } else if (report.action === 'call_up') {
    text = 'Fit crew and a fieldable mech remain. Prepare the drop and call a pilot up.';
  } else if (report.action === 'reassign') {
    text = 'Fit crew and a fieldable mech remain, but they are not paired. Reassign the seat in the barracks.';
  } else if (report.state === 'fundable') {
    text = financeText(report, contractActive);
  } else {
    text = terminalText(report, contractActive);
  }

  return (
    <div className="company-status" data-testid="company-status">
      <h3>Company status</h3>
      <p>{text}</p>
      {(report.action === 'wait' || report.action === 'wait_booking' || report.action === 'wait_yard') &&
      report.recoverOnDay !== null ? (
        <button
          type="button"
          onClick={() => onAdvance(report.recoverOnDay ?? 0)}
          data-testid="company-recover-wait"
        >
          Advance to day {report.recoverOnDay}
        </button>
      ) : null}
      {report.state === 'terminal' && !contractActive ? (
        confirming ? (
          <div className="camp-buttons">
            <button type="button" onClick={onRetire} data-testid="company-retire-confirm">
              Confirm retirement
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep the company
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            data-testid="company-retire"
          >
            Retire this campaign
          </button>
        )
      ) : null}
    </div>
  );
}
