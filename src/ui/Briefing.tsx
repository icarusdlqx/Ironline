import type { ReactNode } from 'react';
import { getCatalog } from '../schema/load';
import { PilotStats, type RateablePilot } from './PilotStats';
import type { ObjectiveView } from './store';

export interface BriefingBerth {
  index: number;
  designValue: string;
  customLabel: string | null;
  pilotId: string;
  tonnage: number;
  pilot: RateablePilot | null;
}

export interface BriefingLance {
  berths: BriefingBerth[];
  designs: { value: string; label: string; tonnage: number }[];
  saved: { value: string; label: string }[];
  pilots: { id: string; name: string }[];
  total: number;
  allowance: number;
  onDesign: (index: number, value: string) => void;
  onPilot: (index: number, pilotId: string) => void;
  onCustomise: (index: number) => void;
}

interface BriefingProps {
  name: string;
  text: string;
  objectives: readonly ObjectiveView[];
  resourcePoints: number;
  setup?: ReactNode;
  /** Contracts prepare their lance elsewhere, so no editor is passed here. */
  lance?: BriefingLance;
  deployDisabled?: boolean;
  deployReason?: string | null;
  onDeploy: () => void;
}

export function Briefing({
  name,
  text,
  objectives,
  resourcePoints,
  setup,
  lance,
  deployDisabled = false,
  deployReason = null,
  onDeploy,
}: BriefingProps) {
  const over = lance !== undefined && lance.total > lance.allowance;
  const blocked = over || deployDisabled;
  const reason = over
    ? 'The lance is over the drop tonnage — lighten it first.'
    : deployReason ?? undefined;
  const taken = (pilotId: string): number =>
    lance === undefined ? 0 : lance.berths.filter((berth) => berth.pilotId === pilotId).length;

  return (
    <div className="briefing" data-testid="briefing">
      <h2>{name}</h2>
      <p>{text}</p>
      <h4>Objectives</h4>
      <ul>
        {objectives.map((objective) => (
          <li key={objective.id}>
            {objective.label}
            {objective.required ? '' : ' (optional)'}
          </li>
        ))}
      </ul>

      {setup}

      {lance === undefined ? null : (
        <div className="briefing-lance" data-testid="briefing-lance">
          <h4>
            Lance
            <span
              className={`briefing-tonnage${over ? ' over' : ''}`}
              data-testid="briefing-tonnage"
            >
              {lance.total}/{lance.allowance}t
            </span>
          </h4>
          {lance.berths.map((berth) => (
            <div className="briefing-berth" key={berth.index}>
              <select
                value={berth.designValue}
                onChange={(event) => lance.onDesign(berth.index, event.target.value)}
                data-testid={`berth-design-${berth.index}`}
                aria-label={`Mech for berth ${berth.index + 1}`}
              >
                {berth.customLabel === null ? null : (
                  <option value="custom">{berth.customLabel} (custom)</option>
                )}
                <option value="empty">— empty berth —</option>
                {lance.designs.map((design) => (
                  <option key={design.value} value={design.value}>
                    {design.label} — {design.tonnage}t
                  </option>
                ))}
                {lance.saved.length === 0 ? null : (
                  <optgroup label="Saved builds">
                    {lance.saved.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <select
                value={berth.pilotId}
                onChange={(event) => lance.onPilot(berth.index, event.target.value)}
                data-testid={`berth-pilot-${berth.index}`}
                aria-label={`Pilot for berth ${berth.index + 1}`}
              >
                {lance.pilots.map((pilot) => (
                  <option
                    key={pilot.id}
                    value={pilot.id}
                    disabled={pilot.id !== berth.pilotId && taken(pilot.id) > 0}
                  >
                    {pilot.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => lance.onCustomise(berth.index)}
                title="Open the bay on this machine"
                data-testid={`berth-customise-${berth.index}`}
              >
                Customise
              </button>
              {berth.pilot === null ? null : (
                <PilotStats catalog={getCatalog()} pilot={berth.pilot} compact />
              )}
            </div>
          ))}
        </div>
      )}

      <footer className="briefing-actions" data-testid="briefing-actions">
        <p className="briefing-rp">{resourcePoints} Resource Points on the books.</p>
        <button
          type="button"
          onClick={onDeploy}
          disabled={blocked}
          title={reason}
          data-testid="briefing-deploy"
        >
          {over ? 'Over tonnage' : 'Deploy'}
        </button>
      </footer>
    </div>
  );
}
