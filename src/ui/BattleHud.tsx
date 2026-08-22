import { CommandPalette, type Command } from './CommandPalette';
import { CentreSelectionButton } from './CentreSelectionButton';
import type { Engine } from './engine';
import { FormationPicker } from './FormationPicker';
import { Minimap } from './Minimap';
import { MobileBattleHud } from './MobileBattleHud';
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
import { useCompactLayout } from './useCompactLayout';

interface BattleHudProps {
  engine: Engine | null;
  supportOptions: readonly SupportOption[];
  trainingStep?: TrainingStep | null;
}

export function BattleHud({ engine, supportOptions, trainingStep = null }: BattleHudProps) {
  const state = useGame();
  const compact = useCompactLayout();
  const unit = selectedUnit(state);
  const playerControlled = unit !== null && unit.team === state.playerTeam && unit.alive;
  const fullHud = trainingShowsFullHud(trainingStep);
  const showsContacts = trainingShowsContacts(trainingStep);
  const visibleCommands = trainingCommandIds(trainingStep);

  const onCommand = (command: Command): void => {
    if (engine === null) return;

    if (command.id === 'hold_fire') {
      engine.toggleHoldFire();
      return;
    }
    if (command.id === 'hold_position') {
      engine.setPosture(command.id);
      return;
    }
    if (command.id === 'ability') {
      engine.useAbilities();
      return;
    }
    if (command.id === 'alpha_strike') {
      engine.alphaStrike();
      return;
    }
    if (command.id === 'heat_safety') {
      engine.toggleHeatSafety();
      return;
    }
    state.setOrderMode(state.orderMode === command.mode ? null : command.mode);
  };

  if (compact) {
    return (
      <MobileBattleHud
        engine={engine}
        supportOptions={supportOptions}
        trainingStep={trainingStep}
        onCommand={onCommand}
      />
    );
  }

  return (
    <>
      {fullHud ? <UnitPanel engine={engine} /> : null}
      {showsContacts ? (
        <HostileBar
          enemies={state.enemies}
          targetIds={
            new Set(
              state.units
                .filter((entry) => state.selection.includes(entry.id) && entry.targetName !== null)
                .flatMap((entry) => {
                  const shot = state.enemies.find((foe) => foe.name === entry.targetName);
                  return shot === undefined ? [] : [shot.id];
                }),
            )
          }
          hasSelection={state.units.some(
            (entry) => state.selection.includes(entry.id) && entry.alive,
          )}
          onTarget={(id) => engine?.orderAttack(id, null)}
        />
      ) : null}
      {fullHud ? <Minimap engine={engine} /> : null}
      <footer className={`bottombar${fullHud ? '' : ' training-bottombar'}`}>
        {trainingShowsHeatReadout(trainingStep) ? (
          <TrainingHeatReadout unit={playerControlled ? unit : null} />
        ) : null}
        <div className="camera-lance-row">
          <CentreSelectionButton engine={engine} className="command camera-centre" />
          <LanceBar
            units={state.units}
            selection={state.selection}
            onSelect={(id) => state.setSelection([id])}
          />
        </div>
        {visibleCommands !== null && visibleCommands.size === 0 ? null : (
          <CommandPalette
            leading={
              fullHud ? (
                <FormationPicker
                  value={state.formationPreset}
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
        )}
        {fullHud ? (
          <SupportPalette
            options={supportOptions}
            resourcePoints={state.resourcePoints}
            active={state.supportMode}
            reservesLeft={state.reservesLeft}
            onPick={(call) => state.setSupportMode(state.supportMode === call ? null : call)}
          />
        ) : null}
      </footer>
    </>
  );
}
