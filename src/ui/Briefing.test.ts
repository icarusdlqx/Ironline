import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Briefing } from './Briefing';

describe('briefing deployment gate', () => {
  it('keeps an invalid setup on the ground with its reason attached', () => {
    const html = renderToStaticMarkup(
      createElement(Briefing, {
        name: 'Ridge Pass',
        text: 'Hold the road.',
        objectives: [],
        resourcePoints: 0,
        deployDisabled: true,
        deployReason: 'Use at least three letters or numbers.',
        onDeploy: () => undefined,
      }),
    );

    expect(html).toContain('data-testid="briefing-deploy"');
    expect(html).toContain('data-testid="briefing-actions"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('title="Use at least three letters or numbers."');
  });

  it('keeps the training briefing fixed and offers the campaign exit', () => {
    const html = renderToStaticMarkup(
      createElement(Briefing, {
        name: 'Range Walk',
        text: 'Range control has the line.',
        objectives: [],
        resourcePoints: 80,
        setup: createElement('div', { 'data-testid': 'setup-controls' }),
        lance: {
          berths: [],
          designs: [],
          saved: [],
          pilots: [],
          total: 0,
          allowance: 0,
          onDesign: () => undefined,
          onPilot: () => undefined,
          onCustomise: () => undefined,
        },
        training: { onSkip: () => undefined },
        onDeploy: () => undefined,
      }),
    );

    expect(html).toContain('Begin range walk');
    expect(html).toContain('data-testid="training-skip"');
    expect(html).toContain('Skip to campaign');
    expect(html).not.toContain('data-testid="setup-controls"');
    expect(html).not.toContain('data-testid="briefing-lance"');
    expect(html).not.toContain('Resource Points');
    expect(html).not.toContain('Customise');
  });
});
