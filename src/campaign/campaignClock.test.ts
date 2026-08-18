import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { missionTickBudget } from '../schema/missionClock';
import { acceptContract, runMission, startCampaign } from './campaign';

describe('campaign mission clock', () => {
  it('auto-resolves against the active mission budget', () => {
    const mission = catalog.missions.get('standoff_ridge');
    if (mission === undefined) throw new Error('missing standoff mission');
    const missions = new Map(catalog.missions);
    missions.set(mission.id, { ...mission, maxDurationSeconds: 5 });
    const shortCatalog = { ...catalog, missions };
    const state = startCampaign(shortCatalog, 'border_dispute', 'short-clock');
    state.completedNodes.push(
      'militia_raid',
      'pass_skirmish',
      'foundry_sweep_node',
      'shale_overwatch_node',
    );
    expect(acceptContract(shortCatalog, state, 'ridge_hold', 'fee_first').ok).toBe(true);

    const run = runMission(shortCatalog, state);

    expect(run.battle.ticks).toBe(missionTickBudget(shortCatalog, mission.id));
    expect(run.battle.durationSeconds).toBe(5);
  });
});
