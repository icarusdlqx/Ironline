import { useRef, useState, useSyncExternalStore } from 'react';
import { useDialogFocus } from '../useDialogFocus';
import { downloadPlaytestReport } from './download';
import type { PlaytestJournal } from './journal';
import {
  ConfusionAreaSchema,
  type ConfusionArea,
  type ContinueIntent,
  type PerformanceRead,
  type PlaytestSurvey,
  type Rating,
} from './schema';
import { MAX_PLAYTEST_NOTE_LENGTH, sanitisePlaytestNote } from './sanitise';
import './playtest.css';

interface FeedbackDialogProps {
  journal: PlaytestJournal;
  onClose: () => void;
}

const CONFUSION_LABELS: Record<ConfusionArea, string> = {
  front_door: 'Choosing where to start',
  briefing: 'Reading the briefing',
  select: 'Selecting a mech',
  move: 'Moving the lance',
  attack: 'Attacking a contact',
  heat: 'Understanding heat',
  camera: 'Moving the camera',
  campaign: 'Choosing a contract',
  mechbay: 'Using the mechbay',
};

const PERFORMANCE_OPTIONS: readonly { value: PerformanceRead; label: string }[] = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'minor_stutter', label: 'Minor stutter' },
  { value: 'frequent_stutter', label: 'Frequent stutter' },
  { value: 'unplayable', label: 'Unplayable' },
];

const CONTINUE_OPTIONS: readonly { value: ContinueIntent; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
];

function RatingField({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: Rating | null;
  onChange: (rating: Rating) => void;
}) {
  return (
    <fieldset className="playtest-rating">
      <legend>{legend}</legend>
      <span className="playtest-scale-label">Low</span>
      {[1, 2, 3, 4, 5].map((rating) => (
        <label key={rating}>
          <input
            type="radio"
            name={legend}
            value={rating}
            checked={value === rating}
            onChange={() => onChange(rating as Rating)}
          />
          <span>{rating}</span>
        </label>
      ))}
      <span className="playtest-scale-label">High</span>
    </fieldset>
  );
}

function ChoiceField<Value extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: Value | null;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <fieldset className="playtest-choices">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={legend}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function surveyOf(journal: PlaytestJournal): PlaytestSurvey | null {
  return journal.getSnapshot().report?.survey ?? null;
}

