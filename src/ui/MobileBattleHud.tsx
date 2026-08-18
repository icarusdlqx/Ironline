import { useEffect, useState } from 'react';
import { CommandPalette, type Command } from './CommandPalette';
import type { Engine } from './engine';
import { Minimap } from './Minimap';
import { HostileBar, LanceBar, SupportPalette } from './Panels';
import { selectedUnit, useGame } from './store';
import type { SupportOption } from './supportOptions';
import { UnitPanel } from './UnitPanel';

type DockPanel = 'orders' | 'support' | 'contacts' | 'unit';

interface MobileBattleHudProps {
  engine: Engine | null;
  supportOptions: readonly SupportOption[];
  onCommand: (command: Command) => void;
}

export function MobileBattleHud({ engine, supportOptions, onCommand }: MobileBattleHudProps) {
  const state = useGame();
  const unit = selectedUnit(state);
  const [panel, setPanel] = useState<DockPanel>('orders');
  const playerControlled = unit !== null && unit.team === state.playerTeam && unit.alive;
  const selectedAlive = state.units.some(
    (entry) => state.selection.includes(entry.id) && entry.alive,
  );
  const targetIds = new Set(
    state.units
      .filter((entry) => state.selection.includes(entry.id) && entry.targetName !== null)
      .flatMap((entry) => {
        const shot = state.enemies.find((foe) => foe.name === entry.targetName);
        return shot === undefined ? [] : [shot.id];
      }),
  );
  const armed = state.orderMode !== null || state.supportMode !== null || state.queueOrders;

  useEffect(
    () => () => {
      // A queued route must not survive rotation into a layout with no Queue control.
      useGame.getState().patch({ queueOrders: false });
    },
    [],
  );

  const choosePanel = (next: DockPanel): void => {
    setPanel(next);
    if (next !== 'support') state.setSupportMode(null);
    else state.patch({ queueOrders: false });
  };

  const cancel = (): void => {
    state.setOrderMode(null);
    state.setSupportMode(null);
    state.patch({ queueOrders: false });
  };

  return (
    <>
      <Minimap engine={engine} />
      <footer className={`mobile-dock panel-${panel}`} data-testid="mobile-dock">
        <div className="mobile-lance-row">
          <button
            type="button"
            className="mobile-lance-action"
            onClick={() =>
              state.setSelection(
                state.units
                  .filter((entry) => entry.team === state.playerTeam && entry.alive)
                  .map((entry) => entry.id),
              )
            }
            data-testid="mobile-select-all"
          >
            All
          </button>
          <LanceBar
            units={state.units}
            selection={state.selection}
            onSelect={(id) => state.setSelection([id])}
          />
          <button
            type="button"
            className={`mobile-lance-action ${state.queueOrders ? 'active' : ''}`}
            aria-pressed={state.queueOrders}
            onClick={() => state.patch({ queueOrders: !state.queueOrders })}
            data-testid="mobile-queue"
          >
            Queue
          </button>
          <button
            type="button"
            className={`mobile-lance-action ${armed ? 'armed' : ''}`}
            disabled={!armed}
            onClick={cancel}
            data-testid="mobile-cancel"
          >
            Cancel
          </button>
        </div>

        <nav className="mobile-dock-tabs" aria-label="Battle controls">
          {([
            ['orders', 'Orders'],
            ['support', `Support · ${state.resourcePoints}`],
            ['contacts', `Contacts · ${state.enemies.filter((entry) => entry.alive).length}`],
            ['unit', unit === null ? 'Unit' : unit.pilotName],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={panel === id ? 'active' : ''}
              aria-pressed={panel === id}
              onClick={() => choosePanel(id)}
              data-testid={`mobile-tab-${id}`}
            >
              {label}
            </button>
          ))}
        </nav>

        <section className="mobile-tray" data-testid={`mobile-tray-${panel}`}>
          {panel === 'orders' ? (
            <CommandPalette
              orderMode={state.orderMode}
              enabled={playerControlled}
              holdingFire={unit?.holdingFire ?? false}
              heatSafety={unit?.heatSafety ?? false}
              ability={unit?.ability ?? null}
              alpha={unit?.alpha ?? null}
              jump={
                unit === null
                  ? null
                  : { ready: unit.canJump, range: unit.jumpRange, cooldown: unit.jumpCooldown }
              }
              posture={unit?.posture ?? 'free'}
              onCommand={onCommand}
            />
          ) : panel === 'support' ? (
            <SupportPalette
              options={supportOptions}
              resourcePoints={state.resourcePoints}
              active={state.supportMode}
              reservesLeft={state.reservesLeft}
              onPick={(call) => state.setSupportMode(state.supportMode === call ? null : call)}
            />
          ) : panel === 'contacts' ? (
            <HostileBar
              enemies={state.enemies}
              targetIds={targetIds}
              hasSelection={selectedAlive}
              onTarget={(id) => engine?.orderAttack(id, null)}
            />
          ) : (
            <UnitPanel engine={engine} compact />
          )}
        </section>
      </footer>
    </>
  );
}
