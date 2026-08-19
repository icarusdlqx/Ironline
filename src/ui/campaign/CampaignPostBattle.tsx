import { rechooseSalvage } from '../../campaign/salvage';
import type { CampaignState } from '../../campaign/types';
import type { Catalog } from '../../schema/load';
import { Debrief, markDebriefed } from './Debrief';

interface CampaignPostBattleProps {
  catalog: Catalog;
  state: CampaignState;
  status: string | null;
  outcomeCount: number;
  debriefed: number;
  mutate: (
    change: (draft: CampaignState) => string | null | void,
    message?: string,
  ) => void;
  onDebriefed: (count: number) => void;
}

export function CampaignPostBattle({
  catalog,
  state,
  status,
  outcomeCount,
  debriefed,
  mutate,
  onDebriefed,
}: CampaignPostBattleProps) {
  const pendingDebrief = state.history[state.history.length - 1];

  return (
    <>
      <footer className="camp-log" data-testid="camp-log">
        <span className="camp-status" data-testid="camp-status">
          {status ?? ''}
        </span>
        <ul>
          {state.log.slice(0, 6).map((entry, index) => (
            <li key={`${entry.day}-${index}`}>
              day {entry.day}: {entry.text}
            </li>
          ))}
        </ul>
      </footer>

      {outcomeCount <= debriefed || pendingDebrief === undefined ? null : (
        <Debrief
          catalog={catalog}
          state={state}
          outcome={pendingDebrief}
          onChooseSalvage={(picks) => {
            mutate((draft) => {
              const record = draft.history[draft.history.length - 1];
              if (record === undefined) return null;
              // The report the debrief is choosing from lives on the record, so
              // re-picking is a swap against what was already taken aboard.
              const report = {
                candidates: record.salvageCandidates ?? [],
                chassisRecovered: record.salvagedChassis,
                hulls: [],
                offered: record.salvageOffered ?? [],
                items: record.salvagedItems,
                provenance: record.salvageProvenance ?? [],
              };
              rechooseSalvage(draft, report, picks);
              record.salvagedItems = report.items;
              return null;
            });
          }}
          onClose={() => {
            markDebriefed(outcomeCount);
            onDebriefed(outcomeCount);
          }}
        />
      )}
    </>
  );
}
