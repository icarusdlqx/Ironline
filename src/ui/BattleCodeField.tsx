import { checkBattleCode } from './battleCode';

interface BattleCodeFieldProps {
  code: string;
  onCode: (code: string) => void;
}

export function BattleCodeField({ code, onCode }: BattleCodeFieldProps) {
  const checked = checkBattleCode(code);

  const settle = (): void => {
    const next = checkBattleCode(code);
    if (next.ok) onCode(next.code);
  };

  return (
    <label className="setup-field battle-code-field">
      <span>Battle code</span>
      <input
        value={code}
        onChange={(event) => onCode(event.target.value)}
        onBlur={settle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        aria-invalid={!checked.ok}
        aria-describedby="battle-code-note"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
        data-testid="briefing-battle-code"
      />
      <small
        className={checked.ok ? 'setup-description' : 'setup-description setup-invalid'}
        id="battle-code-note"
      >
        {checked.ok
          ? 'With the same mission, difficulty, and lance, this reproduces the opening field and battle rolls.'
          : checked.reason}
      </small>
    </label>
  );
}
