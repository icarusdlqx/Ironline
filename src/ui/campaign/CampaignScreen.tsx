import { useEffect, useMemo, useState } from 'react';
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
import { isSideContract } from '../../campaign/sidework';
import { createCampaignSeed, startFreshCampaign } from '../../campaign/freshness';
import { campaignOutcomeCount } from '../../campaign/history';
import { assessSolvency, retireCompany } from '../../campaign/solvency';
import { employerHistories } from '../../campaign/employers';
import type { BayCommission } from '../mechbay/Mechbay';
import { CampaignHeader } from './CampaignHeader';
import { CampaignMap, type NodeState } from './CampaignMap';
import { CampaignPostBattle } from './CampaignPostBattle';
import { resolveCurrentEmployer } from './campaignEmployer';
import { visibleCampaignLore } from './campaignLore';
import { ContractPanel } from './ContractPanel';
import { CompanyStatus } from './CompanyStatus';
import { debriefedCount, resetDebriefed, revealLatestDebrief } from './Debrief';
import { FieldManual } from './FieldManual';
import { HiringHall } from './HiringHall';
import { BarracksPanel, cbills, MarketPanel, MechBayPanel, StoresPanel } from './Panels';
import { commitCampaignChange, openCampaignSession } from './campaignSession';
import { downloadCampaignFile } from './campaignDownload';
import { useGame } from '../store';
import { usePlaytest } from '../playtest';
import { CampaignGuide } from './CampaignGuide';
import { CampaignPrep } from './CampaignPrep';
import { firstDropStage, type FirstDropPrep } from './firstDropGuide';

const catalog = getCatalog();
const CAMPAIGN_ID = 'border_dispute';

export function CampaignScreen({ onExit }: { onExit: () => void }) {
  const [initial] = useState(() => openCampaignSession(catalog, CAMPAIGN_ID, resetDebriefed));
  const [state, setState] = useState<CampaignState>(initial.state);
  const [persistence, setPersistence] = useState(initial.persistence);
  const [manualOpen, setManualOpen] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(false);
  /**
   * Where the drop preparation stands: the hangar first, then the manifest.
   * Prep is a corridor, not a pop-up — campaign map → mechbay → deployment →
   * battle — so the bay stops being a side door most players never find.
   */
  const [prep, setPrep] = useState<FirstDropPrep>(null);
  const [refitting, setRefitting] = useState<string | null>(null);
  const [debriefed, setDebriefed] = useState(() => debriefedCount());
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedTerms, setSelectedTerms] = useState<ContractTermsId>('standard');
  const [status, setStatus] = useState<string | null>(null);
  const enterBattle = useGame((game) => game.enterBattle);
  const { record } = usePlaytest();

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
  const solvency = useMemo(() => assessSolvency(catalog, state), [state]);
  const outcomeCount = campaignOutcomeCount(state);
  const employer = resolveCurrentEmployer(campaign, state.contract, node, employers);
  const firstDrop = firstDropStage({
    outcomeCount,
    finished: state.finished,
    contractActive: state.contract !== null,
    prep,
  });
  const guidedFirstDrop = guideDismissed ? 'done' : firstDrop;

  useEffect(() => {
    record({ name: 'campaign_opened' });
  }, [record]);

  const refitMech = refitting === null ? null : (state.mechs.find((m) => m.id === refitting) ?? null);
  const refitBay: BayCommission | null =
    refitMech === null
      ? null
      : {
          title: refitMech.design.name,
          cancelLabel: prep === 'bay' ? 'Back to hangar' : 'Back to manifest',
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
    setPrep(null);
    setRefitting(null);
    setState(restored);
    setPersistence(saved.status);
    setStatus(saved.ok ? message : 'Campaign opened in memory; the save was not written.');
  };

  // Deploying walks the prep corridor rather than launching: the hangar for
  // repairs and refits first, then the manifest for who flies what.
  const onDeploy = (): void => {
    if (state.finished) {
      setStatus('This campaign is over.');
      return;
    }
    if (state.contract === null) {
      setStatus('Accept a contract first.');
      return;
    }
    record({ name: 'drop_prep_opened' });
    setPrep('bay');
  };

  const onLaunch = (): void => {
    if (state.finished) {
      setPrep(null);
      setRefitting(null);
      setStatus('This campaign is over.');
      return;
    }
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
    record({ name: 'contract_launched' });
    enterBattle({ campaignPending: true });
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
    <div
      className="camp"
      data-testid="campaign"
      data-first-drop-stage={guidedFirstDrop === 'done' ? undefined : guidedFirstDrop}
    >
      <CampaignHeader
        title={campaign.name}
        day={state.day}
        balance={cbills(state.cbills)}
        seed={state.seed}
        manualOpen={manualOpen}
        persistence={persistence}
        advanceDisabled={state.finished}
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
          setGuideDismissed(false);
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
        <FieldManual
          lore={visibleCampaignLore([...catalog.lore.values()], state.completedNodes)}
          onClose={() => setManualOpen(false)}
        />
      )}
      <CampaignGuide stage={guidedFirstDrop} onDismiss={() => setGuideDismissed(true)} />

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
        companyStatus={
          <CompanyStatus
            report={solvency}
            contractActive={state.contract !== null}
            onAdvance={(day) =>
              mutate((draft) => advanceDays(catalog, draft, day - draft.day))
            }
            onRetire={() =>
              mutate((draft) => {
                const result = retireCompany(catalog, draft);
                return result.ok ? 'Company retired. This campaign is over.' : result.reason;
              })
            }
          />
        }
        onSelectTerms={setSelectedTerms}
        onAccept={(termsId) => {
          let signed = false;
          mutate((draft) => {
            const result = acceptContract(catalog, draft, node?.id ?? '', termsId);
            signed = result.ok;
            return result.ok ? null : result.reason;
          }, 'Contract signed.');
          if (signed) {
            record({ name: 'contract_signed' });
            globalThis.requestAnimationFrame?.(() => {
              globalThis.document
                ?.querySelector<HTMLElement>('[data-testid="camp-deploy"]')
                ?.focus();
            });
          }
        }}
        onDeploy={onDeploy}
        onAbandon={() =>
          mutate(
            (draft) => draft.finished ? 'the campaign is over' : abandonContract(catalog, draft),
            'Contract withdrawn. Recovery terms applied.',
          )
        }
      />

      {state.finished || guidedFirstDrop !== 'done' ? null : (
        <>
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
        </>
      )}

      <CampaignPostBattle
        catalog={catalog}
        state={state}
        status={status}
        outcomeCount={outcomeCount}
        debriefed={debriefed}
        mutate={mutate}
        onDebriefed={setDebriefed}
      />

      <CampaignPrep
        catalog={catalog}
        state={state}
        prep={prep}
        refitting={refitting}
        refitBay={refitBay}
        mutate={mutate}
        onPrep={setPrep}
        onRefit={setRefitting}
        onManifest={() => record({ name: 'manifest_opened' })}
        onLaunch={onLaunch}
      />
    </div>
  );

  function advanceDay(): void {
    mutate((draft) => advanceDays(catalog, draft, 1));
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
