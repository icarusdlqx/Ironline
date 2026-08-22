import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { FeedbackDialog } from './FeedbackDialog';
import {
  playtestJournal,
  playtestRequested,
  type PlaytestJournal,
  type PlaytestSnapshot,
} from './journal';
import { PlaytestConsentDialog } from './PlaytestConsentDialog';
import type { FirstRunEventInput } from './schema';

export interface PlaytestContextValue {
  snapshot: PlaytestSnapshot;
  openFeedback: () => void;
  requestConsent: () => void;
  record: (event: FirstRunEventInput) => boolean;
}

const PlaytestContext = createContext<PlaytestContextValue | null>(null);

export function PlaytestProvider({
  children,
  journal = playtestJournal,
  initialConsentPrompt,
}: {
  children: ReactNode;
  journal?: PlaytestJournal;
  initialConsentPrompt?: boolean;
}) {
  const snapshot = useSyncExternalStore(
    journal.subscribe,
    journal.getSnapshot,
    journal.getSnapshot,
  );
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(
    () =>
      !journal.getSnapshot().enabled &&
      (initialConsentPrompt ?? playtestRequested()),
  );
  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);

  const value = useMemo<PlaytestContextValue>(
    () => ({
      snapshot,
      openFeedback: () => {
        setConsentOpen(false);
        journal.record({ name: 'feedback_opened' });
        setFeedbackOpen(true);
      },
      requestConsent: () => setConsentOpen(true),
      record: journal.record,
    }),
    [journal, snapshot],
  );

  return (
    <PlaytestContext.Provider value={value}>
      {children}
      {consentOpen ? (
        <PlaytestConsentDialog
          onEnable={() => {
            journal.enable();
            journal.record({ name: 'front_door_viewed' });
            setConsentOpen(false);
          }}
          onDecline={() => setConsentOpen(false)}
        />
      ) : null}
      {feedbackOpen ? (
        <FeedbackDialog journal={journal} onClose={closeFeedback} />
      ) : null}
    </PlaytestContext.Provider>
  );
}

export function usePlaytest(): PlaytestContextValue {
  const context = useContext(PlaytestContext);
  if (context === null) throw new Error('usePlaytest must be used inside PlaytestProvider');
  return context;
}
