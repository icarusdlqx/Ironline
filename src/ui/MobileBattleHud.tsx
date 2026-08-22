import { useEffect, useState } from 'react';
import { CommandPalette, type Command } from './CommandPalette';
import { CentreSelectionButton } from './CentreSelectionButton';
import type { Engine } from './engine';
import { FormationPicker } from './FormationPicker';
import { Minimap } from './Minimap';
import { HostileBar, LanceBar, SupportPalette } from './Panels';
import { selectedUnit, useGame } from './store';
import type { SupportOption } from './supportOptions';
import { TrainingHeatReadout } from './TrainingHeatReadout';
import {
  trainingCommandIds,
  trainingShowsContacts,
  trainingShowsFullHud,
  trainingShowsHeatReadout,
} from './trainingPresentation';
import type { TrainingStep } from './trainingProgress';
import { UnitPanel } from './UnitPanel';

type DockPanel = 'orders' | 'support' | 'contacts' | 'unit';

interface MobileBattleHudProps {
  engine: Engine | null;
  supportOptions: readonly SupportOption[];
  trainingStep: TrainingStep | null;
  onCommand: (command: Command) => void;
}

export function MobileBattleHud({
  engine,
  supportOptions,
  trainingStep,
  onCommand,
}: MobileBattleHudProps) {
  const state = useGame();
  const unit = selectedUnit(state);
  const [panel, setPanel] = useState<DockPanel>('orders');
  const playerControlled = unit !== null && unit.team === state.playerTeam && unit.alive;
  const fullHud = trainingShowsFullHud(trainingStep);
  const showsContacts = trainingShowsContacts(trainingStep);
  const showsHeat = trainingShowsHeatReadout(trainingStep);
  const visibleCommands = trainingCommandIds(trainingStep);
  const showsOrders = visibleCommands === null || visibleCommands.size > 0;
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
  const tabs: { id: DockPanel; label: string }[] = [];
  if (showsOrders) tabs.push({ id: 'orders', label: 'Orders' });
  if (fullHud) tabs.push({ id: 'support', label: `Support · ${state.resourcePoints}` });
  if (showsContacts) {
    tabs.push({
      id: 'contacts',
      label: `Contacts · ${state.enemies.filter((entry) => entry.alive).length}`,
    });
  }
  if (fullHud || showsHeat) {
    tabs.push({ id: 'unit', label: showsHeat ? 'Heat' : unit?.pilotName ?? 'Unit' });
  }
  const panelAllowed =
    (panel === 'orders' && showsOrders) ||
    (panel === 'support' && fullHud) ||
    (panel === 'contacts' && showsContacts) ||
    (panel === 'unit' && (fullHud || showsHeat));
  const fallbackPanel: DockPanel | null = showsOrders
    ? 'orders'
    : showsContacts
      ? 'contacts'
      : fullHud || showsHeat
        ? 'unit'
        : null;

  useEffect(
    () => () => {
      // A queued route must not survive rotation into a layout with no Queue control.
      useGame.getState().patch({ queueOrders: false });
    },
    [],
  );

  useEffect(() => {
    if (!panelAllowed && fallbackPanel !== null) setPanel(fallbackPanel);
  }, [fallbackPanel, panelAllowed]);

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
      {fullHud ? <Minimap engine={engine} /> : null}
      <footer
        className={`mobile-dock panel-${panel}${
          fullHud ? '' : trainingStep === 0 ? ' training-select' : ' training-progressive'
        }`}
        data-testid="mobile-dock"
      >
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
          <CentreSelectionButton engine={engine} className="mobile-lance-action" />
          {fullHud ? (
            <button
              type="button"
              className={`mobile-lance-action ${state.queueOrders ? 'active' : ''}`}
              aria-pressed={state.queueOrders}
              onClick={() => state.patch({ queueOrders: !state.queueOrders })}
              data-testid="mobile-queue"
            >
              Queue
            </button>
          ) : null}
          {trainingStep === 0 ? null : (
            <button
              type="button"
              className={`mobile-lance-action ${armed ? 'armed' : ''}`}
              disabled={!armed}
              onClick={cancel}
              data-testid="mobile-cancel"
            >
              Cancel
            </button>
          )}
        </div>

        {tabs.length === 0 ? null : (
          <nav
            className={`mobile-dock-tabs${fullHud ? '' : ` training-tabs-${tabs.length}`}`}
            aria-label="Battle controls"
          >
            {tabs.map(({ id, label }) => (
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
        )}

        {tabs.length === 0 ? null : (
          <section className="mobile-tray" data-testid={`mobile-tray-${panel}`}>
            {panel === 'orders' ? (
              <CommandPalette
                leading={
                  fullHud ? (
                    <FormationPicker
                      value={state.formationPreset}
                      compact
                      onChange={state.setFormationPreset}
                    />
                  ) : undefined
                }
                visibleCommandIds={visibleCommands}
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
            ) : showsHeat ? (
              <TrainingHeatReadout unit={playerControlled ? unit : null} />
            ) : (
              <UnitPanel engine={engine} compact />
            )}
          </section>
        )}
      </footer>
    </>
  );
}
