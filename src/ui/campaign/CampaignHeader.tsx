import type { CampaignPersistenceState } from '../../campaign/save';
import { usePlaytest } from '../playtest';
import { CampaignRecoveryNotice } from './CampaignRecoveryNotice';

export interface CampaignHeaderProps {
  title: string;
  day: number;
  balance: string;
  seed: string;
  manualOpen: boolean;
  persistence: CampaignPersistenceState;
  advanceDisabled: boolean;
  onAdvance: () => void;
  onSave: () => void;
  onLoad: () => void;
  onExport: () => void;
  onExportRecovery: () => void;
  onImport: (text: string) => void;
  onRestart: () => void;
  onToggleManual: () => void;
  onExit: () => void;
}

export function CampaignHeader({
  title,
  day,
  balance,
  seed,
  manualOpen,
  persistence,
  advanceDisabled,
  onAdvance,
  onSave,
  onLoad,
  onExport,
  onExportRecovery,
  onImport,
  onRestart,
  onToggleManual,
  onExit,
}: CampaignHeaderProps) {
  const { openFeedback } = usePlaytest();
  return (
    <header className="camp-top">
      <div className="camp-title">
        <h2>{title}</h2>
        <span
          className="camp-seed"
          data-testid="camp-seed"
          title="This code reproduces the campaign board and battles."
        >
          Run {seed}
        </span>
      </div>
      <span data-testid="camp-day">Day {day}</span>
      <span data-testid="camp-cbills">{balance}</span>
      <button
        type="button"
        onClick={onAdvance}
        disabled={advanceDisabled}
        data-testid="camp-advance"
      >
        Advance a day
      </button>
      <button type="button" onClick={onSave} data-testid="camp-save">
        Save
      </button>
      <button type="button" onClick={onLoad} data-testid="camp-load">
        Load
      </button>
      <button type="button" onClick={onExport} data-testid="camp-export">
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
            void file.text().then(onImport);
          }}
        />
      </label>
      <button type="button" onClick={onRestart} data-testid="camp-restart">
        Restart
      </button>
      <button type="button" onClick={onToggleManual} data-testid="camp-manual-toggle">
        {manualOpen ? 'Close Manual' : 'Field Manual'}
      </button>
      <button type="button" onClick={onExit} data-testid="camp-exit">
        Home
      </button>
      <button
        type="button"
        className="pause feedback-link"
        onClick={openFeedback}
        title="Something broken, unfair, or missing? Tell the builders."
        data-testid="feedback-link"
      >
        Feedback
      </button>
      <CampaignRecoveryNotice
        persistence={persistence}
        onExportOriginal={onExportRecovery}
      />
    </header>
  );
}
