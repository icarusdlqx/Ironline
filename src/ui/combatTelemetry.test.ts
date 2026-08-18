import { describe, expect, it } from 'vitest';
import { playerWorld } from '../../tests/support';
import type { MechEntity, World } from '../sim/types';
import {
  actionStatus,
  abilityReadout,
  alphaReadout,
  reactorReadout,
  stabilityReadout,
} from './combatTelemetry';

function mine(world: World): MechEntity {
  const entity = world.entities.find((candidate) => candidate.team === 0);
  if (entity === undefined) throw new Error('no player mech');
  return entity;
}

describe('combat telemetry', () => {
  it('names the pilot ability and counts active time before cooldown', () => {
    const world = playerWorld('readout-ability');
    const mech = mine(world);
    mech.ability.id = 'aimed_volley';
    mech.ability.activeUntilTick = world.tick + 20;
    mech.ability.readyAtTick = world.tick + 100;

    const readout = abilityReadout(world, mech);
    expect(readout.label).toBe('Aimed Volley');
    expect(readout.note).toMatch(/shots go where/);
    expect(readout.activeRemaining).toBeCloseTo(21 * world.dt);
    expect(readout.cooldownRemaining).toBeCloseTo(100 * world.dt);
    expect(actionStatus(readout)).toMatch(/^ACTIVE/);
  });

  it('reports a ready action separately from one the chassis cannot use', () => {
    const world = playerWorld('readout-ready');
    const mech = mine(world);

    expect(abilityReadout(world, mech).ready).toBe(true);
    expect(alphaReadout(world, mech).ready).toBe(true);

    mech.shutdownRemaining = 3;
    const blocked = abilityReadout(world, mech);
    expect(blocked.ready).toBe(false);
    expect(blocked.cooldownRemaining).toBe(0);
    expect(actionStatus(blocked)).toBe('UNAVAILABLE');
  });

  it('prices only live guns that can charge during the alpha window', () => {
    const world = playerWorld('readout-alpha');
    const mech = mine(world);
    const full = reactorReadout(world, mech);
    const energyMount = mech.weapons.find((mount) => {
      const weapon = world.catalog.weapons.get(mount.weaponId);
      return weapon?.ammoPerTon === null && weapon.heat > 0;
    });
    if (energyMount === undefined) throw new Error('no heat-bearing energy weapon');
    const weapon = world.catalog.weapons.get(energyMount.weaponId);
    if (weapon === undefined) throw new Error('missing weapon');

    energyMount.cooldown = world.rules.heat.alphaStrikeSeconds + world.dt;
    expect(reactorReadout(world, mech).alphaHeat).toBeCloseTo(full.alphaHeat - weapon.heat);

    energyMount.cooldown = 0;
    energyMount.destroyed = true;
    expect(reactorReadout(world, mech).alphaHeat).toBeCloseTo(full.alphaHeat - weapon.heat);
  });

  it('does not promise more ammunition than the bins hold', () => {
    const world = playerWorld('readout-ammunition');
    const mech = mine(world);
    const ammoMount = mech.weapons.find((mount) => {
      const weapon = world.catalog.weapons.get(mount.weaponId);
      return weapon !== undefined && weapon.ammoPerTon !== null && weapon.heat > 0;
    });
    if (ammoMount === undefined) throw new Error('no heat-bearing ammunition weapon');
    const weapon = world.catalog.weapons.get(ammoMount.weaponId);
    if (weapon === undefined) throw new Error('missing weapon');
    const bins = mech.ammoBins.filter((bin) => bin.weaponId === weapon.id && !bin.destroyed);
    const first = bins[0];
    if (first === undefined) throw new Error('missing ammunition bin');
    for (const bin of bins) bin.rounds = 0;
    first.rounds = 1;
    for (const mount of mech.weapons) {
      if (mount.weaponId === weapon.id) mount.cooldown = 0;
    }

    const oneRound = reactorReadout(world, mech).alphaHeat;
    first.rounds = 0;
    const dry = reactorReadout(world, mech).alphaHeat;
    expect(oneRound - dry).toBeCloseTo(weapon.heat);
  });

  it('shows the projected heat band and groups the governor has shed', () => {
    const world = playerWorld('readout-governor');
    const mech = mine(world);
    mech.heat = mech.heatCapacity * 0.99;
    mech.groupIntent[1] = true;
    mech.groupEnabled[1] = false;

    const readout = reactorReadout(world, mech);
    expect(readout.projectedTone).toBe('critical');
    expect(readout.projectedBand).toBe('forced-shutdown band');
    expect(readout.shedGroups).toContain(2);
    expect(readout.governorHoldAt).toBe(world.rules.ai.heat.holdFireFraction);
  });

  it('credits the pilot when it states the shutdown risk', () => {
    const world = playerWorld('readout-heat-risk');
    const mech = mine(world);
    for (const mount of mech.weapons) mount.destroyed = true;
    mech.heat = mech.heatCapacity * 0.86;
    const raw = world.rules.heat.tiers.find((tier) => tier.fraction === 0.85);
    if (raw === undefined) throw new Error('missing shutdown-risk tier');
    const override = Math.max(
      0,
      1 - mech.pilot.piloting * world.rules.heat.pilotingOverrideFactor,
    );

    const readout = reactorReadout(world, mech);
    expect(readout.projectedBand).toContain(
      `${Math.round(raw.shutdownChancePerSecond * override * 100)}% shutdown risk/s`,
    );
  });

  it('carries both thresholds and the brief sure-footed interval', () => {
    const world = playerWorld('readout-stability');
    const mech = mine(world);
    mech.stability = world.rules.stability.staggerThreshold + 2;
    mech.footingUntilTick = world.tick + 30;

    const readout = stabilityReadout(world, mech);
    expect(readout.value).toBe(world.rules.stability.staggerThreshold + 2);
    expect(readout.staggerAt).toBe(world.rules.stability.staggerThreshold);
    expect(readout.knockdownAt).toBe(world.rules.stability.knockdownThreshold);
    expect(readout.footingRemaining).toBeCloseTo(30 * world.dt);
  });
});
