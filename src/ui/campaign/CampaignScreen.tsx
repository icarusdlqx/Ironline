import { useMemo, useState } from 'react';
import {
  abandonContract,
  acceptContract,
  advanceDays,
  availableNodes,
  campaignOf,
  deployableLance,
  negotiationOptions,
} from '../../campaign/campaign';
import {
  campaignBlob,
  campaignPersistenceStatus,
  deserialiseCampaign,
  loadCampaign,
  rawCampaignBlob,
  saveCampaign,
} from '../../campaign/save';
import type { CampaignState, ContractTermsId } from '../../campaign/types';
import { getCatalog } from '../../schema/load';
import { applyRefit, refitInventory } from '../../campaign/refit';
import { rechooseSalvage } from '../../campaign/salvage';
import { isSideContract } from '../../campaign/sidework';
import { createCampaignSeed, startFreshCampaign } from '../../campaign/freshness';
import { campaignOutcomeCount } from '../../campaign/history';
import {
  employerDisplayName,
  employerHistories,
  type EmployerHistory,
} from '../../campaign/employers';
import { Mechbay, type BayCommission } from '../mechbay/Mechbay';
import { CampaignHeader } from './CampaignHeader';
import { CampaignMap, type NodeState } from './CampaignMap';
import { ContractPanel } from './ContractPanel';
import {
  Debrief,
  debriefedCount,
  markDebriefed,
  resetDebriefed,
  revealLatestDebrief,
} from './Debrief';
import { FieldManual } from './FieldManual';
import { Hangar } from './Hangar';
import { HiringHall } from './HiringHall';
import { LanceManifest } from './LanceManifest';
import { BarracksPanel, cbills, MarketPanel, MechBayPanel, StoresPanel } from './Panels';
import { commitCampaignChange, openCampaignSession } from './campaignSession';
import { downloadCampaignFile } from './campaignDownload';
import { useGame } from '../store';

const catalog = getCatalog();
const CAMPAIGN_ID = 'border_dispute';

