import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { Faction } from '../schema/faction';
import type { Catalog } from '../schema/load';
import { EconomyRulesSchema } from '../schema/rules';
import { advanceDays, startCampaign } from './campaign';
import { sellMech } from './market';
import { rebuildHulk } from './refit';
import {
  estimateRepair,
  projectedRepairWindow,
  repairQueue,
  startRepair,
} from './repair';
import { deserialiseCampaign, serialiseCampaign } from './save';
import type { CampaignState, MechRecord } from './types';

function start(): CampaignState {
  return startCampaign(catalog, 'border_dispute', 'one-repair-lift');
}

function withBayCapacity(bayCapacity: number): Catalog {
  return {
    ...catalog,
    rules: {
      ...catalog.rules,
      economy: {
        ...catalog.rules.economy,
        repair: { ...catalog.rules.economy.repair, bayCapacity },
      },
    },
  };
}

function withChassisFaction(mech: MechRecord, faction: Faction): Catalog {
  const chassis = catalog.chassis.get(mech.design.chassisId);
  if (chassis === undefined) throw new Error('test mech has no chassis');
  const chassisById = new Map(catalog.chassis);
  chassisById.set(chassis.id, { ...chassis, faction });
  return { ...catalog, chassis: chassisById };
}

function damage(mech: MechRecord, amount = 1): void {
  mech.condition.centre_torso.armour = Math.max(
    0,
    mech.condition.centre_torso.armour - amount,
  );
}

function firstThree(state: CampaignState): [MechRecord, MechRecord, MechRecord] {
  const [first, second, third] = state.mechs;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('campaign needs three machines for the queue test');
  }
  return [first, second, third];
}

