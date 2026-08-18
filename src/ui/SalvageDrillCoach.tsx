import { useState } from 'react';
import { useGame } from './store';
import { salvageDrillProgress, type DrillLegState } from './salvageDrill';
import { useCompactLayout } from './useCompactLayout';
import './salvageDrill.css';

function legLabel(side: 'LL' | 'RL', state: DrillLegState) {
  const condition = state === 'lost' ? 'lost' : state === 'intact' ? 'intact' : 'unknown';
  return (
    <span className={`salvage-leg ${state}`}>
      <b>{side}</b> {condition}
    </span>
  );
}

export function SalvageDrillCoach() {
  const state = useGame();
  const compact = useCompactLayout();
  const [open, setOpen] = useState(true);
  const progress = salvageDrillProgress(state.enemies);

  if (!state.briefingSeen || state.finished) return null;

  const body = (
    <>
      <strong>{progress.targetName}</strong>
      <span className="salvage-target-state">{progress.status}</span>
      <div className="salvage-leg-progress" aria-label="Range target leg condition">
        {legLabel('LL', progress.leftLeg)}
        {legLabel('RL', progress.rightLeg)}
      </div>
      <p>{progress.instruction}</p>
    </>
  );

  if (compact) {
    return (
      <details
        className="training-coach salvage-coach mobile-training"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        data-testid="salvage-drill-coach"
        aria-live="polite"
      >
        <summary>
          Salvage drill <strong>{progress.legsLost === null ? '—' : `${progress.legsLost} / 2`}</strong>
        </summary>
        <div className="salvage-coach-body">{body}</div>
      </details>
    );
  }

  return (
    <section
      className="training-coach salvage-coach"
      data-testid="salvage-drill-coach"
      aria-live="polite"
    >
      <span className="training-kicker">Field exercise · two legs + field win</span>
      {body}
    </section>
  );
}
