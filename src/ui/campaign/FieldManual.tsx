import { useEffect, useRef } from 'react';
import type { LoreEntry } from '../../schema/lore';
import './fieldManual.css';

interface Binding {
  input: string;
  action: string;
}

export const DESKTOP_BINDINGS: readonly Binding[] = [
  {
    input: 'Left click / drag',
    action:
      'Select a mech or box the lance. Shift-click toggles one mech; Shift-drag adds a box selection.',
  },
  {
    input: 'Right click',
    action:
      'Attack a hostile or walk to open ground. Hold Shift on ground to append a waypoint.',
  },
  {
    input: 'M / R / A',
    action:
      'Arm Move, Run, or Attack Move, then click a destination. Hold Shift to append it.',
  },
  {
    input: 'F / C / Q',
    action: 'Arm Attack or Called Shot, or target the nearest visible contact.',
  },
  {
    input: 'H / G / V / X / T / J',
    action: 'Hold Fire, Guard, pilot ability, alpha strike, heat safety, and jump.',
  },
  {
    input: '1–9',
    action: 'Recall a control group. Ctrl or Cmd+1–9 binds the current selection.',
  },
  {
    input: 'Weapon badge 1–4',
    action: 'Toggle that weapon group across the current selection.',
  },
  {
    input: 'E / Tab / Esc',
    action: 'Select the lance, cycle one mech, or cancel targeting and clear selection.',
  },
  {
    input: 'Space / , / . / P',
    action:
      'Pause or resume, lower or raise battle speed, or show performance. Orders work while paused.',
  },
  {
    input: 'Arrow keys / middle drag',
    action: 'Pan the map. The wheel zooms; clicking the minimap recentres the camera.',
  },
];

export const TOUCH_BINDINGS: readonly Binding[] = [
  {
    input: 'Tap a friendly',
    action: 'Select it. The lance cards along the bottom do the same job.',
  },
  {
    input: 'Tap ground / hostile',
    action: 'Move the selection or attack the hostile under the finger.',
  },
  {
    input: 'Tap a command',
    action: 'Arm it, then tap its destination or target. Queue keeps route orders armed.',
  },
  {
    input: 'All / Queue / Cancel',
    action: 'Select the lance, build a route across successive taps, or clear the armed order.',
  },
  {
    input: 'Drag / pinch',
    action: 'Drag the ground to pan and pinch to zoom. Tap the minimap to jump the camera.',
  },
  {
    input: 'Tap a weapon badge',
    action: 'Toggle that weapon group across the current selection.',
  },
  {
    input: 'Pause / speed buttons',
    action: 'Stop the clock or choose 1×, 2×, or 4×. Orders still work while paused.',
  },
  {
    input: 'Tap a support call',
    action:
      'Arm it, then tap the battlefield. For a strafing run, press and drag its heading.',
  },
];

const SUPPORT_NOTES: readonly Binding[] = [
  { input: 'Sensor Probe', action: 'Reveals a map region.' },
  {
    input: 'Air Strike',
    action:
      'Strafes a line. Press at the aim point and drag the run-in before releasing.',
  },
  { input: 'Repair Truck', action: 'Repairs armour near the point placed.' },
  { input: 'Reinforcement', action: 'Drops one unused mission reserve.' },
];

function BindingList({ entries }: { entries: readonly Binding[] }) {
  return (
    <dl className="manual-bindings">
      {entries.map((entry) => (
        <div key={entry.input}>
          <dt>{entry.input}</dt>
          <dd>{entry.action}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FieldManual({
  lore,
  onClose,
}: {
  lore: readonly LoreEntry[];
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable === undefined || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      priorFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="camp-manual"
      role="dialog"
      aria-modal="true"
      aria-labelledby="field-manual-title"
      data-testid="camp-manual"
    >
      <div className="manual-sheet" ref={sheetRef}>
        <header>
          <h3 id="field-manual-title">Field Manual</h3>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            data-testid="camp-manual-close"
          >
            Close
          </button>
        </header>

        <article className="manual-controls" data-testid="manual-controls">
          <h4>Controls</h4>
          <p className="manual-summary">
            Number keys recall control groups. Weapon groups use the numbered badges in the mech
            readout.
          </p>
          <div className="manual-control-columns">
            <section>
              <h5>Mouse and keyboard</h5>
              <BindingList entries={DESKTOP_BINDINGS} />
            </section>
            <section>
              <h5>Touch</h5>
              <BindingList entries={TOUCH_BINDINGS} />
            </section>
          </div>
          <section className="manual-support">
            <h5>Support calls</h5>
            <BindingList entries={SUPPORT_NOTES} />
          </section>
        </article>

        {[...lore]
          .sort((a, b) => a.order - b.order)
          .map((entry) => (
            <article key={entry.id}>
              <h4>{entry.title}</h4>
              <p className="manual-summary">{entry.summary}</p>
              {entry.body.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </article>
          ))}
      </div>
    </div>
  );
}
