import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LoreEntry } from '../../schema/lore';
import { DESKTOP_BINDINGS, FieldManual, TOUCH_BINDINGS } from './FieldManual';

const lore: LoreEntry[] = [
  {
    id: 'orders',
    title: 'Standing Orders',
    order: 2,
    summary: 'What survives contact.',
    body: ['Keep moving.'],
  },
];

describe('field manual controls', () => {
  it('records the input grammar that differs from the old control sheet', () => {
    expect(DESKTOP_BINDINGS).toContainEqual(
      expect.objectContaining({ input: '1–9', action: expect.stringContaining('control group') }),
    );
    expect(DESKTOP_BINDINGS).toContainEqual(
      expect.objectContaining({ input: 'Arrow keys / middle drag' }),
    );
    expect(DESKTOP_BINDINGS.some((binding) => binding.input.includes('WASD'))).toBe(false);
    expect(TOUCH_BINDINGS).toContainEqual(
      expect.objectContaining({ input: 'Tap a support call' }),
    );
  });

  it('keeps supported controls ahead of the setting pages', () => {
    const markup = renderToStaticMarkup(
      createElement(FieldManual, { lore, onClose: () => undefined }),
    );

    expect(markup.indexOf('Controls')).toBeLessThan(markup.indexOf('Standing Orders'));
    expect(markup).toContain('On touch, it runs from the lance through the point tapped.');
    expect(markup).toContain('Reinforcement');
    expect(markup).toContain('Drops one unused mission reserve.');
    expect(markup).not.toContain('Artillery Strike');
    expect(markup).not.toContain('Minelayer');
    expect(markup).toContain('aria-modal="true"');
  });
});
