import type { CampaignPersistenceState, CampaignStorageIssue } from '../../campaign/save';
import './recovery.css';

const COPY: Record<CampaignStorageIssue, { title: string; body: string }> = {
  'invalid-save': {
    title: 'Stored campaign could not be read.',
    body: 'The original has not been replaced. This temporary company is memory-only until you restart or import a valid campaign.',
  },
  'storage-unavailable': {
    title: 'Campaign storage is unavailable.',
    body: 'This temporary company is memory-only. Restore browser storage, then restart or import a valid campaign.',
  },
  'write-failed': {
    title: 'The last campaign save was refused.',
    body: 'Recent changes are memory-only. Export this campaign before closing the tab, then restart or import after storage is available.',
  },
  'remove-failed': {
    title: 'The stored campaign could not be cleared.',
    body: 'The current company is memory-only. Restart or import a valid campaign after storage is available.',
  },
};

export interface CampaignRecoveryNoticeProps {
  persistence: CampaignPersistenceState;
  onExportOriginal: () => void;
}

export function CampaignRecoveryNotice({
  persistence,
  onExportOriginal,
}: CampaignRecoveryNoticeProps) {
  if (persistence.mode === 'persistent' || persistence.issue === null) return null;
  const copy = COPY[persistence.issue];
  return (
    <section className="camp-recovery" role="alert" data-testid="camp-recovery">
      <div>
        <strong>{copy.title}</strong>
        <span>{copy.body}</span>
        {persistence.detail === null ? null : (
          <small data-testid="camp-recovery-detail">{persistence.detail}</small>
        )}
      </div>
      {persistence.recoveryRaw === null ? null : (
        <button type="button" onClick={onExportOriginal} data-testid="camp-recovery-export">
          Export original save
        </button>
      )}
    </section>
  );
}
