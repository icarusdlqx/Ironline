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
    id: 'jump',
    label: 'Jump',
    key: 'J',
    mode: null,
    disabled: true,
    title: 'Jump jets are modelled in data but not yet simulated',
  },
  {
    id: 'support',
    label: 'Support Call',
    key: 'V',
    mode: null,
    disabled: true,
    title: 'Resource Points and support calls arrive in Phase 5',
  },
];

interface Props {
  orderMode: OrderMode;
  enabled: boolean;
  holdingFire: boolean;
  onCommand: (command: Command) => void;
}

export function CommandPalette({ orderMode, enabled, holdingFire, onCommand }: Props) {
  return (
    <div className="palette" data-testid="command-palette">
      {COMMANDS.map((command) => {
        const active =
          (command.mode !== null && command.mode === orderMode) ||
          (command.id === 'hold_fire' && holdingFire);

        return (
          <button
            key={command.id}
            type="button"
            className={`command ${active ? 'active' : ''}`}
            disabled={command.disabled === true || !enabled}
            title={command.title ?? `${command.label} (${command.key})`}
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
