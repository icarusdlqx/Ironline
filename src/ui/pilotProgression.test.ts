import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { startCampaign } from '../campaign/campaign';
import { nextSpecialityThreshold, skillTraining, traitEffects } from './pilotProgression';

function firstPilot() {
  const pilot = startCampaign(catalog, 'border_dispute', 'progression').pilots[0];
  if (pilot === undefined) throw new Error('campaign has no pilots');
  return pilot;
}

describe('pilot progression readouts', () => {
  it('describes the multipliers authored on a speciality', () => {
    const marksman = catalog.rules.pilotTraits.entries.marksman;
    const hardToKill = catalog.rules.pilotTraits.entries.hard_to_kill;
    if (marksman === undefined || hardToKill === undefined) throw new Error('missing traits');

    expect(traitEffects(marksman)).toEqual(['+10% weapon accuracy']);
    expect(traitEffects(hardToKill)).toEqual(['-50% fatality risk after mech loss']);
  });

  it('shows what the next level costs and changes', () => {
    const pilot = firstPilot();
    const training = skillTraining(catalog, pilot, 'sensors');

    expect(training.cost).toBeGreaterThan(0);
    expect(training.nextLevel).toBe(pilot.sensors + 1);
    expect(training.nextEffect).not.toBe(training.currentEffect);
    expect(training.nextEffect).toMatch(/m detection/);
  });

  it('points at the next authored speciality mark', () => {
    const pilot = firstPilot();
    pilot.traits = [];
    pilot.gunnery = 3;
    pilot.piloting = 3;
    pilot.sensors = 3;

    expect(nextSpecialityThreshold(catalog, pilot)).toBe(
      catalog.rules.pilotTraits.pickAtTotalSkill[0],
    );
  });
});
