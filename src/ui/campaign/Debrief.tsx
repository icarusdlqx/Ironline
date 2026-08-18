import type { Catalog } from '../../schema/load';
import { useState } from 'react';
import { termsName } from '../../campaign/contractTerms';
import { storeItemValueOf } from '../../campaign/market';
import { SALVAGE_PICKS } from '../../campaign/salvage';
import { employerHistoryFor } from '../../campaign/employers';
import type {
  CampaignState,
  MissionOutcome,
  SalvageCandidate,
  SalvageOutcome,
  SalvageProvenance,
  StoreItem,
} from '../../campaign/types';
import { salvageItemFacts } from './salvageFacts';
import './salvage.css';

const DEBRIEFED_KEY = 'ironline.campaign.debriefed';

/** How many missions the player has already been shown a debrief for. */
export function debriefedCount(): number {
  const raw = globalThis.localStorage?.getItem(DEBRIEFED_KEY);
  const value = raw === null || raw === undefined ? 0 : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function markDebriefed(count: number): void {
  globalThis.localStorage?.setItem(DEBRIEFED_KEY, String(count));
}

export function resetDebriefed(): void {
  globalThis.localStorage?.removeItem(DEBRIEFED_KEY);
}

/** Restored campaigns show their latest report once, never an earlier run's place. */
export function revealLatestDebrief(historyLength: number): number {
  const count = Math.max(0, historyLength - 1);
  markDebriefed(count);
  return count;
}

function cbills(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

const OUTCOME_NAMES: Record<SalvageOutcome, string> = {
  centre_torso: 'Centre torso destroyed',
  head: 'Head destroyed',
  ammo_explosion: 'Ammo explosion',
  legged: 'Both legs destroyed; side defeated',
  ejected: 'Pilot ejected',
};

const LOCATION_NAMES: Record<SalvageProvenance['location'], string> = {
  head: 'head',
  centre_torso: 'centre torso',
  left_torso: 'left torso',
  right_torso: 'right torso',
  left_arm: 'left arm',
  right_arm: 'right arm',
  left_leg: 'left leg',
  right_leg: 'right leg',
};

function chance(value: number): string {
  return `${Number((value * 100).toFixed(1))}%`;
}

function sourceName(catalog: Catalog, source: SalvageProvenance): string {
  const designName = catalog.designs.get(source.sourceDesignId)?.name;
  const mech =
    designName === undefined || designName === source.sourceMechName
      ? source.sourceMechName
      : `${source.sourceMechName} / ${designName}`;
  return `${mech}, ${LOCATION_NAMES[source.location]}`;
}

function candidateName(catalog: Catalog, candidate: SalvageCandidate): string {
  return candidate.name || catalog.designs.get(candidate.designId)?.name || candidate.designId;
}

/**
 * The debrief. A pilot's whole career happened in a scrolling log before this:
 * they gained experience, they were promoted, and the only trace was a line
 * that had already been pushed off the bottom by the salvage report.
 */
export function Debrief({
  catalog,
  state,
  outcome,
  onClose,
  onChooseSalvage,
}: {
  catalog: Catalog;
  state: CampaignState;
  outcome: MissionOutcome;
  onClose: () => void;
  /** Swaps what came home for a different pick out of the same offer. */
  onChooseSalvage?: (picks: StoreItem[]) => void;
}) {
  const mission = catalog.missions.get(outcome.missionId);
  const campaign = catalog.campaigns.get(state.campaignId);
  const employer =
    campaign === undefined
      ? null
      : employerHistoryFor(
          campaign,
          state.history,
          outcome.employerId,
          outcome.employerName,
          state.employerFailures,
        );
  const offered = outcome.salvageOffered ?? [];
  const candidates = outcome.salvageCandidates ?? [];
  const provenance = outcome.salvageProvenance ?? [];
  const [picks, setPicks] = useState<string[]>(() =>
    outcome.salvagedItems.map((item) => `${item.kind}:${item.itemId}`),
  );
  const selectedValue = offered
    .filter((item) => picks.includes(`${item.kind}:${item.itemId}`))
    .reduce((total, item) => total + storeItemValueOf(catalog, item), 0);

  const toggle = (key: string): void => {
    const next = picks.includes(key)
      ? picks.filter((held) => held !== key)
      : [...picks, key].slice(-SALVAGE_PICKS);
    setPicks(next);
    onChooseSalvage?.(
      next
        .map((entry) => offered.find((item) => `${item.kind}:${item.itemId}` === entry))
        .filter((item): item is StoreItem => item !== undefined),
    );
  };

  return (
    <div className="manifest-backdrop" data-testid="debrief">
      <section className="manifest debrief">
        <header>
          <h3>
            {outcome.won ? 'Contract complete' : 'Contract failed'} — {mission?.name ?? outcome.missionId}
          </h3>
          <p>
            {termsName(outcome.termsId)} · Day {outcome.day}.{' '}
            {outcome.won ? `${cbills(outcome.payout)} paid.` : 'No payment.'}
            {outcome.salvagedItems.length + outcome.salvagedChassis.length > 0
              ? ` ${outcome.salvagedChassis.length} hull(s) and ${outcome.salvagedItems.length} crate(s) recovered.`
              : ''}
          </p>
          {employer === null ? null : (
            <p className="employer-facts" data-testid="debrief-employer">
              <strong>{employer.name}</strong> · {employer.completed} completed ·{' '}
              {employer.failed} failed · {cbills(employer.paid)} paid
            </p>
          )}
        </header>

        {candidates.length === 0 ? null : (
          <div className="debrief-recovery" data-testid="debrief-recovery">
            <h4>Field recovery ledger</h4>
            <p>
              Eligible hull odds include the signed package. Ineligible hulls remain on the record without a roll.
            </p>
            <ul>
              {candidates.map((candidate, index) => (
                <li
                  key={`${candidate.designId}-${candidate.name}-${index}`}
                  data-testid={`debrief-recovery-${index}`}
                >
                  <span className="recovery-name">{candidateName(catalog, candidate)}</span>
                  <span className="recovery-outcome">{OUTCOME_NAMES[candidate.outcome]}</span>
                  <span className="recovery-chance">{chance(candidate.chassisChance)}</span>
                  <span className={candidate.recovered ? 'recovery-result recovered' : 'recovery-result'}>
                    {candidate.recovered
                      ? 'hull recovered'
                      : candidate.chassisChance > 0
                        ? 'not recovered'
                        : 'not eligible'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {offered.length === 0 ? null : (
          <div className="debrief-salvage" data-testid="debrief-salvage">
            <h4>
              Salvage — {picks.length}/{SALVAGE_PICKS} picks · {cbills(selectedValue)} build value
            </h4>
            <p className="salvage-note">
              Choose what comes home; one pick takes the full listed crate. Loose crates cannot be
              sold. Mounted sale basis is what a part adds to an intact mech's yard valuation.
            </p>
            <ul className="salvage-offer">
              {offered.map((item) => {
                const key = `${item.kind}:${item.itemId}`;
                const taken = picks.includes(key);
                const takenCount =
                  outcome.salvagedItems.find(
                    (held) => held.kind === item.kind && held.itemId === item.itemId,
                  )?.count ?? 0;
                const facts = salvageItemFacts(catalog, state, item, takenCount);
                const sources = provenance.filter(
                  (source) => source.kind === item.kind && source.itemId === item.itemId,
                );
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={taken ? 'taken' : ''}
                      onClick={() => toggle(key)}
                      aria-pressed={taken}
                      data-testid={`salvage-pick-${item.itemId}`}
                    >
                      <span className="salvage-name">
                        {facts.name} {item.count > 1 ? `× ${item.count}` : ''}
                      </span>
                      <span className="salvage-kind">{facts.kind}</span>
                      <span className="salvage-mark">{taken ? 'aboard' : 'left'}</span>
                      <span className="salvage-spec">{facts.specification}</span>
                      <span className="salvage-fit">{facts.fit}</span>
                      <span className="salvage-owned">Owned before this haul: {facts.ownedBefore}</span>
                      {sources.length === 0 ? null : (
                        <span className="salvage-source">
                          Field source: {sources.map((source) => sourceName(catalog, source)).join('; ')}
                        </span>
                      )}
                      <span className="salvage-value">
                        {cbills(facts.buildValue)} build · {cbills(facts.saleBasis)} mounted sale basis
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {outcome.pilotReports.length === 0 ? (
          <p className="empty">No crew records for this drop.</p>
        ) : (
          <ul className="manifest-list">
            {outcome.pilotReports.map((report) => (
              <li
                key={report.pilotId}
                className={`manifest-row${report.fate === 'killed' ? ' unfit' : ''}`}
                data-testid={`debrief-${report.pilotId}`}
              >
                <div className="manifest-pilot">
                  <span className="pilot-name">{report.name}</span>
                  <small className="manifest-status">{report.mech}</small>
                </div>

                <dl className="manifest-skills">
                  <div>
                    <dt>Fought</dt>
                    <dd>
                      {report.kills} kill{report.kills === 1 ? '' : 's'} · {report.damage} damage
                    </dd>
                  </div>
                  <div>
                    <dt>Earned</dt>
                    <dd>
                      +{report.xp} XP
                      {report.xpBanked === null ? '' : ` · ${report.xpBanked} banked`}
                    </dd>
                  </div>
                  <div>
                    <dt>Training</dt>
                    <dd>
                      {report.promotions.length > 0
                        ? report.promotions.join(', ')
                        : report.fate === 'killed'
                          ? 'record closed'
                          : 'choose in barracks'}
                    </dd>
                  </div>
                </dl>

                <div className="manifest-mech">
                  <span
                    className={`debrief-fate ${report.fate}`}
                    data-testid={`debrief-fate-${report.pilotId}`}
                  >
                    {report.fate === 'killed'
                      ? 'Killed in action'
                      : report.fate === 'injured'
                        ? 'Wounded'
                        : 'Returned'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {outcome.mechsLost.length === 0 ? null : (
          <p className="debrief-losses">Lost: {outcome.mechsLost.join(', ')}.</p>
        )}

        <footer className="manifest-actions">
          <button type="button" onClick={onClose} data-testid="debrief-close">
            Back to base
          </button>
        </footer>
      </section>
    </div>
  );
}
