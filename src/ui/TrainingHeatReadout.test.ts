import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrainingHeatReadout } from './TrainingHeatReadout';

describe('training heat readout', () => {
  it('names the selected machine and exposes its heat as a progress bar', () => {
    const markup = renderToStaticMarkup(
      createElement(TrainingHeatReadout, {
        unit: { name: 'Halberd', heat: 12, heatCapacity: 30 },
      }),
    );

    expect(markup).toContain('data-testid="training-heat-readout"');
    expect(markup).toContain('Halberd');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="12"');
    expect(markup).toContain('width:40%');
  });
});
