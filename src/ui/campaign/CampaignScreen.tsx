import { useMemo, useState } from 'react';
import {
  abandonContract,
  acceptContract,
  advanceDays,
  availableNodes,
  campaignOf,
  deployableLance,
  negotiationOptions,
  startCampaign,
} from '../../campaign/campaign';
import {
  campaignBlob,
  clearSavedCampaign,
  deserialiseCampaign,
  loadCampaign,
  saveCampaign,
} from '../../campaign/save';
import type { CampaignState } from '../../campaign/types';
import { getCatalog } from '../../schema/load';
import { BarracksPanel, MechBayPanel, StoresPanel } from './Panels';
import { useGame } from '../store';

const catalog = getCatalog();
const CAMPAIGN_ID = 'border_dispute';

function cbills(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

export function CampaignScreen({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<CampaignState>(() => {
    const saved = loadCampaign();
    return saved.state ?? startCampaign(catalog, CAMPAIGN_ID, 'border');
  });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [step, setStep] = useState(4);
  const [status, setStatus] = useState<string | null>(null);
  const patch = useGame((game) => game.patch);

  const campaign = campaignOf(catalog, state);
  const open = useMemo(() => availableNodes(catalog, state), [state]);
  const node = open.find((entry) => entry.id === selectedNode) ?? open[0] ?? null;
  const options = node === null ? [] : negotiationOptions(catalog, node);
  const lance = deployableLance(state);

  const mutate = (change: (draft: CampaignState) => void, message?: string): void => {
    const draft = JSON.parse(JSON.stringify(state)) as CampaignState;
    change(draft);
    setState(draft);
    setStatus(message ?? null);
  };

  const onDeploy = (): void => {
    if (state.contract === null) {
      setStatus('Accept a contract first.');
      return;
    }
    if (lance.length === 0) {
      setStatus('No mech is ready to deploy.');
      return;
    }
    saveCampaign(state);
    patch({ campaignPending: true, screen: 'battle' });
  };

  return (
    <div className="camp" data-testid="campaign">
      <header className="camp-top">
        <h2>{campaign.name}</h2>
        <span data-testid="camp-day">Day {state.day}</span>
        <span data-testid="camp-cbills">{cbills(state.cbills)}</span>
        <button type="button" onClick={() => advanceDay()} data-testid="camp-advance">
          Advance a day
        </button>
        <button type="button" onClick={() => { saveCampaign(state); setStatus('Campaign saved.'); }} data-testid="camp-save">
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            const loaded = loadCampaign();
            if (loaded.state === null) setStatus(loaded.error ?? 'no save');
            else { setState(loaded.state); setStatus('Campaign loaded.'); }
          }}
          data-testid="camp-load"
        >
          Load
        </button>
        <button type="button" onClick={onExportSave} data-testid="camp-export">
          Export
        </button>
        <label className="camp-import">
          Import
          <input
            type="file"
            accept="application/json"
            data-testid="camp-import"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file === undefined) return;
              void file.text().then((text) => {
                const loaded = deserialiseCampaign(text);
                if (loaded.state === null) setStatus(loaded.error ?? 'bad save');
                else { setState(loaded.state); setStatus('Save imported.'); }
              });
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => { clearSavedCampaign(); setState(startCampaign(catalog, CAMPAIGN_ID, 'border')); setStatus('New campaign.'); }}
          data-testid="camp-restart"
        >
          Restart
        </button>
        <button type="button" onClick={onExit} data-testid="camp-exit">
          Skirmish
        </button>
      </header>

      <section className="camp-map" data-testid="camp-map">
        {campaign.nodes.map((entry) => {
          const done = state.completedNodes.includes(entry.id);
          const failed = state.failedNodes.includes(entry.id);
          const isOpen = open.some((candidate) => candidate.id === entry.id);
          const classes = ['camp-node'];
          if (done) classes.push('done');
          if (failed) classes.push('failed');
          if (isOpen) classes.push('open');
          if (node?.id === entry.id) classes.push('selected');

          return (
            <button
              key={entry.id}
              type="button"
              className={classes.join(' ')}
              style={{ left: `${entry.position.x * 100}%`, top: `${entry.position.y * 100}%` }}
              disabled={!isOpen}
              onClick={() => setSelectedNode(entry.id)}
              data-testid={`camp-node-${entry.id}`}
            >
              <span className="node-name">{entry.name}</span>
              <span className="node-state">{done ? 'complete' : failed ? 'failed' : isOpen ? 'available' : 'locked'}</span>
            </button>
          );
        })}
      </section>

      <section className="camp-contract" data-testid="camp-contract">
        {state.contract !== null ? (
          <>
            <h3>Active contract</h3>
            <p>
              {state.contract.employer} — {cbills(state.contract.payout)},{' '}
              {Math.round(state.contract.salvageShare * 100)}% salvage, due day{' '}
              {state.contract.deadlineDay}.
            </p>
            <div className="camp-buttons">
              <button type="button" onClick={onDeploy} data-testid="camp-deploy">
                Deploy ({lance.length} mech{lance.length === 1 ? '' : 's'})
              </button>
              <button
                type="button"
                onClick={() => mutate((draft) => abandonContract(draft), 'Contract abandoned.')}
                data-testid="camp-abandon"
              >
                Withdraw
              </button>
            </div>
          </>
        ) : node === null ? (
          <p>No contracts on offer. {state.finished ? (state.won ? 'Campaign won.' : 'Campaign over.') : ''}</p>
        ) : (
          <>
            <h3>{node.name}</h3>
            <p className="camp-brief">{node.brief}</p>
            <label className="camp-negotiate">
              Terms
              <input
                type="range"
                min={0}
                max={options.length - 1}
                value={Math.min(step, options.length - 1)}
                onChange={(event) => setStep(Number(event.target.value))}
                data-testid="camp-terms"
              />
            </label>
            <p data-testid="camp-offer">
              {cbills(options[Math.min(step, options.length - 1)]?.payout ?? 0)} ·{' '}
              {Math.round((options[Math.min(step, options.length - 1)]?.salvageShare ?? 0) * 100)}% salvage
            </p>
            <button
              type="button"
              onClick={() =>
                mutate((draft) => {
                  const result = acceptContract(catalog, draft, node.id, Math.min(step, options.length - 1));
                  if (!result.ok) setStatus(result.reason);
                }, 'Contract signed.')
              }
              data-testid="camp-accept"
            >
              Sign
            </button>
          </>
        )}
      </section>

      <MechBayPanel state={state} mutate={mutate} setStatus={setStatus} />
      <BarracksPanel state={state} mutate={mutate} setStatus={setStatus} />
      <StoresPanel state={state} mutate={mutate} setStatus={setStatus} />

      <footer className="camp-log" data-testid="camp-log">
        <span className="camp-status" data-testid="camp-status">
          {status ?? ''}
        </span>
        <ul>
          {state.log.slice(0, 6).map((entry, index) => (
            <li key={`${entry.day}-${index}`}>
              day {entry.day}: {entry.text}
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );

  function advanceDay(): void {
    mutate((draft) => advanceDays(catalog, draft, 1));
  }

  function onExportSave(): void {
    const url = URL.createObjectURL(campaignBlob(state));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.campaignId}-day${state.day}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Save exported.');
  }
}
