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
});
