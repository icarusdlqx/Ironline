import { describe, expect, it } from 'vitest';
import { MAX_PLAYTEST_NOTE_LENGTH, sanitisePlaytestNote } from './sanitise';

describe('playtest note sanitising', () => {
  it('redacts contact details and links before export', () => {
    const note = [
      'Email pilot@example.com or +65 9123 4567.',
      'Details at https://example.com/private?q=1.',
      'Battle 123456789 felt slow.',
    ].join(' ');

    const safe = sanitisePlaytestNote(note);

    expect(safe).toContain('[email removed]');
    expect(safe).toContain('[link removed]');
    expect(safe.match(/\[number removed\]/gu)?.length).toBe(2);
    expect(safe).not.toContain('example.com');
    expect(safe).not.toContain('9123');
  });

  it('removes control characters, normalises whitespace, and bounds code points', () => {
    const safe = sanitisePlaytestNote(`  one\u0000\n\t two  ${'🤖'.repeat(600)}  `);

    expect(safe.startsWith('one two ')).toBe(true);
    expect(safe).not.toContain('\u0000');
    expect([...safe]).toHaveLength(MAX_PLAYTEST_NOTE_LENGTH);
  });
});
