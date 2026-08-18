import { SalvageDrillCoach } from './SalvageDrillCoach';
import { SALVAGE_DRILL_MISSION_ID } from './salvageDrill';
import { TrainingCoach } from './TrainingCoach';
import { TRAINING_MISSION_ID } from './trainingProgress';

export function BattleCoach({ missionId }: { missionId: string }) {
  if (missionId === SALVAGE_DRILL_MISSION_ID) return <SalvageDrillCoach />;
  if (missionId === TRAINING_MISSION_ID) return <TrainingCoach />;
  return null;
}
