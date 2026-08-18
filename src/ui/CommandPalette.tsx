import { actionStatus } from './combatTelemetry';
import type { OrderMode, TimedActionSnapshot } from './store';

export interface Command {
  id: string;
  label: string;
  key: string;
  mode: OrderMode;
  disabled?: boolean;
  title?: string;
}

export const COMMANDS: readonly Command[] = [
  { id: 'move', label: 'Move', key: 'M', mode: 'move' },
  { id: 'run', label: 'Run', key: 'R', mode: 'run' },
  {
    id: 'attack_move',
    label: 'Attack Move',
    key: 'A',
    mode: 'attack_move',
    title: 'Advance to a point, stopping to fight whatever shows itself (A)',
  },
  { id: 'attack', label: 'Attack', key: 'F', mode: 'attack' },
  { id: 'called_shot', label: 'Called Shot', key: 'C', mode: 'called_shot' },
  { id: 'hold_fire', label: 'Hold Fire', key: 'H', mode: null },
  {
    id: 'hold_position',
    label: 'Guard',
    key: 'G',
    mode: null,
    title: 'Hold this ground and engage at will. Press again to release (G)',
  },
  {
    id: 'ability',
    label: 'Ability',
    key: 'V',
    mode: null,
    title: "Call on the pilot's speciality (V)",
  },
  {
    id: 'alpha_strike',
    label: 'Alpha Strike',
    key: 'X',
    mode: null,
    title: 'Fire everything at once and accept the heat. This is how mechs shut down (X)',
  },
  {
    id: 'heat_safety',
    label: 'Stay Cool',
    key: 'T',
    mode: null,
    title: 'Shed the hottest guns rather than risk a shutdown. Off means weapons free (T)',
  },
  {
    id: 'jump',
    label: 'Jump',
    key: 'J',
    mode: 'jump',
    title: 'Fire the jets at a point inside their reach — heat now, cooldown after (J)',
  },
];

interface Props {
  orderMode: OrderMode;
  enabled: boolean;
  holdingFire: boolean;
  heatSafety: boolean;
  ability: TimedActionSnapshot | null;
  alpha: TimedActionSnapshot | null;
  /** Jets aboard, charged and free to fire. Null when nothing is selected. */
  jump: { ready: boolean; range: number; cooldown: number } | null;
  /** The standing order the selected mech is following. */
  posture: string;
  onCommand: (command: Command) => void;
}

function jumpTitle(jump: Props['jump']): string {
  if (jump === null || jump.range <= 0) return 'This mech has no jump jets';
  if (jump.cooldown > 0) return `Jets recharging — ${jump.cooldown.toFixed(1)}s`;
  if (!jump.ready) return 'The jets cannot fire right now';
  return `Fire the jets up to ${Math.round(jump.range)}m — heat now, cooldown after (J)`;
}

export function CommandPalette({
  orderMode,
  enabled,
  holdingFire,
  heatSafety,
  ability,
  alpha,
  jump,
  posture,
  onCommand,
}: Props) {
  return (
    <div className="palette" data-testid="command-palette">
      {COMMANDS.map((command) => {
        const timed =
          command.id === 'ability' ? ability : command.id === 'alpha_strike' ? alpha : null;
        const active =
          (command.mode !== null && command.mode === orderMode) ||
          (command.id === 'hold_fire' && holdingFire) ||
          (command.id === 'heat_safety' && heatSafety) ||
          (timed?.activeRemaining ?? 0) > 0 ||
          command.id === posture;

        const isJump = command.id === 'jump';
        const disabled = command.disabled === true || !enabled || (isJump && jump?.ready !== true);
        const title = isJump
          ? jumpTitle(jump)
          : timed === null
            ? (command.title ?? `${command.label} (${command.key})`)
            : `${timed.label}: ${timed.note} ${actionStatus(timed)} (${command.key})`;

        return (
          <button
            key={command.id}
            type="button"
            className={`command ${active ? 'active' : ''} ${timed === null ? '' : 'timed'}`}
            disabled={disabled}
            title={title}
            onClick={() => onCommand(command)}
            data-testid={`command-${command.id}`}
          >
            <span className="command-key">{command.key}</span>
            <span className="command-label">{timed?.label ?? command.label}</span>
            {timed === null ? null : (
              <span className="command-state">{actionStatus(timed)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
