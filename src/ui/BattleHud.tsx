import type { MechLocation } from '../schema/common';
import { CommandPalette, type Command } from './CommandPalette';
import type { Engine } from './engine';
import { Minimap } from './Minimap';
import {
  EventLog,
  HeatBar,
  HostileBar,
  LanceBar,
  SupportPalette,
  WeaponGroups,
} from './Panels';
import { PaperDoll } from './PaperDoll';
import { selectedUnit, useGame } from './store';
import type { SupportOption } from './supportOptions';
import { TacticalReadout } from './TacticalReadout';

interface BattleHudProps {
  engine: Engine | null;
  supportOptions: readonly SupportOption[];
}

export function BattleHud({ engine, supportOptions }: BattleHudProps) {
  const state = useGame();
  const unit = selectedUnit(state);
  // The readout is only trusted when it is priced for the mech on screen: the
  // HUD refreshes at 10Hz, and a stale reading for the last selection is worse
  // than none.
  const preview =
    unit !== null && state.hitPreview !== null && state.hitPreview.shooterId === unit.id
      ? state.hitPreview
      : null;
  const playerControlled = unit !== null && unit.team === state.playerTeam && unit.alive;

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
    state.setOrderMode(command.mode);
  };

  const onSelectLocation = (location: MechLocation): void => {
    state.setCalledShotLocation(location);
    state.setOrderMode('called_shot');
  };

  return (
    <>
      <aside className="sidebar" data-testid="sidebar">
        {unit === null ? (
          <p className="empty">Select a mech — click it, or press Tab to cycle your lance.</p>
        ) : (
          <>
            <h2>
              {unit.pilotName}
              <small>{unit.name}</small>
            </h2>
            <PaperDoll
              locations={unit.locations}
              {...(playerControlled ? { onSelectLocation } : {})}
              activeLocation={state.orderMode === 'called_shot' ? state.calledShotLocation : null}
            />
            <HeatBar heat={unit.heat} capacity={unit.heatCapacity} thresholds={state.heatTiers} />
            <TacticalReadout unit={unit} />
            <div className="target-line">
              {preview === null ? (
                <>
                  Target: <strong>{unit.targetName ?? 'none'}</strong>
                </>
              ) : (
                <>
                  {preview.hover ? 'Sizing up' : 'Target'}:{' '}
                  <strong>{preview.targetName}</strong>
                  <span className="target-range">{Math.round(preview.range)}m</span>
                </>
              )}
            </div>
            {preview === null || preview.factors.length === 0 ? null : (
              <div className="hit-factors" data-testid="hit-factors">
                {preview.factors.map((factor) => (
                  <span
                    key={factor.id}
                    className={factor.value < 1 ? 'penalty' : 'bonus'}
                    title={`×${factor.value.toFixed(2)}`}
                  >
                    {factor.label} {factor.value < 1 ? '−' : '+'}
                    {Math.abs(Math.round((factor.value - 1) * 100))}%
                  </span>
                ))}
              </div>
            )}
            <WeaponGroups
              unit={unit}
              onToggleGroup={(group) => engine?.toggleGroup(group)}
              {...(preview === null ? {} : { preview })}
            />
          </>
        )}
        <EventLog lines={state.log} />
      </aside>

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

      <Minimap engine={engine} />

      <footer className="bottombar">
        <LanceBar
          units={state.units}
          selection={state.selection}
          onSelect={(id) => state.setSelection([id])}
        />
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
        <SupportPalette
          options={supportOptions}
          resourcePoints={state.resourcePoints}
          active={state.supportMode}
          reservesLeft={state.reservesLeft}
          onPick={(call) => state.setSupportMode(state.supportMode === call ? null : call)}
        />
      </footer>
    </>
  );
}
