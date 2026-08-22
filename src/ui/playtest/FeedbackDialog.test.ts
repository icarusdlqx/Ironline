import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeedbackDialog } from './FeedbackDialog';
import { createPlaytestJournal } from './journal';
import { PlaytestConsentDialog } from './PlaytestConsentDialog';
import { PlaytestProvider } from './PlaytestProvider';

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('the local feedback experience', () => {
  it('renders a labelled local-only dialog with bounded feedback controls', () => {
    const journal = createPlaytestJournal({ storage });
    journal.enable();

    const markup = renderToStaticMarkup(
      createElement(FeedbackDialog, { journal, onClose: () => undefined }),
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Nothing is sent automatically');
    expect(markup).toContain('maxLength="500"');
    expect(markup).toContain('Download report');
    expect(markup).toContain('Copy report');
    expect(markup).not.toContain('href=');
    expect(markup).not.toContain('github.com');
  });

  it('offers explicit opt-in when no report exists', () => {
    const journal = createPlaytestJournal({ storage });
    const markup = renderToStaticMarkup(
      createElement(FeedbackDialog, { journal, onClose: () => undefined }),
    );

    expect(markup).toContain('No local report is active');
    expect(markup).toContain('Enable local report');
    expect(markup).not.toContain('Download report');
  });

  it('offers an explicit reset without overwriting malformed stored bytes', () => {
    const journal = createPlaytestJournal({
      storage: () => ({
        ...storage(),
        getItem: () => '{bad',
      }),
    });
    const markup = renderToStaticMarkup(
      createElement(FeedbackDialog, { journal, onClose: () => undefined }),
    );

    expect(markup).toContain('has not been overwritten');
    expect(markup).toContain('Discard damaged report');
    expect(markup).not.toContain('{bad');
  });

  it('explains memory-only operation without exposing a browser error', () => {
    const journal = createPlaytestJournal({ storage: () => null });
    journal.enable();
    const markup = renderToStaticMarkup(
      createElement(FeedbackDialog, { journal, onClose: () => undefined }),
    );

    expect(markup).toContain('lasts only until the page closes');
    expect(markup).not.toContain('storage unavailable');
  });

  it('renders an accessible consent choice for playtest links', () => {
    const markup = renderToStaticMarkup(
      createElement(PlaytestConsentDialog, {
        onEnable: () => undefined,
        onDecline: () => undefined,
      }),
    );

    expect(markup).toContain('aria-labelledby="playtest-consent-title"');
    expect(markup).toContain('Begin local report');
    expect(markup).toContain('Play without report');
    expect(markup).toContain('Nothing is uploaded automatically');
  });

  it('lets the provider expose the query-mode consent prompt without writing', () => {
    const journal = createPlaytestJournal({ storage });
    const markup = renderToStaticMarkup(
      createElement(
        PlaytestProvider,
        {
          journal,
          initialConsentPrompt: true,
          children: createElement('main', null, 'Game'),
        },
      ),
    );

    expect(markup).toContain('<main>Game</main>');
    expect(markup).toContain('data-testid="playtest-consent"');
    expect(journal.getSnapshot().enabled).toBe(false);
  });
});
