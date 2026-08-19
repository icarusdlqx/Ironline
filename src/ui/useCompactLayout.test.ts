import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPACT_LAYOUT_QUERY } from './useCompactLayout';

describe('compact layout boundary', () => {
  it('includes common coarse-pointer tablets without changing medium desktop windows', () => {
    const recovery = readFileSync(new URL('./campaign/recovery.css', import.meta.url), 'utf8');

    expect(COMPACT_LAYOUT_QUERY).toContain('(max-width: 640px)');
    expect(COMPACT_LAYOUT_QUERY).toContain('(pointer: coarse) and (max-width: 1100px)');
    expect(COMPACT_LAYOUT_QUERY).not.toContain('(max-width: 1100px),');
    expect(recovery).toContain('(pointer: coarse) and (max-width: 1100px)');
    expect(recovery).not.toContain('(pointer: coarse) and (max-width: 940px)');
  });

  it('keeps browser zoom available in served and single-file builds', () => {
    const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const single = readFileSync(new URL('../../tools/build-single.mjs', import.meta.url), 'utf8');

    for (const source of [index, single]) {
      expect(source).toContain('width=device-width, initial-scale=1, viewport-fit=cover');
      expect(source).not.toContain('user-scalable=no');
      expect(source).not.toContain('maximum-scale=1');
    }
  });
});
