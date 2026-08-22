import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BattleTopbar, type BattleTopbarProps } from './BattleTopbar';
import { MobileBattleTopbar } from './MobileBattleTopbar';
import { createPlaytestJournal, PlaytestProvider } from './playtest';

const PROPS: BattleTopbarProps = {
  engine: null,
  muted: false,
  lowFx: false,
  setupMissionId: 'skirmish_ridge',
  setupDifficultyId: 'green',
  missions: [],
  difficulties: [],
  locked: false,
  trainingStep: 4,
  onMuted: () => undefined,
  onLowFx: () => undefined,
  onMission: () => undefined,
  onDifficulty: () => undefined,
  onRestart: () => undefined,
  onChooseMission: () => undefined,
};

function withPlaytest(child: ReactElement): string {
  const journal = createPlaytestJournal({ storage: () => null });
  return renderToStaticMarkup(
    createElement(PlaytestProvider, { journal, children: child }),
  );
}

function feedbackButton(markup: string): string {
  return markup.match(/<button[^>]*data-testid="feedback-link"[^>]*>/u)?.[0] ?? '';
}

describe('battle feedback entry points', () => {
  it('uses the local feedback button in the desktop topbar', () => {
    const markup = withPlaytest(createElement(BattleTopbar, PROPS));

    expect(feedbackButton(markup)).toContain('type="button"');
    expect(markup).not.toContain('github.com');
    expect(markup).not.toContain('<a class="pause feedback-link"');
  });

  it('uses the same local feedback button in the mobile menu', () => {
    const markup = withPlaytest(createElement(MobileBattleTopbar, PROPS));

    expect(feedbackButton(markup)).toContain('type="button"');
    expect(markup).not.toContain('github.com');
    expect(markup).not.toContain('<a class="pause feedback-link"');
  });
});
