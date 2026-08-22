import { useRef } from 'react';
import type { CampaignState } from '../../campaign/types';
import type { Catalog } from '../../schema/load';
import { Mechbay, type BayCommission } from '../mechbay/Mechbay';
import { useDialogFocus } from '../useDialogFocus';
import { Hangar } from './Hangar';
import { LanceManifest } from './LanceManifest';
import type { FirstDropPrep } from './firstDropGuide';

interface Props {
  catalog: Catalog;
  state: CampaignState;
  prep: FirstDropPrep;
  refitting: string | null;
  refitBay: BayCommission | null;
  mutate: (change: (draft: CampaignState) => string | null | void, message?: string) => void;
  onPrep: (prep: FirstDropPrep) => void;
  onRefit: (mechId: string | null) => void;
  onManifest: () => void;
  onLaunch: () => void;
}

export function CampaignPrep({
  catalog,
  state,
  prep,
  refitting,
  refitBay,
  mutate,
  onPrep,
  onRefit,
  onManifest,
  onLaunch,
}: Props) {
  if (state.finished) return null;

  return (
    <>
      {prep === 'bay' && refitting === null ? (
        <Hangar
          catalog={catalog}
          state={state}
          mutate={mutate}
          onRefit={onRefit}
          onContinue={() => {
            onManifest();
            onPrep('manifest');
          }}
          onCancel={() => onPrep(null)}
        />
      ) : null}

      {prep === 'manifest' && refitting === null ? (
        <LanceManifest
          catalog={catalog}
          state={state}
          mutate={mutate}
          onLaunch={onLaunch}
          onCancel={() => onPrep('bay')}
          onRefit={onRefit}
        />
      ) : null}

      {refitBay === null ? null : <RefitDialog bay={refitBay} onClose={() => onRefit(null)} />}
    </>
  );
}

function RefitDialog({ bay, onClose }: { bay: BayCommission; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, dialogRef, onClose);
  return (
    <div className="manifest-backdrop" data-testid="refit-bay">
      <div
        className="refit-bay"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Refit ${bay.title}`}
        tabIndex={-1}
      >
        <Mechbay onExit={onClose} commission={bay} />
      </div>
    </div>
  );
}
