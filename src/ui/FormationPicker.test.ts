import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormationPicker } from './FormationPicker';

describe('formation picker', () => {
  it('server-renders every endpoint preset with a clear active choice', () => {
    const markup = renderToStaticMarkup(createElement(FormationPicker, {
      value: 'wedge',
      compact: true,
      onChange: () => undefined,
    }));

    expect(markup).toContain('data-testid="formation-picker"');
    expect(markup).toContain('data-active="wedge"');
    expect(markup).toContain('aria-label="Formation at destination"');
    expect(markup).toContain('<option value="wedge" selected="">Wedge</option>');
    expect(markup).toContain('destination only');
    for (const label of ['Auto', 'Line', 'Column', 'Wedge', 'Box']) {
      expect(markup).toContain(`>${label}</option>`);
    }
  });
});