export function CampaignScreen({ onExit }: { onExit: () => void }) {
  const [initial] = useState(() => openCampaignSession(catalog, CAMPAIGN_ID, resetDebriefed));
  const [state, setState] = useState<CampaignState>(initial.state);
  const [persistence, setPersistence] = useState(initial.persistence);
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
  const employers = useMemo(
    () => employerHistories(
      campaign,
      state.history,
      state.employerFailures,
      state.historyArchive.employers,
    ),
    [campaign, state.history, state.employerFailures, state.historyArchive.employers],
  );
  const open = useMemo(() => availableNodes(catalog, state), [state]);
  const posted = useMemo(() => open.filter((entry) => isSideContract(entry.id)), [open]);
  const node = open.find((entry) => entry.id === selectedNode) ?? open[0] ?? null;
  const options = node === null ? [] : negotiationOptions(catalog, node);
  const lance = deployableLance(state);
  const pendingDebrief = state.history[state.history.length - 1];
  const outcomeCount = campaignOutcomeCount(state);
  const employer = currentEmployer();

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
    setPersistence(committed.persistence.status);
    setStatus(committed.message ?? message ?? null);
  };

  const restore = (restored: CampaignState, message: string, recover = false): void => {
    const saved = saveCampaign(restored, { recover });
    setDebriefed(revealLatestDebrief(campaignOutcomeCount(restored)));
    setState(restored);
    setPersistence(saved.status);
    setStatus(saved.ok ? message : 'Campaign opened in memory; the save was not written.');
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
    const saved = saveCampaign(state);
    setPersistence(saved.status);
    if (!saved.ok) {
      setStatus('Deployment held. Restart or import a valid campaign before deploying.');
      return;
    }
    patch({ campaignPending: true, screen: 'battle' });
  };

  const revealPosting = (id: string): void => {
    setSelectedNode(id);
    globalThis.requestAnimationFrame?.(() => {
      const panel = globalThis.document?.querySelector<HTMLElement>('[data-testid="camp-contract"]');
      panel?.focus({ preventScroll: true });
      panel?.scrollIntoView({ block: 'start' });
    });
  };

  return (
    <div className="camp" data-testid="campaign">
      <CampaignHeader
        title={campaign.name}
        day={state.day}
        balance={cbills(state.cbills)}
        seed={state.seed}
        manualOpen={manualOpen}
        persistence={persistence}
        onAdvance={advanceDay}
        onSave={() => {
          const saved = saveCampaign(state);
          setPersistence(saved.status);
          setStatus(saved.ok ? 'Campaign saved.' : 'Save not written; campaign is memory-only.');
        }}
        onLoad={() => {
          const loaded = loadCampaign(catalog, { storedOnly: true });
          setPersistence(loaded.persistence);
          if (loaded.state === null) setStatus(loaded.error ?? 'no save');
          else restore(loaded.state, 'Campaign loaded.');
        }}
        onExport={onExportSave}
        onExportRecovery={onExportRecovery}
        onImport={(text) => {
          const loaded = deserialiseCampaign(text);
          if (loaded.state === null) setStatus(loaded.error ?? 'bad save');
          else restore(loaded.state, 'Save imported.', true);
        }}
        onRestart={() => {
          resetDebriefed();
          setDebriefed(0);
          let saved = campaignPersistenceStatus();
          let stored = false;
          const fresh = startFreshCampaign(catalog, CAMPAIGN_ID, createCampaignSeed, (next) => {
            const result = saveCampaign(next, { recover: true });
            saved = result.status;
            stored = result.ok;
          });
          setPrep(null);
          setRefitting(null);
          setSelectedNode(null);
          setSelectedTerms('standard');
          setState(fresh);
          setPersistence(saved);
          setStatus(
            stored
              ? `New campaign. Run ${fresh.seed}.`
              : `New campaign opened in memory. Run ${fresh.seed}.`,
          );
        }}
        onToggleManual={() => setManualOpen((open) => !open)}
        onExit={() => {
          const saved = saveCampaign(state);
          setPersistence(saved.status);
          if (!saved.ok) {
            setStatus('Campaign remains open while its save is memory-only.');
            return;
          }
          onExit();
        }}
      />

      {!manualOpen ? null : (
        <FieldManual lore={[...catalog.lore.values()]} onClose={() => setManualOpen(false)} />
      )}

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
        catalog={catalog}
        state={state}
        contract={state.contract}
        node={node}
        options={options}
        selectedTerms={selectedTerms}
        salvageRules={catalog.rules.salvage}
        readyMechs={lance.length}
        finished={state.finished}
        won={state.won}
        employer={employer}
        employers={employers}
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
      {state.contract !== null ? null : (
        <HiringHall
          catalog={catalog}
          campaign={campaign}
          day={state.day}
          offers={posted}
          employers={employers}
          selectedId={node?.id ?? null}
          onSelect={revealPosting}
        />
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

      {outcomeCount <= debriefed || pendingDebrief === undefined ? null : (
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
                candidates: record.salvageCandidates ?? [],
                chassisRecovered: record.salvagedChassis,
                hulls: [],
                offered: record.salvageOffered ?? [],
                items: record.salvagedItems,
                provenance: record.salvageProvenance ?? [],
              };
              rechooseSalvage(draft, report, picks);
              record.salvagedItems = report.items;
              return null;
            });
          }}
          onClose={() => {
            markDebriefed(outcomeCount);
            setDebriefed(outcomeCount);
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

  function currentEmployer(): EmployerHistory | null {
    const employerId = state.contract?.employerId ?? node?.employerId;
    if (employerId === undefined) return null;
    return (
      employers.find((record) => record.id === employerId) ?? {
        id: employerId,
        name: employerDisplayName(campaign, employerId, state.contract?.employerName),
        completed: 0,
        failed: 0,
        withdrawn: 0,
        expired: 0,
        paid: 0,
      }
    );
  }

  function onExportSave(): void {
    downloadCampaignFile(campaignBlob(state), `${state.campaignId}-day${state.day}.json`);
    setStatus('Save exported.');
  }

  function onExportRecovery(): void {
    if (persistence.recoveryRaw === null) return;
    downloadCampaignFile(rawCampaignBlob(persistence.recoveryRaw), 'ironline-campaign-recovery.txt');
    setStatus('Original save exported.');
  }
}
