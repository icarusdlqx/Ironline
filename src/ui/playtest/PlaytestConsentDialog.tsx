import { useRef } from 'react';
import { useDialogFocus } from '../useDialogFocus';

interface PlaytestConsentDialogProps {
  onEnable: () => void;
  onDecline: () => void;
}

export function PlaytestConsentDialog({
  onEnable,
  onDecline,
}: PlaytestConsentDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const enableRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialogRef, enableRef, onDecline);

  return (
    <div className="playtest-backdrop">
      <section
        className="playtest-dialog playtest-consent"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-consent-title"
        aria-describedby="playtest-consent-detail"
        data-testid="playtest-consent"
      >
        <h2 id="playtest-consent-title">Local playtest report</h2>
        <p id="playtest-consent-detail">
          This records a short list of progress markers in this browser. It does not
          record names, Battle codes, saves, logs, web addresses, or exact times.
          Nothing is uploaded automatically.
        </p>
        <div className="playtest-actions">
          <button
            type="button"
            ref={enableRef}
            onClick={onEnable}
            data-testid="playtest-consent-enable"
          >
            Begin local report
          </button>
          <button
            type="button"
            className="secondary"
            onClick={onDecline}
            data-testid="playtest-consent-decline"
          >
            Play without report
          </button>
        </div>
      </section>
    </div>
  );
}