describe('single repair bay', () => {
  it('applies the authored Sealed cost and workshop-time premium', () => {
    const mech = start().mechs[0];
    if (mech === undefined) throw new Error('campaign has no test mech');
    damage(mech, 20);

    const line = estimateRepair(withChassisFaction(mech, 'linewrought'), mech);
    const sealed = estimateRepair(withChassisFaction(mech, 'aurelian'), mech);
    const factors = catalog.rules.economy.repair.factionFactors;

    expect(factors.linewrought).toEqual({ cost: 1, days: 1 });
    expect(factors.aurelian.cost).toBeGreaterThanOrEqual(2);
    expect(factors.aurelian.cost).toBeLessThanOrEqual(3);
    expect(factors.aurelian.days).toBeGreaterThanOrEqual(2);
    expect(factors.aurelian.days).toBeLessThanOrEqual(3);
    expect(sealed.cost).toBe(Math.round(line.cost * factors.aurelian.cost));
    expect(sealed.days).toBe(Math.ceil(line.days * factors.aurelian.days));
  });

  it('defaults older economy packs to one repair lift', () => {
    const legacyRepair = Object.fromEntries(
      Object.entries(catalog.rules.economy.repair).filter(([key]) => key !== 'bayCapacity'),
    );
    const parsed = EconomyRulesSchema.parse({
      ...catalog.rules.economy,
      repair: legacyRepair,
    });

    expect(parsed.repair.bayCapacity).toBe(1);
  });

  it('charges on booking and completes deterministic queued work one machine at a time', () => {
    const state = start();
    const [first, second] = firstThree(state);
    damage(first, 1);
    damage(second, 2);

    const firstEstimate = estimateRepair(catalog, first);
    const secondEstimate = estimateRepair(catalog, second);
    const cash = state.cbills;

    expect(startRepair(catalog, state, first).ok).toBe(true);
    expect(startRepair(catalog, state, second).ok).toBe(true);
    expect(state.cbills).toBe(cash - firstEstimate.cost - secondEstimate.cost);
    expect(first.readyOnDay).toBe(state.day + firstEstimate.days);
    expect(second.readyOnDay).toBe(first.readyOnDay + secondEstimate.days);
    expect(repairQueue(catalog, state)).toEqual([
      expect.objectContaining({
        mechId: first.id,
        position: 1,
        queuePosition: null,
        status: 'active',
        startsOnDay: state.day,
        readyOnDay: first.readyOnDay,
      }),
      expect.objectContaining({
        mechId: second.id,
        position: 2,
        queuePosition: 1,
        status: 'queued',
        startsOnDay: first.readyOnDay,
        readyOnDay: second.readyOnDay,
      }),
    ]);

    advanceDays(catalog, state, firstEstimate.days);
    expect(first.status).toBe('ready');
    expect(second.status).toBe('repairing');
    expect(repairQueue(catalog, state)[0]).toMatchObject({
      mechId: second.id,
      position: 1,
      status: 'active',
      startsOnDay: state.day,
    });

    advanceDays(catalog, state, secondEstimate.days);
    expect(second.status).toBe('ready');
    expect(repairQueue(catalog, state)).toEqual([]);
  });

  it('puts a paid hulk rebuild behind work already on the lift', () => {
    const state = start();
    const [active, hulk] = firstThree(state);
    damage(active);
    expect(startRepair(catalog, state, active).ok).toBe(true);

    hulk.status = 'hulk';
    hulk.rebuildCost = 1_000;
    const cash = state.cbills;
    const activeReady = active.readyOnDay;

    expect(rebuildHulk(catalog, state, hulk).ok).toBe(true);
    expect(state.cbills).toBe(cash - 1_000);
    expect(hulk.readyOnDay).toBe(activeReady + catalog.rules.salvage.hulkRebuildDays);
    expect(repairQueue(catalog, state).find((entry) => entry.mechId === hulk.id)).toMatchObject({
      position: 2,
      queuePosition: 1,
      status: 'queued',
      startsOnDay: activeReady,
    });
  });

  it('honours authored capacity before placing another machine in line', () => {
    const twoBayCatalog = withBayCapacity(2);
    const state = startCampaign(twoBayCatalog, 'border_dispute', 'two-repair-lifts');
    const [first, second, third] = firstThree(state);
    damage(first);
    damage(second);
    damage(third);

    expect(startRepair(twoBayCatalog, state, first).ok).toBe(true);
    expect(startRepair(twoBayCatalog, state, second).ok).toBe(true);
    expect(startRepair(twoBayCatalog, state, third).ok).toBe(true);

    expect(first.readyOnDay).toBe(state.day + estimateRepair(twoBayCatalog, first).days);
    expect(second.readyOnDay).toBe(state.day + estimateRepair(twoBayCatalog, second).days);
    expect(third.readyOnDay).toBe(
      Math.min(first.readyOnDay, second.readyOnDay) + estimateRepair(twoBayCatalog, third).days,
    );
    expect(repairQueue(twoBayCatalog, state).map((entry) => entry.status)).toEqual([
      'active',
      'active',
      'queued',
    ]);
  });

  it('round-trips the queue and books later work after its final ready date', () => {
    const state = start();
    const [first, second, third] = firstThree(state);
    damage(first);
    damage(second);
    damage(third);
    expect(startRepair(catalog, state, first).ok).toBe(true);
    expect(startRepair(catalog, state, second).ok).toBe(true);

    const restored = deserialiseCampaign(serialiseCampaign(state), catalog).state;
    expect(restored).not.toBeNull();
    if (restored === null) return;
    expect(repairQueue(catalog, restored)).toEqual(repairQueue(catalog, state));

    const restoredThird = restored.mechs.find((mech) => mech.id === third.id);
    if (restoredThird === undefined) throw new Error('third machine did not load');
    const projected = projectedRepairWindow(
      catalog,
      restored,
      estimateRepair(catalog, restoredThird).days,
    );
    expect(startRepair(catalog, restored, restoredThird).ok).toBe(true);
    expect(restoredThird.readyOnDay).toBe(projected.readyOnDay);
    expect(repairQueue(catalog, restored).map((entry) => entry.mechId)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });

  it('keeps old paid completion dates and queues new work after the latest one', () => {
    const state = start();
    const [first, second, third] = firstThree(state);
    first.status = 'repairing';
    second.status = 'repairing';
    first.readyOnDay = state.day + 2;
    second.readyOnDay = state.day + 2;
    damage(third);

    const restored = deserialiseCampaign(serialiseCampaign(state), catalog).state;
    expect(restored).not.toBeNull();
    if (restored === null) return;
    expect(restored.mechs.slice(0, 2).map((mech) => mech.readyOnDay)).toEqual([
      state.day + 2,
      state.day + 2,
    ]);
    expect(repairQueue(catalog, restored)[1]).toMatchObject({
      mechId: second.id,
      status: 'inherited',
      queuePosition: null,
      startsOnDay: null,
    });

    const restoredThird = restored.mechs.find((mech) => mech.id === third.id);
    if (restoredThird === undefined) throw new Error('third machine did not load');
    const days = estimateRepair(catalog, restoredThird).days;
    expect(startRepair(catalog, restored, restoredThird).ok).toBe(true);
    expect(restoredThird.readyOnDay).toBe(state.day + 2 + days);
  });

  it('will not sell an active or queued machine with a paid booking', () => {
    const state = start();
    const [active, queued] = firstThree(state);
    damage(active);
    damage(queued);
    expect(startRepair(catalog, state, active).ok).toBe(true);
    expect(startRepair(catalog, state, queued).ok).toBe(true);
    const cash = state.cbills;
    const ids = state.mechs.map((mech) => mech.id);

    expect(sellMech(catalog, state, active.id).reason).toMatch(/paid workshop booking/);
    expect(sellMech(catalog, state, queued.id).reason).toMatch(/paid workshop booking/);
    expect(state.cbills).toBe(cash);
    expect(state.mechs.map((mech) => mech.id)).toEqual(ids);
  });
});