export function FeedbackDialog({ journal, onClose }: FeedbackDialogProps) {
  const snapshot = useSyncExternalStore(
    journal.subscribe,
    journal.getSnapshot,
    journal.getSnapshot,
  );
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  useDialogFocus(dialogRef, closeRef, onClose);
  const retainDialogFocus = (): void => {
    globalThis.requestAnimationFrame?.(() => closeRef.current?.focus());
  };

  const survey = snapshot.report?.survey ?? null;
  const safeNote = sanitisePlaytestNote(note);
  const update = (patch: Partial<PlaytestSurvey>): void => {
    journal.updateSurvey(patch);
  };
  const toggleConfusion = (area: ConfusionArea): void => {
    const current = surveyOf(journal)?.confusion ?? [];
    const next = current.includes(area)
      ? current.filter((entry) => entry !== area)
      : [...current, area];
    update({ confusion: next });
  };
  const copy = (): void => {
    const text = journal.serialiseExport(note);
    if (text === null) return;
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard === undefined) {
      setCopyFallback(text);
      setStatus('Clipboard unavailable. Copy the report from the field below.');
      return;
    }
    void clipboard.writeText(text).then(
      () => {
        setCopyFallback(null);
        setStatus('Report copied.');
      },
      () => {
        setCopyFallback(text);
        setStatus('Clipboard refused access. Copy the report from the field below.');
      },
    );
  };

  return (
    <div className="playtest-backdrop">
      <section
        className="playtest-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-feedback-title"
        aria-describedby="playtest-feedback-privacy"
        data-testid="playtest-feedback"
      >
        <header>
          <div>
            <span className="playtest-kicker">Field report</span>
            <h2 id="playtest-feedback-title">What was clear?</h2>
          </div>
          <button type="button" ref={closeRef} onClick={onClose} data-testid="playtest-close">
            Close
          </button>
        </header>

        <p id="playtest-feedback-privacy" className="playtest-privacy">
          This report stays in this browser until you copy or download it. Nothing is
          sent automatically. Do not include a name or contact details in the note.
        </p>

        {!snapshot.enabled ? (
          <section className="playtest-enable">
            {snapshot.issue === 'invalid-report' ? (
              <>
                <p>
                  The stored report could not be read. It has not been overwritten.
                </p>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    const removed = journal.clear();
                    setStatus(
                      removed
                        ? 'Damaged local report discarded.'
                        : 'Browser storage did not confirm deletion.',
                    );
                    retainDialogFocus();
                  }}
                  data-testid="playtest-reset-invalid"
                >
                  Discard damaged report
                </button>
              </>
            ) : (
              <>
                <p>No local report is active.</p>
                <button
                  type="button"
                  onClick={() => {
                    journal.enable();
                    setStatus('Local report enabled.');
                    retainDialogFocus();
                  }}
                  data-testid="playtest-enable"
                >
                  Enable local report
                </button>
              </>
            )}
          </section>
        ) : (
          <>
            {snapshot.persistence === 'memory-only' ? (
              <p className="playtest-warning" role="status" data-testid="playtest-memory-only">
                Browser storage is unavailable or could not be read. This report lasts
                only until the page closes; download it before leaving.
              </p>
            ) : null}

            <RatingField
              legend="How clear was what to do next?"
              value={survey?.clarity ?? null}
              onChange={(clarity) => update({ clarity })}
            />
            <RatingField
              legend="How readable was the fight?"
              value={survey?.combatReadability ?? null}
              onChange={(combatReadability) => update({ combatReadability })}
            />
            <ChoiceField
              legend="How did the game run?"
              value={survey?.performance ?? null}
              options={PERFORMANCE_OPTIONS}
              onChange={(performance) => update({ performance })}
            />
            <ChoiceField
              legend="Would you continue the campaign?"
              value={survey?.continueIntent ?? null}
              options={CONTINUE_OPTIONS}
              onChange={(continueIntent) => update({ continueIntent })}
            />

            <fieldset className="playtest-confusion">
              <legend>Where did you get stuck?</legend>
              {ConfusionAreaSchema.options.map((area) => (
                <label key={area}>
                  <input
                    type="checkbox"
                    checked={survey?.confusion.includes(area) ?? false}
                    onChange={() => toggleConfusion(area)}
                  />
                  <span>{CONFUSION_LABELS[area]}</span>
                </label>
              ))}
            </fieldset>

            <label className="playtest-note">
              <span>Optional note</span>
              <textarea
                value={note}
                maxLength={MAX_PLAYTEST_NOTE_LENGTH}
                rows={4}
                onChange={(event) => setNote(event.target.value)}
                data-testid="playtest-note"
              />
            </label>
            {note === '' ? null : (
              <div className="playtest-note-preview" data-testid="playtest-note-preview">
                <span>Sanitised in the report</span>
                <p>{safeNote || 'The note contains no exportable text.'}</p>
              </div>
            )}

            <div className="playtest-actions">
              <button
                type="button"
                onClick={() => {
                  if (downloadPlaytestReport(journal, note)) setStatus('Report downloaded.');
                }}
                data-testid="playtest-download"
              >
                Download report
              </button>
              <button type="button" onClick={copy} data-testid="playtest-copy">
                Copy report
              </button>
              <button
                type="button"
                className={confirmClear ? 'danger' : 'secondary'}
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true);
                    return;
                  }
                  const removed = journal.clear();
                  setConfirmClear(false);
                  setStatus(
                    removed
                      ? 'Local report cleared.'
                      : 'The session copy was cleared, but browser storage did not confirm deletion.',
                  );
                  retainDialogFocus();
                }}
                data-testid={confirmClear ? 'playtest-clear-confirm' : 'playtest-clear'}
              >
                {confirmClear ? 'Confirm clear' : 'Clear local report'}
              </button>
            </div>

            {copyFallback === null ? null : (
              <label className="playtest-copy-fallback">
                <span>Copy this report</span>
                <textarea
                  readOnly
                  rows={8}
                  value={copyFallback}
                  onFocus={(event) => event.currentTarget.select()}
                  data-testid="playtest-copy-fallback"
                />
              </label>
            )}
          </>
        )}

        {status === null ? null : (
          <p className="playtest-status" role="status" data-testid="playtest-status">
            {status}
          </p>
        )}
      </section>
    </div>
  );
}
