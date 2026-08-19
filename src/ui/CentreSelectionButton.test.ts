import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Engine } from './engine';
import { CentreSelectionButton } from './CentreSelectionButton';

function engine(selected: number[]): Engine {
  return { selectedEntities: vi.fn(() => selected) } as unknown as Engine;
}

describe('centre selection control', () => {
  it('exposes a labelled button', () => {
    const html = renderToStaticMarkup(createElement(CentreSelectionButton, {
      engine: engine([1]),
      className: 'command',
    }));

    expect(html).toContain('Centre camera on selection');
    expect(html).not.toContain('disabled');
  });

  it('is disabled without a player selection', () => {
    const html = renderToStaticMarkup(createElement(CentreSelectionButton, {
      engine: engine([]),
      className: 'command',
    }));
    expect(html).toContain('disabled');
  });
});
