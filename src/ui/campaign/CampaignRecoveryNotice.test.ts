import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampaignPersistenceState } from '../../campaign/save';
import { CampaignRecoveryNotice } from './CampaignRecoveryNotice';
import { downloadCampaignFile } from './campaignDownload';

const persistent: CampaignPersistenceState = {
  mode: 'persistent',
  issue: null,
  detail: null,
  recoveryRaw: null,
};

function render(persistence: CampaignPersistenceState): string {
  return renderToStaticMarkup(
    createElement(CampaignRecoveryNotice, {
      persistence,
      onExportOriginal: () => undefined,
    }),
  );
}

describe('campaign recovery notice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stays out of a healthy campaign header', () => {
    expect(render(persistent)).toBe('');
  });

  it('explains that invalid bytes are retained and offers their export', () => {
    const html = render({
      mode: 'memory-only',
      issue: 'invalid-save',
      detail: 'state.day: expected number',
      recoveryRaw: '{damaged',
    });

    expect(html).toContain('Stored campaign could not be read.');
    expect(html).toContain('original has not been replaced');
    expect(html).toContain('memory-only');
    expect(html).toContain('data-testid="camp-recovery-export"');
  });

  it('gives an inaccessible store a recovery path without a false raw export', () => {
    const html = render({
      mode: 'memory-only',
      issue: 'storage-unavailable',
      detail: 'access denied',
      recoveryRaw: null,
    });

    expect(html).toContain('Campaign storage is unavailable.');
    expect(html).toContain('restart or import a valid campaign');
    expect(html).not.toContain('camp-recovery-export');
  });

  it('downloads the supplied recovery bytes without rewriting them', () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:recovery');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click }) });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const blob = new Blob(['{raw']);

    downloadCampaignFile(blob, 'ironline-campaign-recovery.txt');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovery');
  });
});
