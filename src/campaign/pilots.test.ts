import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { createMech } from '../sim/entity';
import {
  availableHires,
  availableXp,
  awardXp,
  chooseTrait,
  hirePilot,
  offeredTraits,
  pendingTraitPicks,
  raiseSkill,
  skillCost,
  skillTotal,
} from './roster';
import { startCampaign } from './campaign';
import type { CampaignState, PilotRecord } from './types';
import type { UnitResult } from '../sim/world';

function campaign(seed = 'pilots'): CampaignState {
  return startCampaign(catalog, 'border_dispute', seed);
}

function record(state: CampaignState): PilotRecord {
  const pilot = state.pilots[0];
  if (pilot === undefined) throw new Error('the campaign started with no pilots');
  return pilot;
}

function drop(overrides: Partial<UnitResult> = {}): UnitResult {
  return {
    id: 1,
    team: 0,
    name: 'unit',
    designId: 'sentinel_brawler',
    pilotId: 'kessa_vale',
    alive: true,
    killMethod: null,
    pilotDead: false,
    pilotEjected: false,
    withdrew: false,
    legged: false,
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    shotsHit: 0,
    ammoSpent: 0,
    heatPeak: 0,
    kills: 0,
    ...overrides,
  } as UnitResult;
}

describe('the pilot register', () => {
  it('gives every pilot a speciality and a history', () => {
    // A roster where everyone is a number is not a roster, it is a spreadsheet.
    const pilots = [...catalog.pilots.values()];
    expect(pilots.length).toBeGreaterThanOrEqual(12);

    for (const pilot of pilots) {
      expect(pilot.bio.length, `${pilot.id} has no history`).toBeGreaterThan(20);
      expect(pilot.traits.length, `${pilot.id} has no speciality`).toBeGreaterThan(0);
      for (const traitId of pilot.traits) {
        expect(
          catalog.rules.pilotTraits.entries[traitId],
          `${pilot.id} claims an unknown speciality "${traitId}"`,
        ).toBeDefined();
      }
    }

    // And they must not all be the same person.
    const spreads = new Set(pilots.map((p) => `${p.gunnery}/${p.piloting}/${p.sensors}`));
    expect(spreads.size).toBeGreaterThan(6);
  });

  it('carries a speciality onto the machine the pilot is flying', () => {
    const marksman = catalog.pilots.get('kessa_vale');
    const plain = catalog.pilots.get('bo_ferrant');
    if (marksman === undefined || plain === undefined) throw new Error('missing a named pilot');

    const build = (pilotId: string) =>
      createMech(catalog, catalog.rules, {
        id: 1,
        team: 0,
        designId: 'sentinel_brawler',
        pilotId,
        spawn: { x: 100, y: 100 },
        facingDegrees: 0,
      });

    expect(build('kessa_vale').outgoingAccuracyFactor).toBeGreaterThan(
      build('bo_ferrant').outgoingAccuracyFactor,
    );
    expect(build('cato_ferrin').pilot.criticalChanceFactor).toBeGreaterThan(1);
  });

  it('pays experience for what the pilot actually did', () => {
    const state = campaign();
    const idle = record(state);
    const busy = { ...idle, xp: 0, spentXp: 0 };

    awardXp(catalog, { pilot: idle, unit: drop() }, false);
    awardXp(catalog, { pilot: busy, unit: drop({ shotsHit: 40, damageDealt: 120, kills: 1 }) }, true);

    expect(busy.xp, 'a pilot who fought learned no more than one who hid').toBeGreaterThan(idle.xp);
  });

  it('banks a drop award until the commander chooses a skill', () => {
    const state = campaign();
    const pilot = record(state);
    const before = { gunnery: pilot.gunnery, piloting: pilot.piloting, sensors: pilot.sensors };

    const earned = awardXp(catalog, {
      pilot,
      unit: drop({ shotsHit: 100, damageDealt: 2_000, kills: 10 }),
    }, true);

    expect(earned).toBeGreaterThan(skillCost(catalog, pilot.sensors));
    expect({ gunnery: pilot.gunnery, piloting: pilot.piloting, sensors: pilot.sensors }).toEqual(before);
    expect(pilot.spentXp).toBe(0);

    expect(raiseSkill(catalog, pilot, 'sensors').ok).toBe(true);
    expect(pilot.sensors).toBe(before.sensors + 1);
    expect(availableXp(pilot)).toBeLessThan(earned);
  });

  it('offers the pilots you have not got, and signs one for money', () => {
    const state = campaign();
    const offered = availableHires(catalog, state);
    const authored = catalog.campaigns.get(state.campaignId)?.hiringPoolPilotIds ?? [];
    expect(offered.map((pilot) => pilot.id).sort()).toEqual([...authored].sort());
    for (const hire of offered) {
      expect(state.pilots.some((entry) => entry.templateId === hire.id)).toBe(false);
    }

    const target = offered[0];
    if (target === undefined) throw new Error('nobody on the register');
    state.cbills = 10_000_000;
    const before = state.pilots.length;

    const result = hirePilot(catalog, state, target.id);
    expect(result.ok, result.reason ?? '').toBe(true);
    expect(state.pilots).toHaveLength(before + 1);
    expect(state.cbills).toBeLessThan(10_000_000);
    // And they are no longer on offer.
    expect(availableHires(catalog, state).some((hire) => hire.id === target.id)).toBe(false);
  });

  it('refuses a direct hire outside the authored register', () => {
    const state = campaign();
    const pool = new Set(catalog.campaigns.get(state.campaignId)?.hiringPoolPilotIds ?? []);
    const outsider = [...catalog.pilots.values()].find(
      (pilot) => !pool.has(pilot.id) && !state.pilots.some((entry) => entry.templateId === pilot.id),
    );
    if (outsider === undefined) throw new Error('the pilot catalogue has no outsider');

    state.cbills = 10_000_000;
    const before = state.pilots.length;
    const result = hirePilot(catalog, state, outsider.id);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/register/);
    expect(state.pilots).toHaveLength(before);
    expect(availableHires(catalog, state)).not.toContainEqual(outsider);
  });

  it('keeps a legacy out-of-pool hire on the books', () => {
    const state = campaign();
    const pool = new Set(catalog.campaigns.get(state.campaignId)?.hiringPoolPilotIds ?? []);
    const outsider = [...catalog.pilots.values()].find(
      (pilot) => !pool.has(pilot.id) && !state.pilots.some((entry) => entry.templateId === pilot.id),
    );
    if (outsider === undefined) throw new Error('the pilot catalogue has no outsider');

    state.pilots.push({
      id: 'pilot-legacy',
      templateId: outsider.id,
      name: outsider.name,
      gunnery: outsider.gunnery,
      piloting: outsider.piloting,
      sensors: outsider.sensors,
      xp: 0,
      spentXp: 0,
      traits: [...outsider.traits],
      bio: outsider.bio,
      injuredUntilDay: state.day,
      dead: false,
      mechId: null,
    });

    expect(state.pilots.some((pilot) => pilot.templateId === outsider.id)).toBe(true);
    expect(availableHires(catalog, state).some((pilot) => pilot.id === outsider.id)).toBe(false);
  });

  it('will not sign someone the company cannot pay for', () => {
    const state = campaign();
    const target = availableHires(catalog, state)[0];
    if (target === undefined) throw new Error('nobody on the register');

    state.cbills = 0;
    const result = hirePilot(catalog, state, target.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/wants/);
  });

  it('does not offer the dead a second contract', () => {
    const state = campaign();
    const pilot = record(state);
    pilot.dead = true;
    expect(availableHires(catalog, state).some((hire) => hire.id === pilot.templateId)).toBe(false);
  });
});

