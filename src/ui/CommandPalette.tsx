import type { OrderMode } from './store';

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
  { id: 'attack', label: 'Attack', key: 'F', mode: 'attack' },
  { id: 'called_shot', label: 'Called Shot', key: 'C', mode: 'called_shot' },
  { id: 'hold_fire', label: 'Hold Fire', key: 'H', mode: null },
  { id: 'guard', label: 'Guard', key: 'G', mode: null },
  {
    id: 'heat_safety',
    label: 'Heat Safety',
    key: 'T',
    mode: null,
    title: 'Reactor governor: sheds the hottest weapons rather than risk a shutdown (T)',
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
  /** Jets aboard, charged and free to fire. Null when nothing is selected. */
  jump: { ready: boolean; range: number; cooldown: number } | null;
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
  jump,
  onCommand,
}: Props) {
  return (
    <div className="palette" data-testid="command-palette">
      {COMMANDS.map((command) => {
        const active =
          (command.mode !== null && command.mode === orderMode) ||
          (command.id === 'hold_fire' && holdingFire) ||
          (command.id === 'heat_safety' && heatSafety);

        const isJump = command.id === 'jump';
        const disabled = command.disabled === true || !enabled || (isJump && jump?.ready !== true);
        const title = isJump ? jumpTitle(jump) : (command.title ?? `${command.label} (${command.key})`);

        return (
          <button
            key={command.id}
            type="button"
            className={`command ${active ? 'active' : ''}`}
            disabled={disabled}
            title={title}
            onClick={() => onCommand(command)}
            data-testid={`command-${command.id}`}
          >
            <span className="command-key">{command.key}</span>
            <span className="command-label">{command.label}</span>
          </button>
        );
      })}
    </div>
  );
}
