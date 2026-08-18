import { termsName, type NegotiationOption } from '../../campaign/contractTerms';
import type { Contract, ContractTermsId } from '../../campaign/types';
import type { CampaignNode } from '../../schema/campaign';
import { SalvageTerms } from './SalvageTerms';

function cbills(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

function repairTerms(): string {
  return 'Repair cover: none. The company pays its own yard bill.';
}

interface ContractPanelProps {
  contract: Contract | null;
  node: CampaignNode | null;
  options: NegotiationOption[];
  selectedTerms: ContractTermsId;
  readyMechs: number;
  finished: boolean;
  won: boolean;
  onSelectTerms: (termsId: ContractTermsId) => void;
  onAccept: (termsId: ContractTermsId) => void;
  onDeploy: () => void;
  onAbandon: () => void;
}

export function ContractPanel({
  contract,
  node,
  options,
  selectedTerms,
  readyMechs,
  finished,
  won,
  onSelectTerms,
  onAccept,
  onDeploy,
  onAbandon,
}: ContractPanelProps) {
  const selected =
    options.find((option) => option.id === selectedTerms) ?? options[1] ?? options[0] ?? null;
  const selectedIndex = selected === null ? 0 : Math.max(0, options.indexOf(selected));
  const choosing = contract === null && node !== null;

  return (
    <section
      className={choosing ? 'camp-contract negotiating' : 'camp-contract'}
      data-testid="camp-contract"
    >
      {contract !== null ? (
        <>
          <h3>Active contract</h3>
          <p className="contract-package" data-testid="camp-active-terms">
            {termsName(contract.termsId)}
          </p>
          <p>
            {contract.employer} — {cbills(contract.payout)} on success,{' '}
            {Math.round(contract.salvageShare * 100)}% salvage claim, due day {contract.deadlineDay}.
          </p>
          <p className="contract-exposure">{repairTerms()}</p>
          <div className="camp-buttons">
            <button type="button" onClick={onDeploy} data-testid="camp-deploy">
              Prepare drop ({readyMechs} mech{readyMechs === 1 ? '' : 's'} ready)
            </button>
            <button type="button" onClick={onAbandon} data-testid="camp-abandon">
              Withdraw
            </button>
          </div>
        </>
      ) : node === null ? (
        <p>No contracts on offer. {finished ? (won ? 'Campaign won.' : 'Campaign over.') : ''}</p>
      ) : (
        <>
          <h3>{node.name}</h3>
          <p className="camp-brief">{node.brief}</p>
          <fieldset className="camp-negotiate" data-testid="camp-terms">
            <legend>Terms</legend>
            {options.map((option) => (
              <label
                className={option.id === selected?.id ? 'contract-option chosen' : 'contract-option'}
                key={option.id}
              >
                <input
                  type="radio"
                  name="contract-terms"
                  value={option.id}
                  checked={option.id === selected?.id}
                  onChange={() => onSelectTerms(option.id)}
                  data-testid={`camp-terms-${option.id}`}
                />
                <span className="contract-option-name">{option.name}</span>
                <span className="contract-option-pay">{cbills(option.payout)} on success</span>
                <span className="contract-option-salvage">
                  {Math.round(option.salvageShare * 100)}% salvage
                </span>
              </label>
            ))}
          </fieldset>
          {selected === null ? null : (
            <>
              <SalvageTerms option={selected} step={selectedIndex} steps={options.length} />
              <p className="contract-exposure">{repairTerms()}</p>
            </>
          )}
          <button
            type="button"
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) onAccept(selected.id);
            }}
            data-testid="camp-accept"
          >
            Sign {selected?.name ?? 'terms'}
          </button>
        </>
      )}
    </section>
  );
}
