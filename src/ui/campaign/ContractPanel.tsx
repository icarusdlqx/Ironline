import type { ReactNode } from 'react';
import { termsName, type NegotiationOption } from '../../campaign/contractTerms';
import type { CampaignState, Contract, ContractTermsId } from '../../campaign/types';
import type { CampaignNode } from '../../schema/campaign';
import type { SalvageRules } from '../../schema/rules';
import type { EmployerHistory } from '../../campaign/employers';
import type { Catalog } from '../../schema/load';
import { EmployerLedger, employerHistoryText } from './EmployerLedger';
import { ContractBriefing } from './ContractBriefing';
import { SalvageTerms } from './SalvageTerms';

function cbills(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

interface ContractPanelProps {
  catalog: Catalog;
  state: CampaignState;
  contract: Contract | null;
  node: CampaignNode | null;
  options: NegotiationOption[];
  selectedTerms: ContractTermsId;
  salvageRules: SalvageRules;
  readyMechs: number;
  finished: boolean;
  won: boolean;
  employer: EmployerHistory | null;
  employers: EmployerHistory[];
  companyStatus?: ReactNode;
  onSelectTerms: (termsId: ContractTermsId) => void;
  onAccept: (termsId: ContractTermsId) => void;
  onDeploy: () => void;
  onAbandon: () => void;
}

export function ContractPanel({
  catalog,
  state,
  contract,
  node,
  options,
  selectedTerms,
  salvageRules,
  readyMechs,
  finished,
  won,
  employer,
  employers,
  companyStatus,
  onSelectTerms,
  onAccept,
  onDeploy,
  onAbandon,
}: ContractPanelProps) {
  const selected =
    options.find((option) => option.id === selectedTerms) ?? options[1] ?? options[0] ?? null;
  const selectedIndex = selected === null ? 0 : Math.max(0, options.indexOf(selected));
  const choosing = contract === null && node !== null;
  const signedNode = contract === null
    ? null
    : catalog.campaigns.get(state.campaignId)?.nodes.find((entry) => entry.id === contract.nodeId);
  const signedMission = contract === null ? null : catalog.missions.get(contract.missionId);

  return (
    <section
      className={choosing ? 'camp-contract negotiating' : 'camp-contract'}
      data-testid="camp-contract"
      tabIndex={-1}
    >
      {contract !== null ? (
        <>
          <h3>{signedNode?.name ?? signedMission?.name ?? 'Active contract'}</h3>
          <p className="contract-package" data-testid="camp-active-terms">
            {termsName(contract.termsId)}
          </p>
          {employer === null ? null : (
            <p className="employer-facts" data-testid="camp-employer-facts">
              <strong>{employer.name}</strong> · {employerHistoryText(employer)}
            </p>
          )}
          <ContractBriefing
            catalog={catalog}
            state={state}
            missionId={contract.missionId}
            deadlineDay={contract.deadlineDay}
            nodeId={contract.nodeId}
            terms={contract}
          />
          <p className="camp-brief">{signedNode?.brief ?? signedMission?.briefing ?? ''}</p>
          <div className="camp-buttons">
            <button type="button" onClick={onDeploy} disabled={finished} data-testid="camp-deploy">
              Prepare drop ({readyMechs} mech{readyMechs === 1 ? '' : 's'} ready)
            </button>
            <button type="button" onClick={onAbandon} disabled={finished} data-testid="camp-abandon">
              Withdraw
            </button>
          </div>
        </>
      ) : node === null ? (
        <p>No contracts on offer. {finished ? (won ? 'Campaign won.' : 'Campaign over.') : ''}</p>
      ) : (
        <>
          <h3>{node.name}</h3>
          {employer === null ? null : (
            <p className="employer-facts" data-testid="camp-employer-facts">
              <strong>{employer.name}</strong> · {employerHistoryText(employer)}
            </p>
          )}
          <p className="camp-brief">{node.brief}</p>
          {selected === null ? null : (
            <ContractBriefing
              catalog={catalog}
              state={state}
              missionId={node.missionId}
              deadlineDay={state.day + node.deadlineDays}
              nodeId={node.id}
              terms={selected}
            />
          )}
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
                <span className="contract-option-pay">{cbills(option.payout)} on success only</span>
                <span className="contract-option-salvage">
                  {Math.round(option.salvageShare * 100)}% salvage
                </span>
              </label>
            ))}
          </fieldset>
          {selected === null ? null : (
            <details className="contract-salvage-detail">
              <summary>Recovery odds for {selected.name.toLowerCase()} terms</summary>
              <SalvageTerms
                option={selected}
                step={selectedIndex}
                steps={options.length}
                rules={salvageRules}
              />
            </details>
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
      {companyStatus}
      <EmployerLedger employers={employers} />
    </section>
  );
}
