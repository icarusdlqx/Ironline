import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BriefingSetup, SetupToolbar } from './BattleSetup';

const common = {
  missionId: 'skirmish_ridge',
  difficultyId: 'green',
  missions: [{ id: 'skirmish_ridge', name: 'Skirmish — Ridge Pass' }],
  difficulties: [
    { id: 'green', label: 'Green', description: 'Enemy pilots advance cautiously.' },
  ],
  battleCode: 'copper-relay-0000002a',
  onMission: vi.fn(),
  onDifficulty: vi.fn(),
  onBattleCode: vi.fn(),
};

describe('briefing setup', () => {
  it('puts the skirmish choices and editable code inside the briefing', () => {
    const html = renderToStaticMarkup(
      createElement(BriefingSetup, { ...common, campaignMissionName: null }),
    );

    expect(html).toContain('data-testid="briefing-mission-picker"');
    expect(html).toContain('data-testid="briefing-difficulty-picker"');
    expect(html).toContain('data-testid="briefing-battle-code"');
    expect(html).toContain('value="copper-relay-0000002a"');
    expect(html).toMatch(/autocapitalize="none"/i);
    expect(html).toContain('reproduces the opening field and battle rolls');
    expect(html).toContain('Enemy pilots advance cautiously.');
  });

  it('shows a campaign mission as fixed by its contract', () => {
    const html = renderToStaticMarkup(
      createElement(BriefingSetup, { ...common, campaignMissionName: 'Foundry Sweep' }),
    );

    expect(html).toContain('data-testid="briefing-mission-fixed"');
    expect(html).toContain('Fixed by contract');
    expect(html).not.toContain('data-testid="briefing-mission-picker"');
    expect(html).not.toContain('data-testid="briefing-battle-code"');
  });
});

describe('deployed setup controls', () => {
  it('keeps both choices visible and disabled beside explicit exit paths', () => {
    const html = renderToStaticMarkup(
      createElement(SetupToolbar, {
        ...common,
        campaignMissionName: null,
        locked: true,
        showActions: true,
        onRestart: vi.fn(),
        onChooseMission: vi.fn(),
      }),
    );

    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('data-testid="setup-locked"');
    expect(html).toContain('data-testid="restart-battle"');
    expect(html).toContain('data-testid="choose-mission"');
  });

  it('keeps a deployed contract fixed without offering another mission', () => {
    const html = renderToStaticMarkup(
      createElement(SetupToolbar, {
        ...common,
        campaignMissionName: 'Foundry Sweep',
        locked: true,
        showActions: true,
        onRestart: vi.fn(),
        onChooseMission: vi.fn(),
      }),
    );

    expect(html).toContain('data-testid="restart-battle"');
    expect(html).toContain('data-testid="mission-fixed"');
    expect(html).toContain('Foundry Sweep');
    expect(html).not.toContain('data-testid="choose-mission"');
  });
});
