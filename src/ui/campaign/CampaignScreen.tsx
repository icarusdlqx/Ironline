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
import type { CampaignState, ContractTermsId } from '../../campaign/types';
import { getCatalog } from '../../schema/load';
import { applyRefit, refitInventory } from '../../campaign/refit';
import { rechooseSalvage } from '../../campaign/salvage';
import { isSideContract } from '../../campaign/sidework';
import { Mechbay, type BayCommission } from '../mechbay/Mechbay';
import { CampaignHeader } from './CampaignHeader';
import { CampaignMap, type NodeState } from './CampaignMap';
import { CampaignLoreManual } from './CampaignLoreManual';
import { ContractPanel } from './ContractPanel';
import {
  Debrief,
  debriefedCount,
  markDebriefed,
  resetDebriefed,
  revealLatestDebrief,
} from './Debrief';
import { Hangar } from './Hangar';
import { LanceManifest } from './LanceManifest';
import { BarracksPanel, cbills, MarketPanel, MechBayPanel, StoresPanel } from './Panels';
import { commitCampaignChange } from './campaignSession';
import { useGame } from '../store';

const catalog = getCatalog();
const CAMPAIGN_ID = 'border_dispute';

export function CampaignScreen({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<CampaignState>(() => {
    const saved = loadCampaign();
    if (saved.state !== null) return saved.state;
    resetDebriefed();
    return startCampaign(catalog, CAMPAIGN_ID, 'border');
  });
  const [manualOpen, setManualOpen] = useState(false);
  /**
   * Where the drop preparation stands: the hangar first, then the manifest.
   * Prep is a corridor, not a pop-up — campaign map → mechbay → deployment →
   * battle — so the bay stops being a side door most players never find.
   */
  const [prep, setPrep] = useState<null | 'bay' | 'manifest'>(null);
  const [refitting, setRefitting] = useState<string | null>(null);
  // Missions fought but not yet debriefed. Counted rather than flagged so the
  // screen can be reopened without the debrief coming back each time.
  const [debriefed, setDebriefed] = useState(() => debriefedCount());
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedTerms, setSelectedTerms] = useState<ContractTermsId>('standard');
  const [status, setStatus] = useState<string | null>(null);
  const patch = useGame((game) => game.patch);

  const campaign = campaignOf(catalog, state);
  const open = useMemo(() => availableNodes(catalog, state), [state]);
  const posted = useMemo(() => open.filter((entry) => isSideContract(entry.id)), [open]);
  const node = open.find((entry) => entry.id === selectedNode) ?? open[0] ?? null;
  const options = node === null ? [] : negotiationOptions(catalog, node);
  const lance = deployableLance(state);
  const pendingDebrief = state.history[state.history.length - 1];

  // The machine on the gantry, if the player has opened one for a refit.
  const refitMech = refitting === null ? null : (state.mechs.find((m) => m.id === refitting) ?? null);
  const refitBay: BayCommission | null =
    refitMech === null
      ? null
      : {
          title: refitMech.design.name,
          design: refitMech.design,
          inventory: refitInventory(state, refitMech),
          onCancel: () => setRefitting(null),
          onCommit: (next) => {
            let outcome: { ok: boolean; reason: string | null } = {
              ok: false,
              reason: 'that mech is no longer in the bay',
            };
            mutate((draft) => {
              const target = draft.mechs.find((entry) => entry.id === refitMech.id);
              if (target === undefined) return;
              outcome = applyRefit(catalog, draft, target, next);
            });
            if (outcome.ok) {
              setRefitting(null);
              setStatus(`${next.name} refitted.`);
            }
            return outcome;
          },
        };

  // A change may say what happened. What it says wins over the caller's
  // caption: a refusal knows more than the button that hoped it would work.
  const mutate = (
    change: (draft: CampaignState) => string | null | void,
    message?: string,
  ): void => {
    const committed = commitCampaignChange(state, change);
    setState(committed.state);
    setStatus(committed.message ?? message ?? null);
  };

  const restore = (restored: CampaignState, message: string): void => {
    saveCampaign(restored);
    setDebriefed(revealLatestDebrief(restored.history.length));
    setState(restored);
    setStatus(message);
  };

  // Deploying walks the prep corridor rather than launching: the hangar for
  // repairs and refits first, then the manifest for who flies what.
  const onDeploy = (): void => {
    if (state.contract === null) {
      setStatus('Accept a contract first.');
      return;
    }
    setPrep('bay');
  };

  const onLaunch = (): void => {
    if (lance.length === 0) {
      setStatus('No mech is ready to deploy.');
      return;
    }
    setPrep(null);
    saveCampaign(state);
    patch({ campaignPending: true, screen: 'battle' });
  };

  return (
    <div className="camp" data-testid="campaign">
      <CampaignHeader
        campaignName={campaign.name}
        day={state.day}
        balance={cbills(state.cbills)}
        onAdvance={advanceDay}
        onSave={() => { saveCampaign(state); setStatus('Campaign saved.'); }}
        onLoad={() => {
          const loaded = loadCampaign();
          if (loaded.state === null) setStatus(loaded.error ?? 'no save');
          else restore(loaded.state, 'Campaign loaded.');
        }}
        onExport={onExportSave}
        onImport={(text) => {
          const loaded = deserialiseCampaign(text);
          if (loaded.state === null) setStatus(loaded.error ?? 'bad save');
          else restore(loaded.state, 'Save imported.');
        }}
        onRestart={() => {
          clearSavedCampaign();
          resetDebriefed();
          setDebriefed(0);
          setState(startCampaign(catalog, CAMPAIGN_ID, 'border'));
          setStatus('New campaign.');
        }}
        onToggleManual={() => setManualOpen((open) => !open)}
        onExit={() => { saveCampaign(state); onExit(); }}
      />

      <CampaignLoreManual
        catalog={catalog}
        open={manualOpen}
        onClose={() => setManualOpen(false)}
      />

      <CampaignMap
        campaign={campaign}
        catalog={catalog}
        selectedId={node?.id ?? null}
        onSelect={setSelectedNode}
        stateOf={(entry): NodeState => {
          if (state.completedNodes.includes(entry.id)) return 'complete';
          if (state.failedNodes.includes(entry.id)) return 'failed';
          return open.some((candidate) => candidate.id === entry.id) ? 'available' : 'locked';
        }}
      />

      <ContractPanel
        contract={state.contract}
        node={node}
        options={options}
        selectedTerms={selectedTerms}
        readyMechs={lance.length}
        finished={state.finished}
        won={state.won}
        onSelectTerms={setSelectedTerms}
        onAccept={(termsId) =>
          mutate((draft) => {
            const result = acceptContract(catalog, draft, node?.id ?? '', termsId);
            return result.ok ? null : result.reason;
          }, 'Contract signed.')
        }
        onDeploy={onDeploy}
        onAbandon={() =>
          mutate(
            (draft) => abandonContract(catalog, draft),
            'Contract withdrawn. Recovery terms applied.',
          )
        }
      />

      {/* The map draws the war. Side work is posted on a board, so it gets a
          list — and it is marked as side work, because taking it is a decision
          about the calendar rather than about the campaign. */}
      {posted.length === 0 || state.contract !== null ? null : (
        <section className="camp-hall" data-testid="camp-hall">
          <h3>Hiring hall</h3>
          <ul>
            {posted.map((offer) => (
              <li key={offer.id} className={offer.id === node?.id ? 'chosen' : ''}>
                <button
                  type="button"
                  onClick={() => setSelectedNode(offer.id)}
                  data-testid={`camp-side-${offer.id}`}
                >
                  <span className="hall-name">{offer.name}</span>
                  <span className="hall-employer">{offer.employer}</span>
                  <span className="hall-terms">
                    {cbills(offer.basePayout)} · {offer.deadlineDays}d
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="hall-note">Posted work. It pays less than the war and it always renews.</p>
        </section>
      )}

      <MechBayPanel state={state} mutate={mutate} />
      <BarracksPanel state={state} mutate={mutate} />
      <StoresPanel state={state} mutate={mutate} />
      <MarketPanel state={state} mutate={mutate} />

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

      {state.history.length <= debriefed || pendingDebrief === undefined ? null : (
        <Debrief
          catalog={catalog}
          state={state}
          outcome={pendingDebrief}
          onChooseSalvage={(picks) => {
            mutate((draft) => {
              const record = draft.history[draft.history.length - 1];
              if (record === undefined) return null;
              // The report the debrief is choosing from lives on the record, so
              // re-picking is a swap against what was already taken aboard.
              const report = {
                candidates: [],
                chassisRecovered: record.salvagedChassis,
                offered: record.salvageOffered ?? [],
                items: record.salvagedItems,
              };
              rechooseSalvage(draft, report, picks);
              record.salvagedItems = report.items;
              return null;
            });
          }}
          onClose={() => {
            markDebriefed(state.history.length);
            setDebriefed(state.history.length);
          }}
        />
      )}

      {prep !== 'bay' || refitting !== null ? null : (
        <Hangar
          catalog={catalog}
          state={state}
          mutate={mutate}
          onRefit={setRefitting}
          onContinue={() => setPrep('manifest')}
          onCancel={() => setPrep(null)}
        />
      )}

      {prep !== 'manifest' || refitting !== null ? null : (
        <LanceManifest
          catalog={catalog}
          state={state}
          mutate={mutate}
          onLaunch={onLaunch}
          onCancel={() => setPrep('bay')}
          onRefit={setRefitting}
        />
      )}

      {/* The bay, opened on one machine out of the company's own, with the
          shelves limited to what it actually owns. Mission prep is: who
          drops, in what, carrying what. */}
      {refitBay === null ? null : (
        <div className="manifest-backdrop" data-testid="refit-bay">
          <div className="refit-bay">
            <Mechbay onExit={() => setRefitting(null)} commission={refitBay} />
          </div>
        </div>
      )}
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
