import type { PlaytestJournal } from './journal';

export const PLAYTEST_REPORT_FILE_NAME = 'ironline-playtest-report.json';

export function downloadPlaytestReport(journal: PlaytestJournal, note = ''): boolean {
  journal.record({ name: 'report_downloaded' });
  const text = journal.serialiseExport(note);
  if (text === null) return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = PLAYTEST_REPORT_FILE_NAME;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