describe('specialities', () => {
  const marks = catalog.rules.pilotTraits.pickAtTotalSkill;

  function bare(state: CampaignState): PilotRecord {
    const pilot = record(state);
    pilot.traits = [];
    pilot.gunnery = 3;
    pilot.piloting = 3;
    pilot.sensors = 3;
    return pilot;
  }

  it('owes a pick for every threshold a pilot’s skills have passed', () => {
    const state = campaign();
    const pilot = bare(state);
    expect(skillTotal(pilot)).toBe(9);
    expect(pendingTraitPicks(catalog, pilot)).toBe(0);

    const first = marks[0];
    if (first === undefined) throw new Error('no thresholds authored');
    pilot.gunnery += first - skillTotal(pilot);
    expect(pendingTraitPicks(catalog, pilot)).toBe(1);
  });

  it('counts specialities a company could have trained against what it owes', () => {
    // Deriving the count rather than keeping a counter means a save from before
    // picks existed grants the right number, and nothing can drift out of step
    // with the skills that justified it.
    const state = campaign();
    const pilot = bare(state);
    const first = marks[0];
    if (first === undefined) throw new Error('no thresholds authored');
    pilot.gunnery += first - skillTotal(pilot);

    pilot.traits = ['marksman'];
    expect(pendingTraitPicks(catalog, pilot)).toBe(0);

    // Traits nobody teaches are who the pilot already was. They do not spend a
    // pick, but they do take up a slot.
    pilot.traits = ['veteran'];
    expect(pendingTraitPicks(catalog, pilot)).toBe(1);
  });

  it('stops at the ceiling however many thresholds are passed', () => {
    const state = campaign();
    const pilot = bare(state);
    pilot.gunnery = 5;
    pilot.piloting = 5;
    pilot.sensors = 5;
    pilot.traits = ['veteran', 'green'];

    expect(pendingTraitPicks(catalog, pilot)).toBe(catalog.rules.pilotTraits.maxTraits - 2);
  });

  it('offers only what can be taught, and only what the pilot lacks', () => {
    const state = campaign();
    const pilot = bare(state);
    const offered = offeredTraits(catalog, pilot);

    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((id) => catalog.rules.pilotTraits.entries[id]?.trainable)).toBe(true);

    pilot.traits = [offered[0] ?? ''];
    expect(offeredTraits(catalog, pilot)).not.toContain(offered[0]);
  });

  it('awards an earned speciality once, and refuses to be asked twice', () => {
    const state = campaign();
    const pilot = bare(state);
    const first = marks[0];
    if (first === undefined) throw new Error('no thresholds authored');
    pilot.gunnery += first - skillTotal(pilot);

    expect(chooseTrait(catalog, pilot, 'marksman').ok).toBe(true);
    expect(pilot.traits).toContain('marksman');

    const again = chooseTrait(catalog, pilot, 'snap_shot');
    expect(again.ok).toBe(false);
    expect(pilot.traits).toHaveLength(1);
  });

  it('refuses a speciality the pilot has not earned, and one nobody teaches', () => {
    const state = campaign();
    const pilot = bare(state);

    expect(chooseTrait(catalog, pilot, 'marksman').ok).toBe(false);

    const first = marks[0];
    if (first === undefined) throw new Error('no thresholds authored');
    pilot.gunnery += first - skillTotal(pilot);
    const untrainable = chooseTrait(catalog, pilot, 'hard_to_kill');
    expect(untrainable.ok).toBe(false);
    expect(untrainable.reason).toMatch(/not on offer/);
  });

  it('owes the dead nothing', () => {
    const state = campaign();
    const pilot = bare(state);
    pilot.gunnery = 5;
    pilot.piloting = 5;
    pilot.sensors = 5;
    pilot.dead = true;
    expect(pendingTraitPicks(catalog, pilot)).toBe(0);
  });
});
