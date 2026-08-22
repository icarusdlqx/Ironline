import { firstDropInstruction, type FirstDropStage } from './firstDropGuide';
import './campaignGuide.css';

const LABELS: Record<Exclude<FirstDropStage, 'done'>, string> = {
  choose: '1 · Choose the job',
  prepare: '2 · Prepare the drop',
  bay: '3 · Check the machines',
  manifest: '4 · Launch the lance',
};

export function CampaignGuide({
  stage,
  onDismiss,
}: {
  stage: FirstDropStage;
  onDismiss: () => void;
}) {
  const instruction = firstDropInstruction(stage);
  if (instruction === null || stage === 'done') return null;

  return (
    <section className="campaign-guide" data-testid="campaign-guide" aria-live="polite">
      <span>First contract</span>
      <strong>{LABELS[stage]}</strong>
      <p>{instruction}</p>
      <button
        type="button"
        className="secondary"
        onClick={onDismiss}
        data-testid="campaign-guide-dismiss"
      >
        Show full company
      </button>
    </section>
  );
}
