import { useRef, useState, type MutableRefObject } from 'react';
import type { GameState } from './store';
import { storeDifficulty } from './store';
import {
  engineSetupFor,
  isBattleSetupLocked,
  setupForNewField,
  type BattleSetupKey,
} from './battleSetupState';

interface SetupLifecycleOptions {
  draft: BattleSetupKey;
  briefingSeen: boolean;
  finished: boolean;
  campaignPending: boolean;
  patch: (partial: Partial<GameState>) => void;
}

interface SetupLifecycle {
  engine: BattleSetupKey;
  locked: boolean;
  revision: number;
  nextStart: MutableRefObject<'briefing' | 'deploy'>;
  selectMission: (missionId: string) => void;
  selectDifficulty: (difficultyId: string) => void;
  deploy: (setup: BattleSetupKey) => void;
  restart: () => void;
  newField: (battleCode: string) => void;
  chooseMission: (missionId?: string) => void;
}

export function useBattleSetup(options: SetupLifecycleOptions): SetupLifecycle {
  const [deployed, setDeployed] = useState<BattleSetupKey | null>(null);
  const [revision, setRevision] = useState(0);
  const nextStart = useRef<'briefing' | 'deploy'>('briefing');
  const engine = engineSetupFor(options.draft, deployed);
  const locked = isBattleSetupLocked(
    options.briefingSeen,
    options.finished,
    options.campaignPending,
  );

  const selectMission = (missionId: string): void => {
    if (locked || options.campaignPending) return;
    setDeployed(null);
    options.patch({ skirmishMissionId: missionId });
  };

  const selectDifficulty = (difficulty: string): void => {
    if (locked) return;
    setDeployed(null);
    storeDifficulty(difficulty);
    options.patch({ difficulty });
  };

  const restart = (): void => {
    nextStart.current = 'deploy';
    setDeployed(engine);
    setRevision((current) => current + 1);
  };

  const newField = (battleCode: string): void => {
    nextStart.current = 'deploy';
    const next = setupForNewField(engine, battleCode);
    options.patch({ battleCode });
    setDeployed(next);
    setRevision((current) => current + 1);
  };

  const chooseMission = (missionId = engine.missionId): void => {
    nextStart.current = 'briefing';
    storeDifficulty(engine.difficulty);
    options.patch({ skirmishMissionId: missionId, difficulty: engine.difficulty });
    setDeployed(null);
    setRevision((current) => current + 1);
  };

  return {
    engine,
    locked,
    revision,
    nextStart,
    selectMission,
    selectDifficulty,
    deploy: (next) => {
      nextStart.current = 'deploy';
      setDeployed(next);
      setRevision((current) => current + 1);
    },
    restart,
    newField,
    chooseMission,
  };
}
