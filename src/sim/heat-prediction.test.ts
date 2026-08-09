import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { LOCATIONS } from '../schema/common';
import { createMech } from './entity';
import { eventsOfType } from './events';
import { computeHeatProfile } from './loadout';
import { issueAttack, setHoldFire } from './orders';
import type { MechEntity, World } from './types';
import { createWorld, stepWorld } from './world';

// Every weapon in the shipped catalogue reaches this far and none is inside its
// minimum range, so a bench at 100m fires the whole loadout every cooldown.
const BENCH_RANGE = 100;
const BENCH_TICKS_PER_SECOND = catalog.rules.simulation.tickRate;

interface Bench {
  world: World;
  shooter: MechEntity;
  generated: number[];
}

function makeInvulnerable(mech: MechEntity): void {
  for (const location of LOCATIONS) {
    const state = mech.locations[location];
    state.armour = 1e9;
    state.armourMax = 1e9;
    state.internal = 1e9;
    state.internalMax = 1e9;
  }
}

/**
 * Fires one design continuously at a target that cannot die or shoot back, and
 * records cumulative heat generated per tick.
 */
function runBench(designId: string, seconds: number, uncapHeat: boolean): Bench {
  const world = createWorld(catalog, { seed: `bench:${designId}`, missionId: 'skirmish_ridge' });
  world.entities.length = 0;

  const shooter = createMech(catalog, catalog.rules, {
    id: 1,
    team: 0,
    designId,
    pilotId: 'kessa_vale',
    spawn: { x: 200, y: 12 },
    facingDegrees: 0,
    autopilot: false,
  });

  const target = createMech(catalog, catalog.rules, {
    id: 2,
    team: 1,
    designId: 'rampart_breaker',
    pilotId: 'dorn_hess',
    spawn: { x: 200 + BENCH_RANGE, y: 12 },
    facingDegrees: 180,
    autopilot: false,
  });

  makeInvulnerable(target);
  setHoldFire(target, true);

  // The mechbay calculator answers "what happens if you fire everything", so the
  // bench measures that. The reactor governor is a runtime aid, not a property
  // of the build, and would throttle the very thing being measured.
  shooter.heatSafety = false;
  world.entities.push(shooter, target);

  // A huge heat sink lets us measure raw generation without the sim's
  // hold-fire-near-shutdown guard throttling the loadout.
  if (uncapHeat) shooter.heatCapacity = 1e6;

  issueAttack(shooter, target.id, null);

  const totalTicks = Math.round(seconds * BENCH_TICKS_PER_SECOND);
  const generated: number[] = [0];
  let cumulative = 0;
  let seen = 0;

  for (let tick = 0; tick < totalTicks; tick += 1) {
    stepWorld(world, totalTicks + 10);
    const fired = eventsOfType(world.events, 'weapon_fired');
    for (let index = seen; index < fired.length; index += 1) {
      const event = fired[index];
      if (event === undefined || event.shooterId !== shooter.id) continue;
      cumulative += catalog.weapons.get(event.weaponId)?.heat ?? 0;
    }
    seen = fired.length;
    generated.push(cumulative);
  }

  return { world, shooter, generated };
}

function rateBetween(bench: Bench, fromSeconds: number, toSeconds: number): number {
  const from = bench.generated[Math.round(fromSeconds * BENCH_TICKS_PER_SECOND)] ?? 0;
  const to = bench.generated[Math.round(toSeconds * BENCH_TICKS_PER_SECOND)] ?? 0;
  return (to - from) / (toSeconds - fromSeconds);
}

const BUILDS = [
  { designId: 'rampart_breaker', label: 'ballistic assault (predicted sustainable)' },
  { designId: 'sentinel_sniper', label: 'energy medium (predicted to overheat)' },
  { designId: 'bulwark_assault', label: 'mixed heavy (predicted to overheat)' },
] as const;

describe.each(BUILDS)('$label', ({ designId }) => {
  const design = catalog.designs.get(designId);
  if (design === undefined) throw new Error(`missing design ${designId}`);
  const profile = computeHeatProfile(catalog, design);

  it('generates the predicted alpha strike on the opening volley', () => {
    const bench = runBench(designId, 0.5, true);
    const firstVolley = bench.generated[bench.generated.length - 1] ?? 0;
    expect(firstVolley).toBe(profile.alphaStrikeHeat);
  });

  it('sustains the predicted heat per second', () => {
    const bench = runBench(designId, 26, true);
    const measured = rateBetween(bench, 5, 25);
    const error = Math.abs(measured - profile.heatPerSecond) / profile.heatPerSecond;

    expect(
      error,
      `predicted ${profile.heatPerSecond.toFixed(2)}/s, measured ${measured.toFixed(2)}/s`,
    ).toBeLessThan(0.15);
  });

  it('matches the predicted dissipation rate', () => {
    const bench = runBench(designId, 1, false);
    bench.shooter.heat = 20;
    setHoldFire(bench.shooter, true);

    const before = bench.shooter.heat;
    for (let tick = 0; tick < BENCH_TICKS_PER_SECOND; tick += 1) {
      stepWorld(bench.world, 10_000);
    }

    expect(before - bench.shooter.heat).toBeCloseTo(profile.dissipationPerSecond, 4);
  });

  it('reaches shutdown heat only when the calculator says it will', () => {
    const bench = runBench(designId, 60, false);
    const peakFraction = bench.shooter.stats.heatPeak / bench.shooter.heatCapacity;

    if (profile.sustainable) {
      expect(
        peakFraction,
        `${designId} was predicted sustainable but peaked at ${(peakFraction * 100).toFixed(0)}%`,
      ).toBeLessThan(0.85);
    } else {
      expect(
        peakFraction,
        `${designId} was predicted to overheat but only peaked at ${(peakFraction * 100).toFixed(0)}%`,
      ).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('never risks shutdown before the calculator says it can', () => {
    if (profile.secondsToShutdownRisk === null) return;

    const bench = runBench(designId, 60, false);
    const shutdowns = eventsOfType(bench.world.events, 'shutdown').filter(
      (event) => event.entityId === bench.shooter.id,
    );

    expect(shutdowns.length).toBeGreaterThan(0);
    const firstAt = (shutdowns[0]?.tick ?? 0) / BENCH_TICKS_PER_SECOND;
    expect(
      firstAt,
      `risk predicted from ${profile.secondsToShutdownRisk.toFixed(1)}s, sim shut down at ${firstAt.toFixed(1)}s`,
    ).toBeGreaterThanOrEqual(profile.secondsToShutdownRisk);
  });

  it('does shut down inside a mission-length engagement when predicted to overheat', () => {
    if (profile.secondsToShutdownRisk === null) return;

    // No upper bound on when: once in the risk band the sim holds fire to cool,
    // so a hot mech hovers below shutdown rather than climbing straight through.
    const bench = runBench(designId, 60, false);
    const shutdowns = eventsOfType(bench.world.events, 'shutdown').filter(
      (event) => event.entityId === bench.shooter.id,
    );
    expect(shutdowns.length).toBeGreaterThan(0);
  });

  it('throttles a hot build below the alpha strike it could fire cold', () => {
    const cold = runBench(designId, 26, true);
    const hot = runBench(designId, 26, false);

    const coldTotal = cold.generated[cold.generated.length - 1] ?? 0;
    const hotTotal = hot.generated[hot.generated.length - 1] ?? 0;

    if (profile.sustainable) expect(hotTotal).toBe(coldTotal);
    else expect(hotTotal).toBeLessThan(coldTotal);
  });
});
