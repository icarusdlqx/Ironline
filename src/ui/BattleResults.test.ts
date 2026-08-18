import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BattleResult } from '../sim/world';
import { BattleResults } from './BattleResults';

const RESULT: BattleResult = {
  seed: 'screen',
  missionId: 'skirmish_ridge',
  missionStatus: 'success',
  missionReason: 'all objectives complete',
  objectives: [],
  ticks: 200,
  durationSeconds: 10,
  winner: 0,
  decided: true,
  units: [],
  weapons: [],
};

const COMMON = {
  result: RESULT,
  playerTeam: 0,
  missionName: 'Mirror Ridge',
  campaignResolved: false,
  missions: [
    { id: 'skirmish_ridge', name: 'Mirror Ridge' },
    { id: 'training_ground', name: 'Training Ground' },
  ],
  selectedMissionId: 'skirmish_ridge',
  onReplay: () => undefined,
  onChooseMission: () => undefined,
  onReturnToCampaign: () => undefined,
};

describe('battle results screen', () => {
  it('offers replay and a mission briefing after a skirmish', () => {
    const markup = renderToStaticMarkup(
      createElement(BattleResults, { ...COMMON, campaignPending: false }),
    );

    expect(markup).toContain('data-testid="replay-mission"');
    expect(markup).toContain('data-testid="result-mission-picker"');
    expect(markup).toContain('data-testid="choose-mission"');
    expect(markup).not.toContain('data-testid="return-to-campaign"');
  });

  it('keeps campaign resolution as the only exit from a contract', () => {
    const markup = renderToStaticMarkup(
      createElement(BattleResults, { ...COMMON, campaignPending: true }),
    );

    expect(markup).toContain('data-testid="return-to-campaign"');
    expect(markup).toContain('Resolve contract');
    expect(markup).not.toContain('data-testid="replay-mission"');
    expect(markup).not.toContain('data-testid="choose-mission"');
  });
});
