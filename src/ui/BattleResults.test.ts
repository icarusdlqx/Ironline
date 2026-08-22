import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCATIONS } from '../schema/common';
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
  onSameField: () => undefined,
  onNewField: () => undefined,
  onChooseMission: () => undefined,
  onReturnToCampaign: () => undefined,
};

describe('battle results screen', () => {
  it('covers the compact navigation while the result is modal', () => {
    const resultsCss = readFileSync(new URL('./battleResults.css', import.meta.url), 'utf8');
    const mobileCss = readFileSync(new URL('./mobileBattle.css', import.meta.url), 'utf8');
    const mobileLayoutCss = readFileSync(new URL('./mobileLayout.css', import.meta.url), 'utf8');
    const rule = (source: string, selector: string): string =>
      source.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    const layer = (declarations: string): number =>
      Number(declarations.match(/z-index:\s*(\d+)/)?.[1] ?? 0);
    const backdrop = rule(resultsCss, '.battle-results-backdrop');
    const lateCompactBackdrop = rule(mobileLayoutCss, '.battle-results-backdrop');

    expect(backdrop).toMatch(/inset:\s*0/);
    expect(layer(backdrop)).toBeGreaterThan(layer(rule(mobileCss, '.mobile-topbar')));
    expect(layer(backdrop)).toBeGreaterThan(layer(rule(mobileCss, '.mobile-menu-sheet')));
    expect(lateCompactBackdrop).toMatch(/safe-area-inset-top/);
  });

  it('offers same and new fields plus a mission briefing after a skirmish', () => {
    const markup = renderToStaticMarkup(
      createElement(BattleResults, { ...COMMON, campaignPending: false }),
    );

    expect(markup).toContain('data-testid="replay-mission"');
    expect(markup).toContain('Same field');
    expect(markup).toContain('data-testid="new-field"');
    expect(markup).toContain('data-testid="battle-result-code"');
    expect(markup).toContain('Battle code <code>screen</code>');
    expect(markup).toContain('data-testid="result-mission-picker"');
    expect(markup).toContain('data-testid="choose-mission"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-describedby="battle-results-reason"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).not.toContain('data-testid="return-to-campaign"');
  });

  it('keeps campaign resolution as the only exit from a contract', () => {
    const markup = renderToStaticMarkup(
      createElement(BattleResults, { ...COMMON, campaignPending: true }),
    );

    expect(markup).toContain('data-testid="return-to-campaign"');
    expect(markup).toContain('Resolve contract');
    expect(markup).not.toContain('data-testid="replay-mission"');
    expect(markup).not.toContain('data-testid="new-field"');
    expect(markup).not.toContain('data-testid="battle-result-code"');
    expect(markup).not.toContain('data-testid="choose-mission"');
  });

  it('makes the campaign the primary exit after successful training', () => {
    const markup = renderToStaticMarkup(
      createElement(BattleResults, {
        ...COMMON,
        missionName: 'Range Walk',
        selectedMissionId: 'training_ground',
        campaignPending: false,
        trainingActions: {
          onStartCampaign: () => undefined,
          onReplay: () => undefined,
          onRetry: () => undefined,
          onContinueAnyway: () => undefined,
        },
      }),
    );

    expect(markup).toContain('data-testid="training-start-campaign"');
    expect(markup).toContain('Start campaign');
    expect(markup).toContain('data-testid="training-replay"');
    expect(markup).toContain('Replay range');
    expect(markup).not.toContain('data-testid="new-field"');
    expect(markup).not.toContain('data-testid="result-mission-picker"');
    expect(markup).not.toContain('data-testid="choose-mission"');
  });

  it('offers retry first and an explicit campaign exit after failed training', () => {
    const markup = renderToStaticMarkup(
      createElement(BattleResults, {
        ...COMMON,
        result: { ...RESULT, missionStatus: 'failure', winner: 1 },
        missionName: 'Range Walk',
        selectedMissionId: 'training_ground',
        campaignPending: false,
        trainingActions: {
          onStartCampaign: () => undefined,
          onReplay: () => undefined,
          onRetry: () => undefined,
          onContinueAnyway: () => undefined,
        },
      }),
    );

    expect(markup).toContain('data-testid="training-retry"');
    expect(markup).toContain('Retry range');
    expect(markup).toContain('data-testid="training-continue-anyway"');
    expect(markup).toContain('Continue anyway');
    expect(markup).not.toContain('data-testid="replay-mission"');
    expect(markup).not.toContain('data-testid="new-field"');
    expect(markup).not.toContain('data-testid="result-mission-picker"');
  });

  it('shows the real field grade without awarding exercise salvage', () => {
    const condition = Object.fromEntries(
      LOCATIONS.map((location) => [
        location,
        {
          armour: 0,
          rearArmour: 0,
          internal: 0,
          destroyed: location === 'left_leg' || location === 'right_leg',
        },
      ]),
    ) as BattleResult['units'][number]['condition'];
    const drill: BattleResult = {
      ...RESULT,
      missionId: 'salvage_tactics',
      decided: false,
      units: [
        {
          id: 2,
          team: 1,
          name: 'Range Warden',
          designId: 'warden_lancer',
          pilotId: 'bo_ferrant',
          alive: true,
          killMethod: null,
          pilotDead: false,
          pilotWounds: 0,
          pilotEjected: false,
          withdrew: false,
          legged: true,
          damageDealt: 0,
          damageTaken: 164,
          shotsFired: 4,
          shotsHit: 1,
          ammoSpent: 0,
          heatPeak: 8,
          kills: 0,
          condition,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(BattleResults, {
        ...COMMON,
        result: drill,
        missionName: 'Field Exercise — Salvage Tactics',
        selectedMissionId: 'salvage_tactics',
        campaignPending: false,
      }),
    );

    expect(markup).toContain('Field exercise · no inventory or C-bill reward');
    expect(markup).toContain('High-salvage standard met');
    expect(markup).toContain('Legged');
    expect(markup).toContain('85%');
    expect(markup).toContain('no recovery roll is made here');
  });
});
