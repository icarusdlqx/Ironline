import type { Catalog } from '../../schema/load';
import { useState } from 'react';
import { SALVAGE_PICKS } from '../../campaign/salvage';
import type { StoreItem } from '../../campaign/types';
import type { MissionOutcome } from '../../campaign/types';

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

/**
 * The debrief. A pilot's whole career happened in a scrolling log before this:
 * they gained experience, they were promoted, and the only trace was a line
 * that had already been pushed off the bottom by the salvage report.
 */
export function Debrief({
  catalog,
  outcome,
  onClose,
  onChooseSalvage,
}: {
  catalog: Catalog;
  outcome: MissionOutcome;
  onClose: () => void;
  /** Swaps what came home for a different pick out of the same offer. */
  onChooseSalvage?: (picks: StoreItem[]) => void;
}) {
  const mission = catalog.missions.get(outcome.missionId);
  const offered = outcome.salvageOffered ?? [];
  const [picks, setPicks] = useState<string[]>(() =>
    outcome.salvagedItems.map((item) => `${item.kind}:${item.itemId}`),
  );

  const nameOf = (item: StoreItem): string =>
    (item.kind === 'weapon'
      ? catalog.weapons.get(item.itemId)?.name
      : catalog.equipment.get(item.itemId)?.name) ?? item.itemId;

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
            Day {outcome.day}. {outcome.won ? `${cbills(outcome.payout)} paid.` : 'No payment.'}
            {outcome.salvagedItems.length + outcome.salvagedChassis.length > 0
              ? ` ${outcome.salvagedChassis.length} hull(s) and ${outcome.salvagedItems.length} crate(s) recovered.`
              : ''}
          </p>
        </header>

        {offered.length === 0 ? null : (
          <div className="debrief-salvage" data-testid="debrief-salvage">
            <h4>
              Salvage — the hold takes {SALVAGE_PICKS} ({picks.length}/{SALVAGE_PICKS} chosen)
            </h4>
            <p className="salvage-note">
              The crews cut loose more than the dropship will carry. Choose what comes home.
            </p>
            <ul className="salvage-offer">
              {offered.map((item) => {
                const key = `${item.kind}:${item.itemId}`;
                const taken = picks.includes(key);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={taken ? 'taken' : ''}
                      onClick={() => toggle(key)}
                      data-testid={`salvage-pick-${item.itemId}`}
                    >
                      <span className="salvage-name">{nameOf(item)}</span>
                      <span className="salvage-kind">{item.kind}</span>
                      <span className="salvage-mark">{taken ? 'aboard' : 'left'}</span>
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
                    <dd>{report.xp} XP</dd>
                  </div>
                  <div>
                    <dt>Raised</dt>
                    <dd>{report.promotions.length === 0 ? '—' : report.promotions.join(', ')}</dd>
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
