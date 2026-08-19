import { useRef } from 'react';
import type { LoreEntry } from '../../schema/lore';
import { useCompactLayout } from '../useCompactLayout';
import { useDialogFocus } from '../useDialogFocus';
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
    input: 'End shape',
    action:
      'Auto, Line, Column, Wedge, or Box spreads a group at its destination. Mechs route independently and do not hold the shape while moving.',
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
    input: 'Arrow keys / middle drag / Centre',
    action:
      'Pan the map or centre the selection. The wheel zooms under the pointer; clicking the minimap jumps the camera.',
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
    input: 'End shape',
    action:
      'Chooses the group shape at the tapped destination. It is not maintained while the mechs move.',
  },
  {
    input: 'All / Queue / Cancel',
    action: 'Select the lance, build a route across successive taps, or clear the armed order.',
  },
  {
    input: 'Drag / pinch / Centre',
    action:
      'Drag the ground, pinch around the fingers, or centre the selection. Tap the minimap to jump the camera.',
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

interface ControlSection {
  id: 'desktop' | 'touch';
  heading: string;
  entries: readonly Binding[];
}

const DESKTOP_SECTION: ControlSection = {
  id: 'desktop',
  heading: 'Mouse and keyboard',
  entries: DESKTOP_BINDINGS,
};

const TOUCH_SECTION: ControlSection = {
  id: 'touch',
  heading: 'Touch',
  entries: TOUCH_BINDINGS,
};

export function manualControlSections(compact: boolean): readonly ControlSection[] {
  return compact ? [TOUCH_SECTION, DESKTOP_SECTION] : [DESKTOP_SECTION, TOUCH_SECTION];
}

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
  const compact = useCompactLayout();
  useDialogFocus(sheetRef, closeRef, onClose);

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
            {manualControlSections(compact).map((section) => (
              <section key={section.id} data-testid={`manual-${section.id}-controls`}>
                <h5>{section.heading}</h5>
                <BindingList entries={section.entries} />
              </section>
            ))}
          </div>
          <section className="manual-support">
            <h5>Support calls</h5>
            <BindingList entries={SUPPORT_NOTES} />
          </section>
          <section className="manual-support" data-testid="manual-battle-codes">
            <h5>Battle codes</h5>
            <p className="manual-summary">
              The same skirmish mission, difficulty, lance, and Battle code reproduce the opening
              field and its random rolls. Orders still decide what follows. Campaign run codes are
              separate and reproduce the company board as well as its contracts.
            </p>
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
